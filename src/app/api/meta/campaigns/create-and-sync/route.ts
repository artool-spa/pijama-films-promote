import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createCampaign, markCampaignSynced, markCampaignError } from '@/models/campaign';
import { createAdsForCampaign, markAdSynced, markAdError } from '@/models/ad';
import { getPartnerById } from '@/models/partner';
import { getPartnerFromRequest } from '@/lib/auth';
import { broadcaster } from '@/lib/events';
import {
  meta,
  createCBOCampaignWithAdSets,
  createDynamicCreativeAd,
  uploadAdVideo,
  buildTargeting,
  MetaApiError,
} from '#meta';

// Helper to broadcast campaign progress
function emitProgress(filmId: string, campaignId: string, step: string, progress: number, message: string) {
  broadcaster.broadcast(`film:${filmId}`, {
    type: 'campaign_progress',
    campaignId,
    step,
    progress,
    message,
  });
}

// Schema for ads included in campaign creation
// adSetType is auto-detected based on media (IMAGE if has images, VIDEO if has videos)
const AdInputSchema = z.object({
  name: z.string().min(1).max(255),
  headlines: z.array(z.string().min(1).max(255)).min(1).max(5),
  bodies: z.array(z.string().min(1).max(2200)).min(1).max(5),
  descriptions: z.array(z.string().max(30)).max(5).default([]),
  callToAction: z.string().default('LEARN_MORE'),
  linkUrl: z.string().url(),
  imageIds: z.array(z.string().cuid()).max(10).default([]),
  videoIds: z.array(z.string().cuid()).max(10).default([]),
});

// Combined schema for campaign + ads + auto-sync
// Each campaign has a single language (no multi-language)
const CampaignWithAdsCreateSchema = z.object({
  // Campaign fields
  name: z.string().min(1).max(255),
  objective: z.enum(['CONVERSIONS', 'LANDING_PAGE_VIEW']).default('LANDING_PAGE_VIEW'),
  budget: z.number().positive(),
  budgetType: z.enum(['DAILY', 'LIFETIME']).default('LIFETIME'),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  // Language (single per campaign - required)
  language: z.string().min(2).max(10).default('es'),
  // Targeting
  targetCountries: z.array(z.string()).default(['US']),
  targetAgeMin: z.number().int().min(13).max(65).default(18),
  targetAgeMax: z.number().int().min(13).max(65).default(65),
  targetGenders: z.array(z.number().int()).default([]),
  includeBaseAudiences: z.boolean().default(true),
  filmGenres: z.array(z.string()).default([]),
  includeLgbtAudience: z.boolean().default(false),
  filmMuviUuid: z.string().min(1),
  // Ads to create
  ads: z.array(AdInputSchema).min(1),
  // Auto-sync flag
  autoSync: z.boolean().default(true),
});

type CampaignWithAdsCreate = z.infer<typeof CampaignWithAdsCreateSchema>;

/**
 * POST /api/meta/campaigns/create-and-sync
 * Create a campaign with ads and automatically sync to Meta using CBO
 *
 * CBO (Campaign Budget Optimization) Structure:
 * - 1 Meta Campaign with budget at campaign level
 * - 1-2 AdSets (one for images, one for videos) - no individual budgets
 * - 1 dynamic creative ad per AdSet with all media/copy variants
 */
