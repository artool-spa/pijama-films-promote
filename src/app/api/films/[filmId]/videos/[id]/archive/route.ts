import { NextRequest, NextResponse } from 'next/server';
import { getVideoById, setVideoArchived } from '@/models/video';
import { getPartnerFromRequest } from '@/lib/auth';

type RouteParams = { params: Promise<{ filmId: string; id: string }> };

/**
 * POST /api/films/[filmId]/videos/[id]/archive
 * Archive a video
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { filmId, id } = await params;
    const video = await getVideoById(id);

    if (!video || video.filmMuviUuid !== filmId) {
      return NextResponse.json({ error: 'Video no encontrado' }, { status: 404 });
    }

    const updated = await setVideoArchived(id, true);
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error archiving video:', error);
    return NextResponse.json({ error: 'Error al archivar video' }, { status: 500 });
  }
}

/**
 * DELETE /api/films/[filmId]/videos/[id]/archive
 * Unarchive a video
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { filmId, id } = await params;
    const video = await getVideoById(id);

    if (!video || video.filmMuviUuid !== filmId) {
      return NextResponse.json({ error: 'Video no encontrado' }, { status: 404 });
    }

    const updated = await setVideoArchived(id, false);
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error unarchiving video:', error);
    return NextResponse.json({ error: 'Error al desarchivar video' }, { status: 500 });
  }
}
