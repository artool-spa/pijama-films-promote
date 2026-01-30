import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createCampaign, markCampaignSynced, markCampaignError } from '@/models/campaign';
import { createAdsForCampaign, markAdSynced, markAdError } from '@/models/ad';
import { getPartnerById, setPartnerMetaCampaigns, getPartnerMetaCampaignId } from '@/models/partner';
import { getPartnerFromRequest } from '@/lib/auth';
import {
  meta,
  createCampaign as createMetaCampaign,
  createAdSet as createMetaAdSet,
  createDynamicCreativeAd,
  uploadAdVideo,
  buildTargeting,
  MetaApiError,
} from '#meta';

// Schema for ads included in campaign creation
const AdInputSchema = z.object({
  name: z.string().min(1).max(255),
  language: z.string().optional(),
  headlines: z.array(z.string().min(1).max(255)).min(1).max(5),
  bodies: z.array(z.string().min(1).max(2200)).min(1).max(5),
  descriptions: z.array(z.string().max(30)).max(5).default([]),
  callToAction: z.string().default('LEARN_MORE'),
  linkUrl: z.string().url(),
  imageIds: z.array(z.string().cuid()).max(10).default([]),
  videoIds: z.array(z.string().cuid()).max(10).default([]),
});

// Combined schema for campaign + ads + auto-sync
const CampaignWithAdsCreateSchema = z.object({
  // Campaign fields
  name: z.string().min(1).max(255),
  objective: z.enum(['CONVERSIONS', 'LANDING_PAGE_VIEW']).default('LANDING_PAGE_VIEW'),
  budget: z.number().positive(),
  budgetType: z.enum(['DAILY', 'LIFETIME']).default('LIFETIME'),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
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
 * Create a campaign with ads and automatically sync to Meta
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

    // Step 2: Create ads locally (DRAFT status)
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
      }));

    if (adsToCreate.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere al menos un anuncio con imagen o video' },
        { status: 400 }
      );
    }

    const ads = await createAdsForCampaign(campaign.id, adsToCreate);

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

    // Step 3: Sync campaign to Meta (create AdSet)
    let metaAdSetId: string;
    try {
      // Get or create Meta campaign for the objective
      let metaCampaignId = getPartnerMetaCampaignId(targetPartner, campaign.objective);

      if (!metaCampaignId) {
        const objective = campaign.objective === 'CONVERSIONS'
          ? 'OUTCOME_SALES'
          : 'OUTCOME_TRAFFIC';

        const metaCampaignName = `${targetPartner.name} - ${campaign.objective === 'CONVERSIONS' ? 'Conversiones' : 'Landing Page Views'}`;

        const newMetaCampaign = await createMetaCampaign(meta, {
          name: metaCampaignName,
          objective,
          status: 'PAUSED',
        });

        // Update partner with new Meta campaign ID
        if (campaign.objective === 'CONVERSIONS') {
          await setPartnerMetaCampaigns(
            targetPartner.id,
            newMetaCampaign.id,
            targetPartner.metaLandingPageCampaignId
          );
        } else {
          await setPartnerMetaCampaigns(
            targetPartner.id,
            targetPartner.metaConversionsCampaignId,
            newMetaCampaign.id
          );
        }

        metaCampaignId = newMetaCampaign.id;
      }

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

      // Log targeting for debugging
      console.log('[Meta] Built targeting:', JSON.stringify(targeting, null, 2));

      // Create AdSet in Meta with dynamic creative enabled
      const metaAdSet = await createMetaAdSet(meta, {
        name: campaign.name,
        campaign_id: metaCampaignId,
        status: 'PAUSED',
        daily_budget: campaign.budgetType === 'DAILY' ? Math.round(campaign.budget * 100) : undefined,
        lifetime_budget: campaign.budgetType === 'LIFETIME' ? Math.round(campaign.budget * 100) : undefined,
        start_time: campaign.startDate.toISOString(),
        end_time: campaign.endDate?.toISOString(),
        billing_event: 'IMPRESSIONS',
        optimization_goal: campaign.objective === 'CONVERSIONS' ? 'OFFSITE_CONVERSIONS' : 'LANDING_PAGE_VIEWS',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        targeting,
        promoted_object: campaign.objective === 'CONVERSIONS' && meta.pixelId
          ? { pixel_id: meta.pixelId, custom_event_type: 'PURCHASE' }
          : undefined,
        is_dynamic_creative: true, // Enable dynamic creative optimization
      });

      metaAdSetId = metaAdSet.id;
      await markCampaignSynced(campaign.id, metaAdSetId);
    } catch (error) {
      console.error('Error syncing campaign to Meta:', error);
      await markCampaignError(campaign.id).catch(() => {});

      // Get detailed error info
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

      // Return partial success - campaign and ads created locally
      return NextResponse.json({
        success: true,
        campaign,
        ads,
        synced: false,
        syncError,
        syncErrorDetails,
      }, { status: 201 });
    }

    // Step 4: Sync ads to Meta using Dynamic Creative
    const syncedAds = [];
    const adErrors = [];

    for (const ad of ads) {
      try {
        // Collect image URLs directly (no upload needed)
        const imageUrls: string[] = ad.images.map((image) => image.url);

        // Upload videos (or use existing metaVideoId) - videos still need upload
        const videoIds: string[] = [];
        for (const video of ad.videos) {
          try {
            if (video.metaVideoId) {
              videoIds.push(video.metaVideoId);
            } else {
              const uploaded = await uploadAdVideo(meta, video.url, video.name);
              videoIds.push(uploaded.video_id);
            }
          } catch (err) {
            console.error(`Failed to upload video ${video.id}:`, err);
          }
        }

        if (imageUrls.length === 0 && videoIds.length === 0) {
          throw new Error('No se pudo procesar ningún medio');
        }

        console.log('[Meta] Creating dynamic creative ad with:', {
          headlines: ad.headlines,
          bodies: ad.bodies,
          imageUrls,
          videoIds,
        });

        // Create dynamic creative ad using image URLs directly
        const metaAd = await createDynamicCreativeAd(meta, {
          name: ad.name,
          adsetId: metaAdSetId,
          pageId: meta.pageId!,
          linkUrl: ad.linkUrl,
          headlines: ad.headlines,
          bodies: ad.bodies,
          descriptions: ad.descriptions,
          callToAction: ad.callToAction,
          imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
          videoIds: videoIds.length > 0 ? videoIds : undefined,
        });

        if (!metaAd.ad_id) {
          throw new Error('Meta no devolvió un ID de anuncio');
        }

        // Update local ad with Meta ID
        await markAdSynced(ad.id, metaAd.ad_id);
        syncedAds.push({ ...ad, metaAdId: metaAd.ad_id });
      } catch (error) {
        console.error(`Error syncing ad ${ad.id} to Meta:`, error);
        await markAdError(ad.id).catch(() => {});
        adErrors.push({
          adId: ad.id,
          error: error instanceof MetaApiError ? error.message : 'Error al sincronizar anuncio',
        });
      }
    }

    return NextResponse.json({
      success: true,
      campaign: { ...campaign, metaAdSetId },
      ads: syncedAds,
      synced: true,
      adErrors: adErrors.length > 0 ? adErrors : undefined,
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
