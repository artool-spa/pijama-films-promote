import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import logger from '@/lib/logger';
import { getVideoById, updateVideo, deleteVideo } from '@/models/video';
import { deleteFile } from '@/lib/storage';
import { getPartnerFromRequest } from '@/lib/auth';

const RenameSchema = z.object({ name: z.string().min(1).max(255) }).strict();

type RouteParams = { params: Promise<{ filmId: string; id: string }> };

/**
 * GET /api/films/[filmId]/videos/[id]
 * Get a specific video
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { filmId, id } = await params;
    const video = await getVideoById(id);

    if (!video) {
      return NextResponse.json({ error: 'Video no encontrado' }, { status: 404 });
    }

    // Verify the video belongs to the film
    if (video.filmMuviUuid !== filmId) {
      return NextResponse.json({ error: 'Video no encontrado' }, { status: 404 });
    }

    return NextResponse.json(video);
  } catch (error) {
    logger.error({ err: error }, 'Error fetching video');
    return NextResponse.json(
      { error: 'Error al obtener video' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/films/[filmId]/videos/[id]
 * Delete a video (only if not used by any ads)
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { filmId, id } = await params;
    const video = await getVideoById(id);

    if (!video) {
      return NextResponse.json({ error: 'Video no encontrado' }, { status: 404 });
    }

    // Verify the video belongs to the film
    if (video.filmMuviUuid !== filmId) {
      return NextResponse.json({ error: 'Video no encontrado' }, { status: 404 });
    }

    // Delete from database (will fail if used by ads)
    const deletedVideo = await deleteVideo(id);

    // Delete from storage (skip external MUVI assets)
    if (deletedVideo.storageKey !== 'external') {
      try {
        await deleteFile(deletedVideo.storageKey);
      } catch (storageError) {
        logger.error({ err: storageError }, 'Error deleting video from storage');
        // Don't fail the request if storage deletion fails - the DB record is already deleted
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Error deleting video');

    const message =
      error instanceof Error ? error.message : 'Error al eliminar video';

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/**
 * PATCH /api/films/[filmId]/videos/[id]
 * Rename a video
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { filmId, id } = await params;
    const body = await req.json();
    const { name } = RenameSchema.parse(body);

    const video = await getVideoById(id);
    if (!video) {
      return NextResponse.json({ error: 'Video no encontrado' }, { status: 404 });
    }

    if (video.filmMuviUuid !== filmId) {
      return NextResponse.json({ error: 'Video no encontrado' }, { status: 404 });
    }

    const updated = await updateVideo(id, { name });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error renaming video:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Nombre inválido', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Error al renombrar video' },
      { status: 500 }
    );
  }
}
