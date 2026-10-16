import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { getAdById, updateAd, deleteAd, AdUpdateSchema } from '@/models/ad';
import { getPartnerFromRequest, canManageCampaign } from '@/lib/auth';
import { adMediaResponse } from '@/lib/assets/ad-media-response';
import { AdMediaError } from '@/models/ad';
import { getCampaignById } from '@/models/campaign';
import { getImagesByIds } from '@/models/image';
import { getVideosByIds } from '@/models/video';
import { markAdSynced, markGoogleAdSynced, updateAdApproval } from '@/models/ad';
import { resyncAdCreativeToMeta, resyncAdCreativeToGoogle } from '@/lib/campaigns/sync';

// One message for unknown and foreign media (see AdMediaError).
const MEDIA_UNAVAILABLE = new AdMediaError().message;

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/meta/ads/[id]
 * Get an ad by ID
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const ad = await getAdById(id);

    if (!ad) {
      return NextResponse.json({ error: 'Ad not found' }, { status: 404 });
    }

    const campaign = await getCampaignById(ad.campaignId);
    if (!campaign || !canManageCampaign(partner, campaign.partnerId).allowed) {
      // Same 404 as a missing ad: a wrong-owner id must not be distinguishable
      // from one that does not exist.
      return NextResponse.json({ error: 'Ad not found' }, { status: 404 });
    }

    return NextResponse.json(ad);
  } catch (error) {
    logger.error({ err: error }, 'Error fetching ad');
    return NextResponse.json({ error: 'Error fetching ad' }, { status: 500 });
  }
}

