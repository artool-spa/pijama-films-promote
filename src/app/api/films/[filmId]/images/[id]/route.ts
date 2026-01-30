import { NextRequest, NextResponse } from 'next/server';
import { getImageById, deleteImage } from '@/models/image';
import { deleteFile } from '@/lib/storage';
import { getPartnerFromRequest } from '@/lib/auth';

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
    console.error('Error fetching image:', error);
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

    // Delete from storage
    try {
      await deleteFile(deletedImage.storageKey);
    } catch (storageError) {
      console.error('Error deleting image from storage:', storageError);
      // Don't fail the request if storage deletion fails - the DB record is already deleted
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting image:', error);

    const message =
      error instanceof Error ? error.message : 'Error al eliminar imagen';

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
