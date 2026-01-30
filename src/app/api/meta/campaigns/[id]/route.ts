import { NextRequest, NextResponse } from 'next/server';
import {
  getCampaignById,
  updateCampaign,
  deleteCampaign,
  CampaignUpdateSchema,
} from '@/models/campaign';
import { getPartnerFromRequest } from '@/lib/auth';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/meta/campaigns/[id]
 * Get a campaign by ID
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const campaign = await getCampaignById(id);

    if (!campaign) {
      return NextResponse.json(
        { error: 'Campaña no encontrada' },
        { status: 404 }
      );
    }

    return NextResponse.json(campaign);
  } catch (error) {
    console.error('Error fetching campaign:', error);
    return NextResponse.json(
      { error: 'Error al obtener la campaña' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/meta/campaigns/[id]
 * Update a campaign
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await req.json();

    const result = CampaignUpdateSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: result.error.flatten() },
        { status: 400 }
      );
    }

    const campaign = await updateCampaign(id, result.data);

    return NextResponse.json(campaign);
  } catch (error) {
    console.error('Error updating campaign:', error);
    return NextResponse.json(
      { error: 'Error al actualizar la campaña' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/meta/campaigns/[id]
 * Delete a campaign (only if in DRAFT status)
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { id } = await params;
    await deleteCampaign(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting campaign:', error);

    const message =
      error instanceof Error ? error.message : 'Error al eliminar la campaña';

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
