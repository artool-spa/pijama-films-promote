import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { createAd } from '@/models/ad';
import { AdCreateSchema } from '@/models/ad';
import { getPartnerFromRequest, canManageCampaign } from '@/lib/auth';
import { getCampaignById } from '@/models/campaign';
import { assertFilmAccessible, filmAccessResponse } from '@/lib/assets/film-access';
import { adMediaResponse } from '@/lib/assets/ad-media-response';

/**
 * POST /api/google/ads
 * Create a Google ad locally (DRAFT status)
 */
export async function POST(req: NextRequest) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const body = await req.json();

    const result = AdCreateSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Datos invalidos', details: result.error.flatten() },
        { status: 400 }
      );
    }

    // The campaign must be the session partner's: an ad is attached to it.
    const campaign = await getCampaignById(result.data.campaignId);
    if (!campaign || !canManageCampaign(partner, campaign.partnerId).allowed) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }
    await assertFilmAccessible(campaign.filmMuviUuid);

    const ad = await createAd(result.data);

    return NextResponse.json({ success: true, ad }, { status: 201 });
  } catch (error) {
    const denied = filmAccessResponse(error);
    if (denied) return denied;
    const mediaDenied = adMediaResponse(error);
    if (mediaDenied) return mediaDenied;

    logger.error({ err: error }, 'Error creating Google ad');
    return NextResponse.json(
      { error: 'Error al crear el anuncio' },
      { status: 500 }
    );
  }
}
