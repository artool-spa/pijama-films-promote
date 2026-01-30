import { NextRequest, NextResponse } from 'next/server';
import { getAdById, markAdSynced, markAdError } from '@/models/ad';
import { getCampaignById, markCampaignSynced } from '@/models/campaign';
import { setPartnerMetaCampaigns, getPartnerMetaCampaignId } from '@/models/partner';
import {
  meta,
  createCampaign as createMetaCampaign,
  createAdSet as createMetaAdSet,
  uploadAdVideo,
  createAdCreative,
  createAd as createMetaAd,
  getAdPreview,
  buildTargeting,
  MetaApiError,
  MetaAdPreviewFormat,
} from '#meta';
import { getPartnerFromRequest, canManageCampaign } from '@/lib/auth';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/meta/ads/[id]/preview
 * Generate an ad preview from Meta
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const { id } = await params;
  const { searchParams } = new URL(req.url);

  const format = (searchParams.get('format') || 'MOBILE_FEED_STANDARD') as MetaAdPreviewFormat;

  try {
    const ad = await getAdById(id);
    if (!ad) {
      return NextResponse.json({ error: 'Anuncio no encontrado' }, { status: 404 });
    }

    // If ad doesn't have a Meta ID, we need to create it first
    if (!ad.metaAdId) {
      // Check if we have Page ID configured
      if (!meta.pageId) {
        return NextResponse.json(
          { error: 'META_PAGE_ID no está configurado. Se requiere para crear anuncios.' },
          { status: 400 }
        );
      }

      const campaign = await getCampaignById(ad.campaignId);
      if (!campaign) {
        return NextResponse.json(
          { error: 'Campaña no encontrada' },
          { status: 404 }
        );
      }

      // Check access permissions
      const accessCheck = canManageCampaign(partner, campaign.partnerId);
      if (!accessCheck.allowed) {
        return NextResponse.json(
          { error: accessCheck.reason || 'No autorizado' },
          { status: 403 }
        );
      }

      // Get the Meta campaign ID based on objective
      let metaCampaignId = getPartnerMetaCampaignId(campaign.partner, campaign.objective);

      // If no Meta campaign exists for this objective, create it
      if (!metaCampaignId) {
        const objective = campaign.objective === 'CONVERSIONS'
          ? 'OUTCOME_SALES'
          : 'OUTCOME_TRAFFIC';

        const metaCampaignName = `${campaign.partner.name} - ${campaign.objective === 'CONVERSIONS' ? 'Conversiones' : 'Landing Page Views'}`;

        const newMetaCampaign = await createMetaCampaign(meta, {
          name: metaCampaignName,
          objective,
          status: 'PAUSED',
        });

        // Update the partner with the new Meta campaign ID
        if (campaign.objective === 'CONVERSIONS') {
          await setPartnerMetaCampaigns(
            campaign.partner.id,
            newMetaCampaign.id,
            campaign.partner.metaLandingPageCampaignId
          );
        } else {
          await setPartnerMetaCampaigns(
            campaign.partner.id,
            campaign.partner.metaConversionsCampaignId,
            newMetaCampaign.id
          );
        }

        metaCampaignId = newMetaCampaign.id;
      }

      // Ensure campaign is synced to Meta (as AdSet)
      let metaAdSetId = campaign.metaAdSetId;
      if (!metaAdSetId) {
        // Build targeting using audience configuration
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

        const metaAdSet = await createMetaAdSet(meta, {
          name: campaign.name,
          campaign_id: metaCampaignId,
          status: 'PAUSED',
          daily_budget: campaign.budgetType === 'DAILY' ? Math.round(campaign.budget * 100) : undefined,
          lifetime_budget: campaign.budgetType === 'LIFETIME' ? Math.round(campaign.budget * 100) : undefined,
          start_time: campaign.startDate.toISOString(),
          end_time: campaign.endDate?.toISOString(),
          billing_event: 'IMPRESSIONS',
          optimization_goal: 'OFFSITE_CONVERSIONS',
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          targeting,
        });
        await markCampaignSynced(campaign.id, metaAdSet.id);
        metaAdSetId = metaAdSet.id;
      }

      // Upload media and create creative
      // For array-based ads, use first headline/body and first media
      let creativeId: string;
      try {
        const headline = ad.headlines[0] || 'Sin título';
        const body = ad.bodies[0] || '';
        const description = ad.descriptions[0];

        if (ad.videos.length > 0) {
          const videoUrl = ad.videos[0].url;
          const { video_id } = await uploadAdVideo(meta, videoUrl, ad.name);
          const { creative_id } = await createAdCreative(meta, {
            name: `Creative - ${ad.name}`,
            pageId: meta.pageId!,
            linkUrl: ad.linkUrl,
            message: body,
            headline,
            description,
            callToAction: ad.callToAction,
            videoId: video_id,
          });
          creativeId = creative_id;
        } else if (ad.images.length > 0) {
          // Use image URL directly (no upload needed)
          const imageUrl = ad.images[0].url;
          const { creative_id } = await createAdCreative(meta, {
            name: `Creative - ${ad.name}`,
            pageId: meta.pageId!,
            linkUrl: ad.linkUrl,
            message: body,
            headline,
            description,
            callToAction: ad.callToAction,
            imageUrl,
          });
          creativeId = creative_id;
        } else {
          return NextResponse.json(
            { error: 'El anuncio debe tener al menos una imagen o video' },
            { status: 400 }
          );
        }

        // Create ad in Meta
        const metaAd = await createMetaAd(meta, {
          name: ad.name,
          adset_id: metaAdSetId,
          creative: { creative_id: creativeId },
          status: 'PAUSED',
        });

        await markAdSynced(ad.id, metaAd.id);

        // Get preview
        const preview = await getAdPreview(meta, creativeId, format);

        return NextResponse.json({
          adId: ad.id,
          metaAdId: metaAd.id,
          format,
          preview: preview.body,
        });
      } catch (error) {
        await markAdError(ad.id).catch(() => {});
        throw error;
      }
    }

    // Ad already has a Meta ID - just get the preview
    // We need to get the creative ID from the ad
    // For now, return a message that preview requires re-creation
    return NextResponse.json({
      adId: ad.id,
      metaAdId: ad.metaAdId,
      format,
      message: 'El anuncio ya está sincronizado. La vista previa requiere el ID del creative.',
    });
  } catch (error) {
    console.error('Error generating ad preview:', error);

    if (error instanceof MetaApiError) {
      return NextResponse.json(
        {
          error: 'Error al generar vista previa',
          details: error.message,
          code: error.errorCode,
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { error: 'Error al generar vista previa del anuncio' },
      { status: 500 }
    );
  }
}
