import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { deleteFile, StorageNotFoundError, StorageDeleteError } from '@/lib/storage';

type RouteParams = { params: Promise<{ key: string }> };

/**
 * DELETE /api/upload/[key]
 * Delete a file from cloud storage by its storage key
 *
 * The key should be URL-encoded if it contains special characters
 *
 * Response: { success: true }
 */
export async function DELETE(
  req: NextRequest,
  { params }: RouteParams
) {
  try {
    const { key } = await params;
    const storageKey = decodeURIComponent(key);

    await deleteFile(storageKey);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Error deleting file');

    if (error instanceof StorageNotFoundError) {
      return NextResponse.json(
        { error: 'Archivo no encontrado' },
        { status: 404 }
      );
    }

    if (error instanceof StorageDeleteError) {
      return NextResponse.json(
        { error: 'Error al eliminar archivo' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
