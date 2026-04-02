import { NextRequest, NextResponse } from 'next/server';
import { getImageById, setImageArchived } from '@/models/image';
import { getPartnerFromRequest } from '@/lib/auth';

type RouteParams = { params: Promise<{ filmId: string; id: string }> };

/**
 * POST /api/films/[filmId]/images/[id]/archive
 * Archive an image
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { filmId, id } = await params;
    const image = await getImageById(id);

    if (!image || image.filmMuviUuid !== filmId) {
      return NextResponse.json({ error: 'Imagen no encontrada' }, { status: 404 });
    }

    const updated = await setImageArchived(id, true);
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error archiving image:', error);
    return NextResponse.json({ error: 'Error al archivar imagen' }, { status: 500 });
  }
}

/**
 * DELETE /api/films/[filmId]/images/[id]/archive
 * Unarchive an image
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { filmId, id } = await params;
    const image = await getImageById(id);

    if (!image || image.filmMuviUuid !== filmId) {
      return NextResponse.json({ error: 'Imagen no encontrada' }, { status: 404 });
    }

    const updated = await setImageArchived(id, false);
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error unarchiving image:', error);
    return NextResponse.json({ error: 'Error al desarchivar imagen' }, { status: 500 });
  }
}
