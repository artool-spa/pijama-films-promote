import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import {
  getPartnerById,
  updatePartner,
  deletePartner,
  PartnerUpdateSchema,
} from '@/models/partner';
import { getPartnerFromRequest } from '@/lib/auth';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/partners/[id]
 * Get a partner by ID
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const authenticatedPartner = await getPartnerFromRequest(req);
  if (!authenticatedPartner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const partner = await getPartnerById(id);

    if (!partner) {
      return NextResponse.json(
        { error: 'Partner no encontrado' },
        { status: 404 }
      );
    }

    return NextResponse.json(partner);
  } catch (error) {
    logger.error({ err: error }, 'Error fetching partner');
    return NextResponse.json(
      { error: 'Error al obtener el partner' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/partners/[id]
 * Update a partner
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const authenticatedPartner = await getPartnerFromRequest(req);
  if (!authenticatedPartner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await req.json();

    const result = PartnerUpdateSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: result.error.flatten() },
        { status: 400 }
      );
    }

    const partner = await updatePartner(id, result.data);

    return NextResponse.json(partner);
  } catch (error) {
    logger.error({ err: error }, 'Error updating partner');
    return NextResponse.json(
      { error: 'Error al actualizar el partner' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/partners/[id]
 * Delete a partner (only if they have no campaigns)
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const authenticatedPartner = await getPartnerFromRequest(req);
  if (!authenticatedPartner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { id } = await params;
    await deletePartner(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Error deleting partner');

    const message =
      error instanceof Error ? error.message : 'Error al eliminar el partner';

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
