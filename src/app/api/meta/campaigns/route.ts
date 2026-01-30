import { NextRequest, NextResponse } from 'next/server';
import { createCampaign, CampaignCreateSchema } from '@/models/campaign';
import { getPartnerById } from '@/models/partner';
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

    // If no partnerId provided, use the authenticated partner
    if (!body.partnerId) {
      body.partnerId = partner.id;
    }

    // Verify the partner exists
    const targetPartner = await getPartnerById(body.partnerId);
    if (!targetPartner) {
      return NextResponse.json(
        { error: 'Partner no encontrado' },
        { status: 404 }
      );
    }

    const result = CampaignCreateSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: result.error.flatten() },
        { status: 400 }
      );
    }

    const campaign = await createCampaign(result.data);

    return NextResponse.json(campaign, { status: 201 });
  } catch (error) {
    console.error('Error creating campaign:', error);
    return NextResponse.json(
      { error: 'Error al crear la campaña' },
      { status: 500 }
    );
  }
}
