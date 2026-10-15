import { describeAvailabilityFailure } from '@/lib/muvi/availability';
import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { createCampaign, CampaignCreateSchema } from '@/models/campaign';
import { getPartnerFromRequest } from '@/lib/auth';

/**
 * POST /api/meta/campaigns
 * Create a new campaign
 */
export async function POST(req: NextRequest) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const body = await req.json();

    const result = CampaignCreateSchema.safeParse({
      ...body,
      // The owner is ALWAYS the authenticated partner. A partnerId sent by the
      // client is overwritten, never trusted (IDOR) and never probed, so the
      // response cannot reveal whether another partner exists.
      partnerId: partner.id,
    });
    if (!result.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: result.error.flatten() },
        { status: 400 }
      );
    }

    const campaign = await createCampaign(result.data);

    return NextResponse.json(campaign, { status: 201 });
  } catch (error) {
    const unavailable = describeAvailabilityFailure(error);
    if (unavailable) {
      return NextResponse.json(
        { error: unavailable.message, code: unavailable.code },
        { status: unavailable.status }
      );
    }

    logger.error({ err: error }, 'Error creating campaign');
    return NextResponse.json(
      { error: 'Error al crear la campaña' },
      { status: 500 }
    );
  }
}
