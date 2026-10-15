import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { getCampaignById, markGoogleCampaignSynced, markGoogleCampaignError } from '@/models/campaign';
import { getPartnerFromRequest, canManageCampaign } from '@/lib/auth';
import {
  google,
  createYouTubeCampaignWithAdGroup,
  buildGoogleTargeting,
  GoogleAdsApiError,
} from '#google';

/**
 * POST /api/google/campaigns/[id]/sync
 * Sync a local campaign to Google Ads
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const partner = await getPartnerFromRequest(request);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const campaign = await getCampaignById(id);
    // 404 (not 403) for someone else's campaign: do not reveal that it exists.
    if (!campaign || !canManageCampaign(partner, campaign.partnerId).allowed) {
      return NextResponse.json({ error: 'Campana no encontrada' }, { status: 404 });
    }

    if (!campaign.platforms.includes('GOOGLE')) {
      return NextResponse.json({ error: 'Esta campana no es de Google' }, { status: 400 });
    }

    if (campaign.googleCampaignId) {
      return NextResponse.json({ error: 'La campana ya esta sincronizada' }, { status: 400 });
    }

    // Build targeting
    const targeting = await buildGoogleTargeting(google, {
      countries: campaign.targetCountries,
      ageMin: campaign.targetAgeMin,
      ageMax: campaign.targetAgeMax,
      genders: campaign.targetGenders,
      filmGenres: campaign.filmGenres,
      includeBaseAudiences: campaign.includeBaseAudiences,
    });

    // Create campaign + ad group in Google Ads
    const result = await createYouTubeCampaignWithAdGroup(google, {
      name: `camp_${campaign.partner.name}_${campaign.name}`,
      budget: campaign.budget,
      budgetType: campaign.budgetType === 'DAILY' ? 'DAILY' : 'TOTAL',
      startDate: campaign.startDate.toISOString().split('T')[0],
      endDate: campaign.endDate?.toISOString().split('T')[0],
      biddingStrategy: campaign.googleBidStrategy || 'TARGET_CPV',
      targetCpvMicros: campaign.targetCpvMicros ?? undefined,
      targeting,
    });

    // Mark as synced
    await markGoogleCampaignSynced(
      campaign.id,
      result.campaignResourceName,
      result.adGroupResourceName
    );

    return NextResponse.json({
      success: true,
      googleCampaignId: result.campaignResourceName,
      googleAdGroupId: result.adGroupResourceName,
    });
  } catch (error) {
    logger.error({ err: error }, 'Error syncing to Google Ads');

    await markGoogleCampaignError(id).catch(() => {});

    if (error instanceof GoogleAdsApiError) {
      return NextResponse.json(
        {
          error: 'Error al sincronizar con Google Ads',
          details: error.message,
          code: error.errorCode,
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { error: 'Error al sincronizar con Google Ads' },
      { status: 500 }
    );
  }
}
