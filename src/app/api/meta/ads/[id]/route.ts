import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { getAdById, updateAd, deleteAd, AdUpdateSchema } from '@/models/ad';
import { getPartnerFromRequest } from '@/lib/auth';
import { getCampaignById } from '@/models/campaign';
import { markAdSynced, markGoogleAdSynced, updateAdApproval } from '@/models/ad';
import { resyncAdCreativeToMeta, resyncAdCreativeToGoogle } from '@/lib/campaigns/sync';

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

    // 1) Save local changes first (idempotent).
    const saved = await updateAd(id, parseResult.data);

    // 2) If the ad has a Meta/Google ID and creative fields changed, resync.
    const creativeChanged =
      parseResult.data.headlines !== undefined ||
      parseResult.data.bodies !== undefined ||
      parseResult.data.descriptions !== undefined ||
      parseResult.data.linkUrl !== undefined ||
      parseResult.data.callToAction !== undefined;

    const warnings: string[] = [];
    let updated = saved;

    if (creativeChanged && (before.metaAdId || before.googleAdId)) {
      const campaign = await getCampaignById(before.campaignId);
      if (!campaign) {
        return NextResponse.json({ error: 'Campaign not found for ad' }, { status: 500 });
      }
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
    await deleteAd(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Error deleting ad');

    const message = error instanceof Error ? error.message : 'Error deleting ad';

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
