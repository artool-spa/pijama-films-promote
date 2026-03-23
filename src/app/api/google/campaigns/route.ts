import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { createCampaign } from '@/models/campaign';
import { getPartnerFromRequest } from '@/lib/auth';
import { CampaignCreateSchema } from '@/models/campaign';

/**
 * POST /api/google/campaigns
 * Create a Google campaign locally (DRAFT status)
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
      platforms: ['GOOGLE'],
      partnerId: partner.id,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: 'Datos invalidos', details: result.error.flatten() },
        { status: 400 }
      );
    }

    const campaign = await createCampaign(result.data);

    return NextResponse.json({ success: true, campaign }, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, 'Error creating Google campaign');
    return NextResponse.json(
      { error: 'Error al crear la campana' },
      { status: 500 }
    );
  }
}
