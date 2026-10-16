import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import logger from '@/lib/logger';
import { getImageById, updateImage, deleteImage } from '@/models/image';
import { deleteFile } from '@/lib/storage';
import { getPartnerFromRequest } from '@/lib/auth';
import { assertFilmAccessible, filmAccessResponse } from '@/lib/assets/film-access';

const RenameSchema = z.object({ name: z.string().min(1).max(255) }).strict();

type RouteParams = { params: Promise<{ filmId: string; id: string }> };

/**
 * GET /api/films/[filmId]/images/[id]
 * Get a specific image
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { filmId, id } = await params;
    await assertFilmAccessible(filmId);
    const image = await getImageById(id);

    if (!image) {
      return NextResponse.json({ error: 'Imagen no encontrada' }, { status: 404 });
    }

    // Verify the image belongs to the film
    if (image.filmMuviUuid !== filmId) {
      return NextResponse.json({ error: 'Imagen no encontrada' }, { status: 404 });
    }

    return NextResponse.json(image);
  } catch (error) {
    const denied = filmAccessResponse(error);
    if (denied) return denied;

    logger.error({ err: error }, 'Error fetching image');
    return NextResponse.json(
      { error: 'Error al obtener imagen' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/films/[filmId]/images/[id]
 * Delete an image (only if not used by any ads)
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { filmId, id } = await params;
    await assertFilmAccessible(filmId);
    const image = await getImageById(id);

    if (!image) {
      return NextResponse.json({ error: 'Imagen no encontrada' }, { status: 404 });
    }

    // Verify the image belongs to the film
    if (image.filmMuviUuid !== filmId) {
      return NextResponse.json({ error: 'Imagen no encontrada' }, { status: 404 });
    }

    // Delete from database (will fail if used by ads)
    const deletedImage = await deleteImage(id);

    // Delete from storage (skip external MUVI assets)
    if (deletedImage.storageKey !== 'external') {
      try {
        await deleteFile(deletedImage.storageKey);
      } catch (storageError) {
        logger.error({ err: storageError }, 'Error deleting image from storage');
        // Don't fail the request if storage deletion fails - the DB record is already deleted
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const denied = filmAccessResponse(error);
    if (denied) return denied;

    logger.error({ err: error }, 'Error deleting image');

    const message =
      error instanceof Error ? error.message : 'Error al eliminar imagen';

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/**
 * PATCH /api/films/[filmId]/images/[id]
 * Rename an image
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { filmId, id } = await params;
    await assertFilmAccessible(filmId);
    const body = await req.json();
    const { name } = RenameSchema.parse(body);

    const image = await getImageById(id);
    if (!image) {
      return NextResponse.json({ error: 'Imagen no encontrada' }, { status: 404 });
    }

    if (image.filmMuviUuid !== filmId) {
      return NextResponse.json({ error: 'Imagen no encontrada' }, { status: 404 });
    }

    const updated = await updateImage(id, { name });
    return NextResponse.json(updated);
  } catch (error) {
    const denied = filmAccessResponse(error);
    if (denied) return denied;

    console.error('Error renaming image:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Nombre inválido', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Error al renombrar imagen' },
      { status: 500 }
    );
  }
}
