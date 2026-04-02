import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { getAdById, updateAd, deleteAd, AdUpdateSchema } from '@/models/ad';
import { getPartnerFromRequest } from '@/lib/auth';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/meta/ads/[id]
 * Get an ad by ID
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const ad = await getAdById(id);

    if (!ad) {
      return NextResponse.json({ error: 'Anuncio no encontrado' }, { status: 404 });
    }

    return NextResponse.json(ad);
  } catch (error) {
    logger.error({ err: error }, 'Error fetching ad');
    return NextResponse.json(
      { error: 'Error al obtener el anuncio' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/meta/ads/[id]
 * Update an ad
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await req.json();

    const result = AdUpdateSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: result.error.flatten() },
        { status: 400 }
      );
    }

    const ad = await updateAd(id, result.data);

    return NextResponse.json(ad);
  } catch (error) {
    logger.error({ err: error }, 'Error updating ad');
    return NextResponse.json(
      { error: 'Error al actualizar el anuncio' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/meta/ads/[id]
 * Delete an ad (only if in DRAFT status)
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { id } = await params;
    await deleteAd(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Error deleting ad');

    const message =
      error instanceof Error ? error.message : 'Error al eliminar el anuncio';

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
