import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import {
  getCampaignById,
  updateCampaign,
  deleteCampaign,
  CampaignUpdateSchema,
} from '@/models/campaign';
import { getPartnerFromRequest, canManageCampaign } from '@/lib/auth';

/**
 * GET /api/google/campaigns/[id]
 * Get a Google campaign by ID
 */
export async function GET(
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

    return NextResponse.json({ campaign });
  } catch (error) {
    logger.error({ err: error }, 'Error fetching Google campaign');
    return NextResponse.json(
      { error: 'Error al obtener la campana' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/google/campaigns/[id]
 * Update a Google campaign
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const partner = await getPartnerFromRequest(request);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const existing = await getCampaignById(id);
    if (!existing || !canManageCampaign(partner, existing.partnerId).allowed) {
      return NextResponse.json({ error: 'Campana no encontrada' }, { status: 404 });
    }

    const parsed = CampaignUpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Datos invalidos', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const campaign = await updateCampaign(id, parsed.data);

    return NextResponse.json({ success: true, campaign });
  } catch (error) {
    logger.error({ err: error }, 'Error updating Google campaign');
    return NextResponse.json(
      { error: 'Error al actualizar la campana' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/google/campaigns/[id]
 * Delete a Google campaign (only DRAFT)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const partner = await getPartnerFromRequest(request);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const existing = await getCampaignById(id);
    if (!existing || !canManageCampaign(partner, existing.partnerId).allowed) {
      return NextResponse.json({ error: 'Campana no encontrada' }, { status: 404 });
    }

    const campaign = await deleteCampaign(id);
    return NextResponse.json({ success: true, campaign });
  } catch (error) {
    logger.error({ err: error }, 'Error deleting Google campaign');
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al eliminar la campana' },
      { status: 500 }
    );
  }
}
