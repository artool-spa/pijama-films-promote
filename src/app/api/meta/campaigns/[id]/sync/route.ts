import { NextRequest, NextResponse } from 'next/server';
import {
  getCampaignById,
  markCampaignSynced,
  markCampaignError,
} from '@/models/campaign';
import {
  setPartnerMetaCampaigns,
  getPartnerMetaCampaignId,
} from '@/models/partner';
import {
  meta,
  createCampaign as createMetaCampaign,
  createAdSet as createMetaAdSet,
  buildTargeting,
  MetaApiError,
} from '#meta';
import { getPartnerFromRequest, canManageCampaign } from '@/lib/auth';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/meta/campaigns/[id]/sync
 * Sync a campaign to Meta Ads API (creates Meta AdSet)
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

    // If already synced, return the existing Meta ID
    if (campaign.metaAdSetId) {
      return NextResponse.json({
        success: true,
        metaAdSetId: campaign.metaAdSetId,
        message: 'La campaña ya está sincronizada con Meta',
      });
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

    // Create AdSet in Meta (our Campaign maps to Meta's AdSet)
    const metaAdSet = await createMetaAdSet(meta, {
      name: campaign.name,
      campaign_id: metaCampaignId,
      status: 'PAUSED',
      daily_budget: campaign.budgetType === 'DAILY' ? Math.round(campaign.budget * 100) : undefined,
      lifetime_budget: campaign.budgetType === 'LIFETIME' ? Math.round(campaign.budget * 100) : undefined,
      start_time: campaign.startDate.toISOString(),
      end_time: campaign.endDate?.toISOString(),
      billing_event: campaign.billingEvent as 'IMPRESSIONS' | 'LINK_CLICKS' | 'APP_INSTALLS',
      optimization_goal: campaign.optimizationGoal as 'OFFSITE_CONVERSIONS' | 'LANDING_PAGE_VIEWS' | 'LINK_CLICKS' | 'REACH',
      bid_strategy: campaign.bidStrategy as 'LOWEST_COST_WITHOUT_CAP' | 'LOWEST_COST_WITH_BID_CAP' | 'COST_CAP',
      targeting,
      promoted_object: meta.pixelId
        ? {
            pixel_id: meta.pixelId,
            custom_event_type: campaign.conversionEvent as 'PURCHASE' | 'ADD_TO_CART' | 'VIEW_CONTENT' | 'LEAD',
          }
        : undefined,
    });

    // Update local record with Meta AdSet ID
    const updated = await markCampaignSynced(id, metaAdSet.id);

    return NextResponse.json({
      success: true,
      metaAdSetId: metaAdSet.id,
      campaign: updated,
    });
  } catch (error) {
    console.error('Error syncing campaign to Meta:', error);

    await markCampaignError(id).catch(() => {});

    if (error instanceof MetaApiError) {
      return NextResponse.json(
        {
          error: 'Error al sincronizar con Meta',
          details: error.message,
          code: error.errorCode,
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { error: 'Error al sincronizar la campaña' },
      { status: 500 }
    );
  }
}
