import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { IdSchema } from '@/lib/firestore';
import logger from '@/lib/logger';
import { createCampaign, updateCampaign, getCampaignById, markCampaignPendingAssets } from '@/models/campaign';
import { createAdsForCampaign } from '@/models/ad';
import { getPartnerById } from '@/models/partner';
import { getPartnerFromRequest } from '@/lib/auth';
import { publish } from '@/lib/events';
import { MetaApiError } from '#meta';
import { areMetaAssetsReady, syncCampaignToMeta } from '@/lib/campaigns/sync';
import { toFriendlyCampaignError } from '@/lib/campaigns/error-messages';
import { validateCampaignBudget } from '@/lib/campaigns/budget-validation';

// Helper to publish campaign progress
async function emitProgress(filmId: string, campaignId: string, step: string, progress: number, message: string) {
  await publish(filmId, {
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
  callToAction: z.string().default('WATCH_MORE'),
  linkUrl: z.string().url(),
  imageIds: z.array(IdSchema).max(10).default([]),
  videoIds: z.array(IdSchema).max(10).default([]),
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
  // Platforms (array for multi-platform campaigns)
  platforms: z.array(z.enum(['META', 'GOOGLE'])).min(1).default(['META']),
  // Ads to create
  ads: z.array(AdInputSchema).min(1),
  // Auto-sync flag
  autoSync: z.boolean().default(true),
  // Optional draft ID to update existing draft instead of creating new
  draftId: IdSchema.optional(),
});

/**
 * POST /api/meta/campaigns/create-and-sync
 * Create a campaign with ads and automatically sync to Meta using CBO
 *
 * CBO (Campaign Budget Optimization) Structure:
 * - 1 Meta Campaign with budget at campaign level
 * - 1-2 AdSets (one for images, one for videos) - no individual budgets
 * - 1 dynamic creative ad per AdSet with all media/copy variants
 *
 * If videos are still uploading (no metaVideoId), the campaign is saved
 * with PENDING_ASSETS status and sync will complete via cron.
 */
export async function POST(req: NextRequest) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const result = CampaignWithAdsCreateSchema.safeParse(body);

    if (!result.success) {
      // Logged because this 400 is our own validation, not the platform's: it
      // reaches the producer as a generic message with no server-side trace.
      logger.warn({ details: result.error.flatten() }, 'Meta campaign payload rejected by validation');
      return NextResponse.json(
        { error: 'Invalid campaign data', details: result.error.flatten() },
        { status: 400 }
      );
    }

    const data = result.data;

    // Validate budget meets platform minimums
    const budgetCheck = validateCampaignBudget({
      budget: data.budget,
      platforms: data.platforms.includes('META') ? ['facebook'] : [],
      languages: 1,
      startDate: data.startDate.toISOString().split('T')[0],
      endDate: data.endDate ? data.endDate.toISOString().split('T')[0] : '',
    });
    if (!budgetCheck.valid) {
      return NextResponse.json(
        { error: budgetCheck.errorMessage },
        { status: 400 }
      );
    }

    // Verify the partner exists
    const targetPartner = await getPartnerById(partner.id);
    if (!targetPartner) {
      return NextResponse.json({ error: 'Partner not found' }, { status: 404 });
    }

    // Step 1: Create or update campaign locally (DRAFT status)
    const { ads: adsData, autoSync, platforms, draftId, ...campaignData } = data;

    let campaign;
    if (draftId) {
      // Update existing draft campaign
      const existing = await getCampaignById(draftId);
      if (!existing || existing.partnerId !== partner.id) {
        return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
      }
      await updateCampaign(draftId, {
        name: campaignData.name,
        budget: campaignData.budget,
        endDate: campaignData.endDate,
        language: campaignData.language,
        targetCountries: campaignData.targetCountries,
        targetAgeMin: campaignData.targetAgeMin,
        targetAgeMax: campaignData.targetAgeMax,
        targetGenders: campaignData.targetGenders,
        includeBaseAudiences: campaignData.includeBaseAudiences,
        filmGenres: campaignData.filmGenres,
        includeLgbtAudience: campaignData.includeLgbtAudience,
        draftFormState: null, // Clear draft form state
      });
      campaign = { ...existing, ...campaignData, id: draftId };
    } else {
      campaign = await createCampaign({
        ...campaignData,
        platforms: platforms,
        partnerId: partner.id,
        conversionEvent: 'VIEW_CONTENT', // Default for landing page views
      });
    }

    await emitProgress(data.filmMuviUuid, campaign.id, 'campaign', 10, 'Campaign saved locally');

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
        { error: 'At least one ad with an image or video is required' },
        { status: 400 }
      );
    }

    const ads = await createAdsForCampaign(campaign.id, adsToCreate);

    await emitProgress(data.filmMuviUuid, campaign.id, 'ads', 20, 'Ads saved locally');

    // If autoSync is disabled, return the draft campaign and ads
    if (!autoSync) {
      return NextResponse.json({
        success: true,
        campaign,
        ads,
        synced: false,
      }, { status: 201 });
    }

    // Step 3: Check if all video assets are ready for Meta
    const hasVideos = ads.some(ad => ad.videos.length > 0);
    if (hasVideos && !areMetaAssetsReady(ads)) {
      // Videos are still uploading — defer sync
      await markCampaignPendingAssets(campaign.id);

      await emitProgress(data.filmMuviUuid, campaign.id, 'pending_assets', 25,
        'Videos are still uploading. Sync will complete automatically.');

      await publish(data.filmMuviUuid, {
        type: 'campaign_error',
        campaignId: campaign.id,
        error: 'Videos are still uploading to Meta. Your campaign will sync automatically when they finish.',
      });

      return NextResponse.json({
        success: true,
        campaign,
        ads,
        synced: false,
        pendingAssets: true,
        message: 'Campaign saved. Your videos are still uploading — sync will finish automatically.',
      }, { status: 201 });
    }

    // Step 4: All assets ready — fetch full campaign with relations and sync
    const fullCampaign = await getCampaignById(campaign.id);
    if (!fullCampaign) {
      return NextResponse.json({ error: 'Campaign not found after creation' }, { status: 500 });
    }

    const syncResult = await syncCampaignToMeta(fullCampaign, targetPartner.name);

    if (syncResult.syncError) {
      await publish(data.filmMuviUuid, {
        type: 'campaign_error',
        campaignId: campaign.id,
        error: `Meta: ${syncResult.syncError}`,
      });
    }

    return NextResponse.json({
      success: true,
      campaign: {
        ...campaign,
        metaCampaignId: syncResult.metaCampaignId,
        imageAdSetId: syncResult.imageAdSetId,
        videoAdSetId: syncResult.videoAdSetId,
      },
      ads: syncResult.syncedAds.length > 0 ? syncResult.syncedAds : ads,
      synced: syncResult.synced,
      adErrors: syncResult.adErrors.length > 0 ? syncResult.adErrors : undefined,
      videoUploadErrors: syncResult.videoUploadErrors.length > 0 ? syncResult.videoUploadErrors : undefined,
      issues: syncResult.issues,
      syncError: syncResult.syncError,
      syncErrorDetails: syncResult.syncErrorDetails,
    }, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, 'Error creating campaign');

    if (error instanceof MetaApiError) {
      return NextResponse.json(
        {
          error: toFriendlyCampaignError(error, 'Meta'),
          details: error.message,
          code: error.errorCode,
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { error: 'Something went wrong while creating your campaign. Please try again, or contact support.' },
      { status: 500 }
    );
  }
}
