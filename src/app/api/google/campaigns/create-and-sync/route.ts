import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createCampaign, getCampaignById, markGoogleCampaignSynced, markGoogleCampaignError } from '@/models/campaign';
import { createAdsForCampaign, getAdsByCampaignId, markGoogleAdSynced, markAdError } from '@/models/ad';
import { getPartnerById } from '@/models/partner';
import { getPartnerFromRequest } from '@/lib/auth';
import { publish } from '@/lib/events';
import {
  google,
  createYouTubeCampaignWithAdGroup,
  createVideoAd,
  buildGoogleTargeting,
  GoogleAdsApiError,
} from '#google';

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
  callToAction: z.string().default('LEARN_MORE'),
  linkUrl: z.string().url(),
  videoIds: z.array(z.string().cuid()).min(1).max(10), // YouTube campaigns require videos
});

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
  // YouTube specific
  googleBidStrategy: z.string().default('TARGET_CPV'),
  targetCpvMicros: z.number().int().positive().optional(), // In micros
  // Reuse existing campaign (for multi-platform sync)
  campaignId: z.string().cuid().optional(),
  // Ads
  ads: z.array(AdInputSchema).min(1),
  autoSync: z.boolean().default(true),
});

/**
 * POST /api/google/campaigns/create-and-sync
 * Create a YouTube campaign with ads and sync to Google Ads
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

    const targetPartner = await getPartnerById(partner.id);
    if (!targetPartner) {
      return NextResponse.json({ error: 'Partner no encontrado' }, { status: 404 });
    }

    // Step 1: Create or reuse campaign
    const { ads: adsData, autoSync, targetCpvMicros, campaignId: existingCampaignId, ...campaignData } = data;

    let campaign;
    let ads;

    if (existingCampaignId) {
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
        imageIds: [],
        videoIds: ad.videoIds,
        adSetType: 'VIDEO' as const,
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

    await emitProgress(data.filmMuviUuid, campaign.id, 'google_campaign', 40, 'Creando campana en Google Ads...');

    // Step 3: Build targeting and create campaign in Google Ads
    let googleCampaignId: string;
    let googleAdGroupId: string;

    try {
      const targeting = buildGoogleTargeting({
        countries: campaign.targetCountries,
        ageMin: campaign.targetAgeMin,
        ageMax: campaign.targetAgeMax,
        genders: campaign.targetGenders,
        filmGenres: campaign.filmGenres,
        includeBaseAudiences: campaign.includeBaseAudiences,
      });

      const metaCampaignName = `camp_${targetPartner.name}_${campaign.name}`;
      const googleResult = await createYouTubeCampaignWithAdGroup(google, {
        name: metaCampaignName,
        budget: campaign.budget,
        budgetType: campaign.budgetType === 'DAILY' ? 'DAILY' : 'TOTAL',
        startDate: campaign.startDate.toISOString().split('T')[0],
        endDate: campaign.endDate?.toISOString().split('T')[0],
        biddingStrategy: data.googleBidStrategy,
        targetCpvMicros: targetCpvMicros ? BigInt(targetCpvMicros) : undefined,
        targeting,
      });

      googleCampaignId = googleResult.campaignResourceName;
      googleAdGroupId = googleResult.adGroupResourceName;

      await emitProgress(data.filmMuviUuid, campaign.id, 'google_adgroup', 60, 'Campana y grupo de anuncios creados en Google');

      await markGoogleCampaignSynced(campaign.id, googleCampaignId, googleAdGroupId);
    } catch (error) {
      console.error('Error syncing campaign to Google Ads:', error);
      await markGoogleCampaignError(campaign.id).catch(() => {});

      let syncError = 'Error al sincronizar con Google Ads';
      let syncErrorDetails: unknown = undefined;
      if (error instanceof GoogleAdsApiError) {
        syncError = error.message;
        syncErrorDetails = {
          code: error.errorCode,
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

    // Step 4: Create video ads in Google Ads (one per format per ad)
    const ALL_YOUTUBE_FORMATS = ['IN_STREAM_SKIPPABLE', 'IN_STREAM_NON_SKIPPABLE', 'IN_FEED', 'BUMPER', 'SHORTS'] as const;
    const syncedAds: typeof ads = [];
    const adErrors: Array<{ adId: string; error: string }> = [];

    for (const ad of ads) {
      // Use the first video for the ad
      const video = ad.videos[0];
      if (!video) {
        adErrors.push({ adId: ad.id, error: 'No video found for this ad' });
        continue;
      }

      // Use youtubeVideoId if available, otherwise use a placeholder
      const youtubeVideoId = video.metaVideoId || video.id; // metaVideoId might store YouTube ID too
      let firstGoogleAdResourceName: string | undefined;

      for (const adFormat of ALL_YOUTUBE_FORMATS) {
        try {
          await emitProgress(data.filmMuviUuid, campaign.id, 'video_ad', 75, `Creando anuncio: ${ad.name} (${adFormat})...`);

          const googleAd = await createVideoAd(google, {
            name: `${ad.name} - ${adFormat}`,
            adGroupResourceName: googleAdGroupId,
            youtubeVideoId,
            adFormat,
            headline: ad.headlines[0],
            description1: ad.bodies[0]?.substring(0, 90),
            description2: ad.bodies[1]?.substring(0, 90),
            finalUrl: ad.linkUrl,
            callToAction: ad.callToAction,
          });

          // Store the first synced ad resource name on the local ad record
          if (!firstGoogleAdResourceName) {
            firstGoogleAdResourceName = googleAd.resourceName;
            await markGoogleAdSynced(ad.id, googleAd.resourceName, adFormat);
          }
        } catch (error) {
          const errorMsg = error instanceof GoogleAdsApiError ? error.message : `Error creating ${adFormat} ad`;
          console.error(`Failed to create Google ad (${adFormat}) for ${ad.id}:`, error);
          adErrors.push({ adId: ad.id, error: errorMsg });
        }
      }

      if (firstGoogleAdResourceName) {
        syncedAds.push({ ...ad, googleAdId: firstGoogleAdResourceName });
      } else {
        await markAdError(ad.id).catch(() => {});
      }
    }

    if (syncedAds.length > 0) {
      await emitProgress(data.filmMuviUuid, campaign.id, 'complete', 100, 'Campana de YouTube creada exitosamente!');
    }

    return NextResponse.json({
      success: true,
      campaign: {
        ...campaign,
        googleCampaignId,
        googleAdGroupId,
      },
      ads: syncedAds.length > 0 ? syncedAds : ads,
      synced: syncedAds.length > 0,
      adErrors: adErrors.length > 0 ? adErrors : undefined,
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating Google campaign:', error);

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
