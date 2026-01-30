import { NextRequest, NextResponse } from 'next/server';
import { getImagesByFilmMuviUuid } from '@/models/image';
import { getPartnerFromRequest } from '@/lib/auth';

type RouteParams = { params: Promise<{ filmId: string }> };

/**
 * GET /api/films/[filmId]/images
 * Get all images for a film
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { filmId } = await params;
    const images = await getImagesByFilmMuviUuid(filmId);

    return NextResponse.json(images);
  } catch (error) {
    console.error('Error fetching images:', error);
    return NextResponse.json(
      { error: 'Error al obtener imágenes' },
      { status: 500 }
    );
  }
}
