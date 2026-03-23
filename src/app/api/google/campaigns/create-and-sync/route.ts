import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import logger from '@/lib/logger';
import { createCampaign, updateCampaign, getCampaignById, markCampaignPendingAssets } from '@/models/campaign';
import { createAdsForCampaign, getAdsByCampaignId } from '@/models/ad';
import { getPartnerById } from '@/models/partner';
import { getPartnerFromRequest } from '@/lib/auth';
import { publish } from '@/lib/events';
import { GoogleAdsApiError } from '#google';
import { areGoogleImageAssetsReady, syncCampaignToGoogle } from '@/lib/campaigns/sync';
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

// Schema for ads included in Google campaign creation
const AdInputSchema = z.object({
  name: z.string().min(1).max(255),
  headlines: z.array(z.string().min(1).max(255)).min(1).max(5),
  bodies: z.array(z.string().min(1).max(2200)).min(1).max(5),
  descriptions: z.array(z.string().max(90)).max(5).default([]),
  callToAction: z.string().default('WATCH_MORE'),
  linkUrl: z.string().url(),
  imageIds: z.array(z.string().cuid()).max(10).default([]),
  videoIds: z.array(z.string().cuid()).max(10).default([]),
}).refine(
  data => data.imageIds.length > 0 || data.videoIds.length > 0,
  { message: 'At least one image or video is required' }
);

// Combined schema for Google campaign + ads + auto-sync
const GoogleCampaignWithAdsCreateSchema = z.object({
  name: z.string().min(1).max(255),
  objective: z.enum(['CONVERSIONS', 'LANDING_PAGE_VIEW']).default('LANDING_PAGE_VIEW'),
  budget: z.number().positive(),
  budgetType: z.enum(['DAILY', 'LIFETIME']).default('LIFETIME'),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
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
  // Google Ads specific
  googleBidStrategy: z.string().default('MAXIMIZE_CLICKS'),
  targetCpvMicros: z.number().int().positive().optional(), // In micros
  // Reuse existing campaign (for multi-platform sync)
  campaignId: z.string().cuid().optional(),
  // Ads
  ads: z.array(AdInputSchema).min(1),
  autoSync: z.boolean().default(true),
  // Optional draft ID to update existing draft instead of creating new
  draftId: z.string().cuid().optional(),
});

/**
 * POST /api/google/campaigns/create-and-sync
 * Create a YouTube campaign with ads and sync to Google Ads
 *
 * If videos are still uploading to YouTube (no youtubeVideoId), the campaign
 * is saved with PENDING_ASSETS status and sync will complete via cron.
 */