export async function POST(req: NextRequest) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const result = CampaignWithAdsCreateSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: result.error.flatten() },
        { status: 400 }
      );
    }

    const data = result.data;

    // Verify the partner exists
    const targetPartner = await getPartnerById(partner.id);
    if (!targetPartner) {
      return NextResponse.json({ error: 'Partner no encontrado' }, { status: 404 });
    }

    // Step 1: Create campaign locally (DRAFT status)
    const { ads: adsData, autoSync, ...campaignData } = data;
    const campaign = await createCampaign({
      ...campaignData,
      partnerId: partner.id,
      conversionEvent: 'VIEW_CONTENT', // Default for landing page views
    });

    emitProgress(data.filmMuviUuid, campaign.id, 'campaign', 10, 'Campaign saved locally');

    // Step 2: Create ads locally (DRAFT status)
    // adSetType is auto-detected: VIDEO if has videos, IMAGE otherwise
    const adsToCreate = adsData
      .filter(ad => ad.imageIds.length > 0 || ad.videoIds.length > 0)
      .map(ad => ({
        name: ad.name,
        headlines: ad.headlines,
        bodies: ad.bodies,
        descriptions: ad.descriptions,
        callToAction: ad.callToAction,
        linkUrl: ad.linkUrl,
        imageIds: ad.imageIds,
        videoIds: ad.videoIds,
        // adSetType auto-detected by createAdsForCampaign
      }));

    if (adsToCreate.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere al menos un anuncio con imagen o video' },
        { status: 400 }
      );
    }

    const ads = await createAdsForCampaign(campaign.id, adsToCreate);

    emitProgress(data.filmMuviUuid, campaign.id, 'ads', 20, 'Ads saved locally');

    // If autoSync is disabled, return the draft campaign and ads
    if (!autoSync) {
      return NextResponse.json({
        success: true,
        campaign,
        ads,
        synced: false,
      }, { status: 201 });
    }

    // Validate Meta configuration for sync
    if (!meta.pageId) {
      return NextResponse.json({
        success: true,
        campaign,
        ads,
        synced: false,
        syncError: 'META_PAGE_ID no está configurado. La campaña se guardó como borrador.',
      }, { status: 201 });
    }

    emitProgress(data.filmMuviUuid, campaign.id, 'media', 30, 'Processing media assets...');

    // Step 3: Determine what media types we have
    const hasImages = ads.some(ad => ad.images.length > 0);
    const hasVideos = ads.some(ad => ad.videos.length > 0);

    // Collect all media
    const allImageUrls: string[] = [];
    const allVideoIds: string[] = [];
    const videoUploadErrors: string[] = [];

    for (const ad of ads) {
      // Collect image URLs
      for (const image of ad.images) {
        if (!allImageUrls.includes(image.url)) {
          allImageUrls.push(image.url);
        }
      }

      // Upload videos (or use existing metaVideoId)
      for (const video of ad.videos) {
        try {
          let videoId: string;
          if (video.metaVideoId) {
            videoId = video.metaVideoId;
          } else {
            const uploaded = await uploadAdVideo(meta, video.url, video.name);
            videoId = uploaded.video_id;
          }
          if (!allVideoIds.includes(videoId)) {
            allVideoIds.push(videoId);
          }
        } catch (err) {
          console.error(`Failed to upload video ${video.id}:`, err);
          videoUploadErrors.push(video.id);
        }
      }
    }

    // Check if we have any media to work with
    const effectiveHasImages = allImageUrls.length > 0;
    const effectiveHasVideos = allVideoIds.length > 0;

    if (!effectiveHasImages && !effectiveHasVideos) {
      return NextResponse.json({
        success: true,
        campaign,
        ads,
        synced: false,
        syncError: 'No se pudo procesar ningún medio',
        videoUploadErrors: videoUploadErrors.length > 0 ? videoUploadErrors : undefined,
      }, { status: 201 });
    }

    emitProgress(data.filmMuviUuid, campaign.id, 'meta_campaign', 40, 'Creating Meta campaign...');

    // Step 4: Create CBO Campaign with AdSets in Meta
    let metaCampaignId: string;
    let imageAdSetId: string | undefined;
    let videoAdSetId: string | undefined;

    try {
      // Build targeting
      const targeting = await buildTargeting(meta, {
        countries: campaign.targetCountries,
        ageMin: campaign.targetAgeMin,
        ageMax: campaign.targetAgeMax,
        genders: campaign.targetGenders,
        audiences: {
          includeBaseAudiences: campaign.includeBaseAudiences,
          filmGenres: campaign.filmGenres,
          includeLgbtAudience: campaign.includeLgbtAudience,
        },
      });

      console.log('[Meta] Built targeting:', JSON.stringify(targeting, null, 2));

      // Map objective to Meta objective
      const metaObjective = campaign.objective === 'CONVERSIONS'
        ? 'OUTCOME_SALES'
        : 'OUTCOME_TRAFFIC';

      // Map objective to optimization goal
      const optimizationGoal = campaign.objective === 'CONVERSIONS'
        ? 'OFFSITE_CONVERSIONS'
        : 'LANDING_PAGE_VIEWS';

      // Create CBO Campaign with AdSets
      // Prefix campaign name with partner for easier identification in Meta Ads Manager
      const metaCampaignName = `camp_${targetPartner.name}_${campaign.name}`;
      const cboResult = await createCBOCampaignWithAdSets(meta, {
        name: metaCampaignName,
        objective: metaObjective,
        budget: Math.round(campaign.budget * 100), // Convert to cents
        budgetType: campaign.budgetType.toLowerCase() as 'daily' | 'lifetime',
        startTime: campaign.startDate.toISOString(),
        endTime: campaign.endDate?.toISOString(),
        targeting,
        promotedObject: campaign.objective === 'CONVERSIONS' && meta.pixelId
          ? { pixel_id: meta.pixelId, custom_event_type: 'PURCHASE' }
          : undefined,
        hasImages: effectiveHasImages,
        hasVideos: effectiveHasVideos,
        optimizationGoal,
      });

      metaCampaignId = cboResult.campaignId;
      imageAdSetId = cboResult.imageAdSetId;
      videoAdSetId = cboResult.videoAdSetId;

      emitProgress(data.filmMuviUuid, campaign.id, 'meta_adsets', 60, 'Campaign and ad sets created in Meta');

      // Mark campaign as synced with CBO IDs
      await markCampaignSynced(campaign.id, metaCampaignId, imageAdSetId, videoAdSetId);
    } catch (error) {
      console.error('Error syncing campaign to Meta:', error);
      await markCampaignError(campaign.id).catch(() => {});

      let syncError = 'Error al sincronizar con Meta';
      let syncErrorDetails: unknown = undefined;
      if (error instanceof MetaApiError) {
        syncError = error.message;
        syncErrorDetails = {
          code: error.errorCode,
          subcode: error.errorSubcode,
          response: error.response,
        };
      }

      return NextResponse.json({
        success: true,
        campaign,
        ads,
        synced: false,
        syncError,
        syncErrorDetails,
      }, { status: 201 });
    }

    // Step 5: Create dynamic creative ads in Meta (one per AdSet)
    const syncedAds: typeof ads = [];
    const adErrors: Array<{ adId: string; error: string }> = [];

    // Consolidate all copy from ads (single language per campaign)
    const allHeadlines: string[] = [];
    const allBodies: string[] = [];
    const allDescriptions: string[] = [];
    let linkUrl = ads[0]?.linkUrl || '';
    let callToAction = ads[0]?.callToAction || 'LEARN_MORE';

    for (const ad of ads) {
      allHeadlines.push(...ad.headlines);
      allBodies.push(...ad.bodies);
      if (ad.descriptions) {
        allDescriptions.push(...ad.descriptions);
      }
    }

    const uniqueHeadlines = [...new Set(allHeadlines)].slice(0, 5); // Max 5
    const uniqueBodies = [...new Set(allBodies)].slice(0, 5); // Max 5
    const uniqueDescriptions = [...new Set(allDescriptions)].slice(0, 5); // Max 5

    // Track ad creation results independently for graceful partial failure
    let imageAdId: string | undefined;
    let videoAdId: string | undefined;
    let imageAdError: string | undefined;
    let videoAdError: string | undefined;

    // Create image ad (independent try/catch for partial success)
    if (effectiveHasImages && imageAdSetId) {
      try {
        emitProgress(data.filmMuviUuid, campaign.id, 'image_ad', 70, 'Creating image ad...');
        console.log('[Meta] Creating dynamic creative ad for images:', {
          adSetId: imageAdSetId,
          imageCount: allImageUrls.length,
          headlines: uniqueHeadlines.length,
        });

        const imageAd = await createDynamicCreativeAd(meta, {
          name: `${campaign.name} - Images`,
          adsetId: imageAdSetId,
          pageId: meta.pageId!,
          linkUrl,
          headlines: uniqueHeadlines,
          bodies: uniqueBodies,
          descriptions: uniqueDescriptions.length > 0 ? uniqueDescriptions : undefined,
          callToAction,
          imageUrls: allImageUrls,
        });

        if (imageAd.ad_id) {
          imageAdId = imageAd.ad_id;
          console.log('[Meta] Image ad created:', imageAd.ad_id);
        }
      } catch (error) {
        imageAdError = error instanceof MetaApiError ? error.message : 'Error creating image ad';
        console.error('Image ad creation failed:', error);
      }
    }

    // Create video ad (independent try/catch for partial success)
    if (effectiveHasVideos && videoAdSetId) {
      try {
        emitProgress(data.filmMuviUuid, campaign.id, 'video_ad', 85, 'Creating video ad...');
        console.log('[Meta] Creating dynamic creative ad for videos:', {
          adSetId: videoAdSetId,
          videoCount: allVideoIds.length,
          headlines: uniqueHeadlines.length,
        });

        const videoAd = await createDynamicCreativeAd(meta, {
          name: `${campaign.name} - Videos`,
          adsetId: videoAdSetId,
          pageId: meta.pageId!,
          linkUrl,
          headlines: uniqueHeadlines,
          bodies: uniqueBodies,
          descriptions: uniqueDescriptions.length > 0 ? uniqueDescriptions : undefined,
          callToAction,
          videoIds: allVideoIds,
        });

        if (videoAd.ad_id) {
          videoAdId = videoAd.ad_id;
          console.log('[Meta] Video ad created:', videoAd.ad_id);
        }
      } catch (error) {
        videoAdError = error instanceof MetaApiError ? error.message : 'Error creating video ad';
        console.error('Video ad creation failed:', error);
      }
    }

    // Check if at least one ad was created (partial success is OK)
    const hasCreatedAds = imageAdId || videoAdId;

    if (!hasCreatedAds) {
      // Total failure - mark all ads as error
      const errorMessage = imageAdError || videoAdError || 'Failed to create any ads in Meta';
      broadcaster.broadcast(`film:${data.filmMuviUuid}`, {
        type: 'campaign_error',
        campaignId: campaign.id,
        error: errorMessage,
      });

      for (const ad of ads) {
        await markAdError(ad.id).catch(() => {});
        adErrors.push({
          adId: ad.id,
          error: errorMessage,
        });
      }
    } else {
      // At least one ad succeeded - mark ads based on their type
      emitProgress(data.filmMuviUuid, campaign.id, 'syncing', 95, 'Syncing ad data...');

      for (const ad of ads) {
        if (ad.adSetType === 'VIDEO') {
          if (videoAdId) {
            await markAdSynced(ad.id, videoAdId);
            syncedAds.push({ ...ad, metaAdId: videoAdId });
          } else {
            await markAdError(ad.id).catch(() => {});
            adErrors.push({ adId: ad.id, error: videoAdError || 'Video ad creation failed' });
          }
        } else {
          // IMAGE type
          if (imageAdId) {
            await markAdSynced(ad.id, imageAdId);
            syncedAds.push({ ...ad, metaAdId: imageAdId });
          } else {
            await markAdError(ad.id).catch(() => {});
            adErrors.push({ adId: ad.id, error: imageAdError || 'Image ad creation failed' });
          }
        }
      }

      emitProgress(data.filmMuviUuid, campaign.id, 'complete', 100, 'Campaign created successfully!');
    }

    // Build structured issues object for user notification
    const issues: {
      videoUploads?: { count: number; videoIds: string[]; message: string };
      imageAd?: { error: string; message: string };
      videoAd?: { error: string; message: string };
      summary?: string;
    } = {};

    if (videoUploadErrors.length > 0) {
      issues.videoUploads = {
        count: videoUploadErrors.length,
        videoIds: videoUploadErrors,
        message: `${videoUploadErrors.length} video(s) could not be uploaded and were skipped`,
      };
    }

    if (imageAdError) {
      issues.imageAd = {
        error: imageAdError,
        message: `Image ad could not be created: ${imageAdError}`,
      };
    }

    if (videoAdError) {
      issues.videoAd = {
        error: videoAdError,
        message: `Video ad could not be created: ${videoAdError}`,
      };
    }

    // Add summary message for partial success
    if (hasCreatedAds && (imageAdError || videoAdError)) {
      const successCount = (imageAdId ? 1 : 0) + (videoAdId ? 1 : 0);
      const totalCount = (effectiveHasImages ? 1 : 0) + (effectiveHasVideos ? 1 : 0);
      issues.summary = `Campaign created partially. ${successCount} of ${totalCount} ad(s) created.`;
    }

    return NextResponse.json({
      success: true,
      campaign: {
        ...campaign,
        metaCampaignId,
        imageAdSetId,
        videoAdSetId,
      },
      ads: syncedAds.length > 0 ? syncedAds : ads,
      synced: syncedAds.length > 0,
      adErrors: adErrors.length > 0 ? adErrors : undefined,
      videoUploadErrors: videoUploadErrors.length > 0 ? videoUploadErrors : undefined,
      issues: Object.keys(issues).length > 0 ? issues : undefined,
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating campaign:', error);

    if (error instanceof MetaApiError) {
      return NextResponse.json(
        {
          error: 'Error al crear la campaña',
          details: error.message,
          code: error.errorCode,
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { error: 'Error al crear la campaña' },
      { status: 500 }
    );
  }
}
