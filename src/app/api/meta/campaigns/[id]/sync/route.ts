import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import {
  getCampaignById,
  markCampaignSynced,
  markCampaignError,
} from '@/models/campaign';
import {
  meta,
  createCBOCampaignWithAdSets,
  buildTargeting,
  MetaApiError,
} from '#meta';
import { getPartnerFromRequest, canManageCampaign } from '@/lib/auth';
import { describeCampaignError } from '@/lib/campaigns/error-messages';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/meta/campaigns/[id]/sync
 * Sync a campaign to Meta Ads API using CBO structure
 *
 * Creates:
 * - 1 Meta Campaign with budget at campaign level (CBO)
 * - 1-2 AdSets (one for images, one for videos) - no individual budgets
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const campaign = await getCampaignById(id);
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

    // If already synced, return the existing Meta IDs
    if (campaign.metaCampaignId) {
      return NextResponse.json({
        success: true,
        metaCampaignId: campaign.metaCampaignId,
        imageAdSetId: campaign.imageAdSetId,
        videoAdSetId: campaign.videoAdSetId,
        message: 'La campaña ya está sincronizada con Meta',
      });
    }

    // Check what media types we have in the campaign's ads
    const hasImages = campaign.ads.some(ad => ad.images.length > 0);
    const hasVideos = campaign.ads.some(ad => ad.videos.length > 0);

    if (!hasImages && !hasVideos) {
      return NextResponse.json(
        { error: 'La campaña necesita al menos un anuncio con imagen o video' },
        { status: 400 }
      );
    }

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

    // Map objective to Meta objective and optimization goal
    const metaObjective = campaign.objective === 'CONVERSIONS'
      ? 'OUTCOME_SALES'
      : 'OUTCOME_TRAFFIC';

    const optimizationGoal = campaign.objective === 'CONVERSIONS'
      ? 'OFFSITE_CONVERSIONS'
      : 'LANDING_PAGE_VIEWS';

    // Create CBO Campaign with AdSets in Meta
    const cboResult = await createCBOCampaignWithAdSets(meta, {
      name: campaign.name,
      objective: metaObjective,
      budget: Math.round(campaign.budget * 100), // Convert to cents
      budgetType: campaign.budgetType.toLowerCase() as 'daily' | 'lifetime',
      startTime: campaign.startDate.toISOString(),
      endTime: campaign.endDate?.toISOString(),
      targeting,
      promotedObject: campaign.objective === 'CONVERSIONS' && meta.pixelId
        ? { pixel_id: meta.pixelId, custom_event_type: 'PURCHASE' }
        : meta.pageId ? { page_id: meta.pageId } : undefined,
      hasImages,
      hasVideos,
      optimizationGoal,
      dsaBeneficiary: partner.name,
      dsaPayor: partner.name,
    });

    // Update local record with CBO Meta IDs
    const updated = await markCampaignSynced(
      id,
      cboResult.campaignId,
      cboResult.imageAdSetId,
      cboResult.videoAdSetId
    );

    return NextResponse.json({
      success: true,
      metaCampaignId: cboResult.campaignId,
      imageAdSetId: cboResult.imageAdSetId,
      videoAdSetId: cboResult.videoAdSetId,
      campaign: updated,
    });
  } catch (error) {
    logger.error({ err: error }, 'Error syncing campaign to Meta');

    const friendly = describeCampaignError(error, 'Meta');
    await markCampaignError(id, {
      message: friendly.body,
      details: {
        platform: 'META',
        title: friendly.title,
        suggestions: friendly.suggestions,
        retryable: friendly.retryable,
        rawErrorCode: error instanceof MetaApiError ? error.errorCode : undefined,
      },
    }).catch(() => {});

    if (error instanceof MetaApiError) {
      return NextResponse.json(
        {
          error: friendly.title,
          details: friendly.body,
          code: error.errorCode,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ error: friendly.body }, { status: 500 });
  }
}
