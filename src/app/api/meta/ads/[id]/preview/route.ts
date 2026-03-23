import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { getAdById, markAdSynced, markAdError } from '@/models/ad';
import { getCampaignById, markCampaignSynced } from '@/models/campaign';
import {
  meta,
  createCBOCampaignWithAdSets,
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
 *
 * If the campaign/ad isn't synced, creates the CBO structure first.
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

      // Ensure campaign has CBO structure in Meta
      let metaCampaignId = campaign.metaCampaignId;
      let imageAdSetId = campaign.imageAdSetId;
      let videoAdSetId = campaign.videoAdSetId;

      if (!metaCampaignId) {
        // Check what media types we have
        const hasImages = campaign.ads.some(a => a.images.length > 0);
        const hasVideos = campaign.ads.some(a => a.videos.length > 0);

        if (!hasImages && !hasVideos) {
          return NextResponse.json(
            { error: 'La campaña necesita al menos un anuncio con imagen o video' },
            { status: 400 }
          );
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

        const metaObjective = campaign.objective === 'CONVERSIONS'
          ? 'OUTCOME_SALES'
          : 'OUTCOME_TRAFFIC';

        const optimizationGoal = campaign.objective === 'CONVERSIONS'
          ? 'OFFSITE_CONVERSIONS'
          : 'LANDING_PAGE_VIEWS';

        // Create CBO Campaign with AdSets
        const cboResult = await createCBOCampaignWithAdSets(meta, {
          name: campaign.name,
          objective: metaObjective,
          budget: Math.round(campaign.budget * 100),
          budgetType: campaign.budgetType.toLowerCase() as 'daily' | 'lifetime',
          startTime: campaign.startDate.toISOString(),
          endTime: campaign.endDate?.toISOString(),
          targeting,
          promotedObject: campaign.objective === 'CONVERSIONS' && meta.pixelId
            ? { pixel_id: meta.pixelId, custom_event_type: 'PURCHASE' }
            : undefined,
          hasImages,
          hasVideos,
          optimizationGoal,
        });

        metaCampaignId = cboResult.campaignId;
        imageAdSetId = cboResult.imageAdSetId || null;
        videoAdSetId = cboResult.videoAdSetId || null;

        await markCampaignSynced(
          campaign.id,
          metaCampaignId,
          imageAdSetId || undefined,
          videoAdSetId || undefined
        );
      }

      // Determine which AdSet to use based on ad type
      const adSetId = ad.adSetType === 'VIDEO' ? videoAdSetId : imageAdSetId;
      if (!adSetId) {
        return NextResponse.json(
          { error: `No hay AdSet disponible para anuncios de tipo ${ad.adSetType}` },
          { status: 400 }
        );
      }

      // Upload media and create creative
      // For array-based ads, use first headline/body and first media
      let creativeId: string;
      try {
        const headline = ad.headlines[0] || 'Sin título';
        const body = ad.bodies[0] || '';
        const description = ad.descriptions[0];

        if (ad.adSetType === 'VIDEO' && ad.videos.length > 0) {
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
          adset_id: adSetId,
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
    logger.error({ err: error }, 'Error generating ad preview');

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