export async function POST(req: NextRequest) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const result = GoogleCampaignWithAdsCreateSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Datos invalidos', details: result.error.flatten() },
        { status: 400 }
      );
    }

    const data = result.data;

    // Validate budget meets platform minimums
    const budgetCheck = validateCampaignBudget({
      budget: data.budget,
      platforms: ['google'],
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

    const targetPartner = await getPartnerById(partner.id);
    if (!targetPartner) {
      return NextResponse.json({ error: 'Partner no encontrado' }, { status: 404 });
    }

    // Step 1: Create or reuse campaign
    const { ads: adsData, autoSync, targetCpvMicros, campaignId: existingCampaignId, draftId, ...campaignData } = data;

    let campaign;
    let ads;

    if (draftId && !existingCampaignId) {
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

      await emitProgress(data.filmMuviUuid, campaign.id, 'campaign', 10, 'Draft campaign updated');

      // Create ads locally (DRAFT)
      const adsToCreate = adsData.map(ad => ({
        name: ad.name,
        headlines: ad.headlines,
        bodies: ad.bodies,
        descriptions: ad.descriptions,
        callToAction: ad.callToAction,
        linkUrl: ad.linkUrl,
        imageIds: ad.imageIds,
        videoIds: ad.videoIds,
        adSetType: 'IMAGE' as const,
      }));

      ads = await createAdsForCampaign(campaign.id, adsToCreate);
      await emitProgress(data.filmMuviUuid, campaign.id, 'ads', 20, 'Ads saved locally');
    } else if (existingCampaignId) {
      // Reuse existing campaign (multi-platform: Meta campaign already created)
      const existing = await getCampaignById(existingCampaignId);
      if (!existing) {
        return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 });
      }
      campaign = existing;
      ads = await getAdsByCampaignId(existingCampaignId);
      await emitProgress(data.filmMuviUuid, campaign.id, 'campaign', 10, 'Usando campaña existente para Google Ads');
    } else {
      // Create new campaign locally (DRAFT, platforms=[GOOGLE])
      campaign = await createCampaign({
        ...campaignData,
        platforms: ['GOOGLE'],
        partnerId: partner.id,
        conversionEvent: 'VIEW_CONTENT',
        targetCpvMicros: targetCpvMicros ? BigInt(targetCpvMicros) : undefined,
      });

      await emitProgress(data.filmMuviUuid, campaign.id, 'campaign', 10, 'Campana guardada localmente');

      // Step 2: Create ads locally (DRAFT)
      const adsToCreate = adsData.map(ad => ({
        name: ad.name,
        headlines: ad.headlines,
        bodies: ad.bodies,
        descriptions: ad.descriptions,
        callToAction: ad.callToAction,
        linkUrl: ad.linkUrl,
        imageIds: ad.imageIds,
        videoIds: ad.videoIds,
        adSetType: 'IMAGE' as const,
      }));

      ads = await createAdsForCampaign(campaign.id, adsToCreate);
      await emitProgress(data.filmMuviUuid, campaign.id, 'ads', 20, 'Anuncios guardados localmente');
    }

    if (!autoSync) {
      return NextResponse.json({
        success: true,
        campaign,
        ads,
        synced: false,
      }, { status: 201 });
    }

    // Step 3: Check if image assets are available (images are ready immediately)
    if (!areGoogleImageAssetsReady(ads)) {
      // No images available — defer sync
      await markCampaignPendingAssets(campaign.id);

      await emitProgress(data.filmMuviUuid, campaign.id, 'pending_assets', 25,
        'No images available yet. Sync will complete automatically when assets are ready.');

      return NextResponse.json({
        success: true,
        campaign,
        ads,
        synced: false,
        pendingAssets: true,
        message: 'Campaña guardada. Las imágenes aún no están disponibles — la sincronización se completará automáticamente.',
      }, { status: 201 });
    }

    // Step 4: All assets ready — fetch full campaign with relations and sync
    const fullCampaign = await getCampaignById(campaign.id);
    if (!fullCampaign) {
      return NextResponse.json({ error: 'Campaign not found after creation' }, { status: 500 });
    }

    const syncResult = await syncCampaignToGoogle(fullCampaign, targetPartner.name, {
      googleBidStrategy: data.googleBidStrategy,
      targetCpvMicros: targetCpvMicros ? BigInt(targetCpvMicros) : undefined,
    });

    return NextResponse.json({
      success: true,
      campaign: {
        ...campaign,
        googleCampaignId: syncResult.googleCampaignId,
        googleAdGroupId: syncResult.googleAdGroupId,
      },
      ads: syncResult.syncedAds.length > 0 ? syncResult.syncedAds : ads,
      synced: syncResult.synced,
      adErrors: syncResult.adErrors.length > 0 ? syncResult.adErrors : undefined,
      syncError: syncResult.syncError,
      syncErrorDetails: syncResult.syncErrorDetails,
    }, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, 'Error creating Google campaign');

    if (error instanceof GoogleAdsApiError) {
      return NextResponse.json(
        {
          error: 'Error al crear la campana',
          details: error.message,
          code: error.errorCode,
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { error: 'Error al crear la campana' },
      { status: 500 }
    );
  }
}
