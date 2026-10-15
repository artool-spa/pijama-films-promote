import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import {
  getCampaignById,
  updateCampaign,
  deleteCampaign,
  CampaignUpdateSchema,
} from '@/models/campaign';
import { getPartnerFromRequest, canManageCampaign } from '@/lib/auth';

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

    // 404 (not 403) for someone else's campaign: do not reveal that it exists.
    if (!campaign || !canManageCampaign(partner, campaign.partnerId).allowed) {
      return NextResponse.json(
        { error: 'Campaña no encontrada' },
        { status: 404 }
      );
    }

    return NextResponse.json(campaign);
  } catch (error) {
    logger.error({ err: error }, 'Error fetching campaign');
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

    const existing = await getCampaignById(id);
    if (!existing || !canManageCampaign(partner, existing.partnerId).allowed) {
      return NextResponse.json(
        { error: 'Campaña no encontrada' },
        { status: 404 }
      );
    }

    const campaign = await updateCampaign(id, result.data);

    return NextResponse.json(campaign);
  } catch (error) {
    logger.error({ err: error }, 'Error updating campaign');
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
    const existing = await getCampaignById(id);
    if (!existing || !canManageCampaign(partner, existing.partnerId).allowed) {
      return NextResponse.json(
        { error: 'Campaña no encontrada' },
        { status: 404 }
      );
    }

    await deleteCampaign(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Error deleting campaign');

    const message =
      error instanceof Error ? error.message : 'Error al eliminar la campaña';

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
