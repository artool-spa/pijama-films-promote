import { NextRequest, NextResponse } from 'next/server';
import { getVideosByFilmMuviUuid } from '@/models/video';
import { getPartnerFromRequest } from '@/lib/auth';

type RouteParams = { params: Promise<{ filmId: string }> };

/**
 * GET /api/films/[filmId]/videos
 * Get all videos for a film
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { filmId } = await params;
    const videos = await getVideosByFilmMuviUuid(filmId);

    return NextResponse.json(videos);
  } catch (error) {
    console.error('Error fetching videos:', error);
    return NextResponse.json(
      { error: 'Error al obtener videos' },
      { status: 500 }
    );
  }
}