/**
 * PATCH /api/meta/ads/[id]
 *
 * Update an ad and (if the ad is synced) push the new creative to Meta and/or
 * Google. Because Meta/Google creatives are immutable, the resync helpers
 * create a fresh ad and swap over — this is the standard pattern.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await req.json();

    const parseResult = AdUpdateSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid data', details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const before = await getAdById(id);
    if (!before) {
      return NextResponse.json({ error: 'Ad not found' }, { status: 404 });
    }

    const campaign = await getCampaignById(before.campaignId);
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found for ad' }, { status: 500 });
    }

    const access = canManageCampaign(partner, campaign.partnerId);
    if (!access.allowed) {
      return NextResponse.json(
        { error: 'You do not have permission to modify this campaign' },
        { status: 403 }
      );
    }

    const patch = parseResult.data;

    // `AdSchema` exposes hydrated `images`/`videos`, not the raw id arrays, so
    // the ids the ad would end up with have to be derived.
    const nextImageIds = patch.imageIds ?? before.images.map((image) => image.id);
    const nextVideoIds = patch.videoIds ?? before.videos.map((video) => video.id);

    // Media of the wrong type is silently dropped at sync time (only `images`
    // are sent for an IMAGE ad and only `videos` for a VIDEO one), and
    // `adSetType` itself is immutable, so reject the combination outright.
    if (before.adSetType === 'IMAGE' && nextVideoIds.length > 0) {
      return NextResponse.json(
        { error: 'This ad is an image ad; it cannot carry videos.' },
        { status: 400 }
      );
    }
    if (before.adSetType === 'VIDEO' && nextImageIds.length > 0) {
      return NextResponse.json(
        { error: 'This ad is a video ad; it cannot carry images.' },
        { status: 400 }
      );
    }

    if (nextImageIds.length + nextVideoIds.length === 0) {
      return NextResponse.json(
        { error: 'An ad must keep at least one image or video.' },
        { status: 400 }
      );
    }

    // The schema accepts any document id, so confirm the assets exist and
    // belong to this campaign's film before attaching them.
    const [nextImages, nextVideos] = await Promise.all([
      getImagesByIds(nextImageIds),
      getVideosByIds(nextVideoIds),
    ]);

    if (nextImages.length !== nextImageIds.length || nextVideos.length !== nextVideoIds.length) {
      return NextResponse.json({ error: MEDIA_UNAVAILABLE }, { status: 400 });
    }

    const foreignMedia =
      nextImages.some((image) => image.filmMuviUuid !== campaign.filmMuviUuid) ||
      nextVideos.some((video) => video.filmMuviUuid !== campaign.filmMuviUuid);
    if (foreignMedia) {
      // Same answer as "unknown": an id cannot be probed for existence.
      return NextResponse.json({ error: MEDIA_UNAVAILABLE }, { status: 400 });
    }

    // A video without a `metaVideoId` is filtered out of the resync payload and
    // Meta then rejects the creative outright. Refuse before writing so the ad
    // is never left saved locally but unpushable.
    if (
      before.metaAdId &&
      before.adSetType === 'VIDEO' &&
      nextVideos.some((video) => !video.metaVideoId)
    ) {
      return NextResponse.json(
        {
          error: 'One of the selected videos is still uploading to Meta. Try again in a few minutes.',
          code: 'VIDEO_NOT_READY',
        },
        { status: 400 }
      );
    }

    // 1) Save local changes first (idempotent).
    const saved = await updateAd(id, patch);

    // 2) If the ad has a Meta/Google ID and creative fields changed, resync.
    const creativeChanged =
      patch.headlines !== undefined ||
      patch.bodies !== undefined ||
      patch.descriptions !== undefined ||
      patch.linkUrl !== undefined ||
      patch.callToAction !== undefined ||
      patch.imageIds !== undefined ||
      patch.videoIds !== undefined;

    const warnings: string[] = [];
    let updated = saved;

    if (creativeChanged && (before.metaAdId || before.googleAdId)) {
      const adWithMedia = await getAdById(id);
      if (!adWithMedia) {
        return NextResponse.json({ error: 'Ad not found after update' }, { status: 500 });
      }

      if (before.metaAdId) {
        try {
          const { newMetaAdId } = await resyncAdCreativeToMeta(adWithMedia, campaign, {
            headlines: adWithMedia.headlines,
            bodies: adWithMedia.bodies,
            descriptions: adWithMedia.descriptions,
            callToAction: adWithMedia.callToAction,
            linkUrl: adWithMedia.linkUrl,
          });
          updated = await markAdSynced(id, newMetaAdId);
          await updateAdApproval(id, {
            approvalStatus: 'PENDING_REVIEW',
            rejectionReason: null,
            rejectionDetails: null,
            suggestedCorrection: null,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown Meta resync error';
          logger.error({ err, adId: id }, 'Meta resync failed');
          warnings.push(`Meta: ${msg}`);
        }
      }

      if (before.googleAdId) {
        try {
          const { newGoogleAdId } = await resyncAdCreativeToGoogle(adWithMedia, campaign, {
            headlines: adWithMedia.headlines,
            descriptions:
              adWithMedia.descriptions.length > 0 ? adWithMedia.descriptions : adWithMedia.bodies,
            linkUrl: adWithMedia.linkUrl,
          });
          updated = await markGoogleAdSynced(id, newGoogleAdId, adWithMedia.youtubeAdFormat ?? undefined);
          await updateAdApproval(id, {
            approvalStatus: 'PENDING_REVIEW',
            rejectionReason: null,
            rejectionDetails: null,
            suggestedCorrection: null,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown Google resync error';
          logger.error({ err, adId: id }, 'Google resync failed');
          warnings.push(`Google: ${msg}`);
        }
      }
    }

    return NextResponse.json({ ad: updated, warnings });
  } catch (error) {
    const mediaDenied = adMediaResponse(error);
    if (mediaDenied) return mediaDenied;

    logger.error({ err: error }, 'Error updating ad');
    return NextResponse.json({ error: 'Error updating ad' }, { status: 500 });
  }
}

/**
 * DELETE /api/meta/ads/[id]
 * Delete an ad (only if in DRAFT status)
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;

    const ad = await getAdById(id);
    if (!ad) {
      return NextResponse.json({ error: 'Ad not found' }, { status: 404 });
    }

    const campaign = await getCampaignById(ad.campaignId);
    if (!campaign || !canManageCampaign(partner, campaign.partnerId).allowed) {
      return NextResponse.json({ error: 'Ad not found' }, { status: 404 });
    }

    await deleteAd(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Error deleting ad');

    const message = error instanceof Error ? error.message : 'Error deleting ad';

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
