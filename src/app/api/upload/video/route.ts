import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import logger from '@/lib/logger';
import {
  uploadVideo,
  StorageValidationError,
  StorageUploadError,
} from '@/lib/storage';
import { createVideo } from '@/models/video';
import { getPartnerFromRequest } from '@/lib/auth';
import { validateVideoInBackground } from '@/lib/assets';

const VideoUploadQuerySchema = z.object({
  filmMuviUuid: z.string().min(1, 'filmMuviUuid es requerido'),
  name: z.string().min(1).max(255).optional(),
});

/**
 * POST /api/upload/video
 * Upload a video file to cloud storage and create database record
 *
 * Request: multipart/form-data with 'file' field
 * Query params: filmMuviUuid (required), name (optional)
 *
 * Response:
 * {
 *   id: string,
 *   filmMuviUuid: string,
 *   name: string,
 *   storageKey: string,
 *   url: string,
 *   mimeType: string,
 *   size: number,
 *   createdAt: string
 * }
 */
export async function POST(req: NextRequest) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    // Parse query parameters
    const { searchParams } = new URL(req.url);
    const queryResult = VideoUploadQuerySchema.safeParse({
      filmMuviUuid: searchParams.get('filmMuviUuid'),
      name: searchParams.get('name'),
    });

    if (!queryResult.success) {
      return NextResponse.json(
        { error: 'Parámetros inválidos', details: queryResult.error.flatten() },
        { status: 400 }
      );
    }

    const { filmMuviUuid, name: customName } = queryResult.data;

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'Archivo requerido' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const storageResult = await uploadVideo({
      buffer,
      mimeType: file.type,
      originalName: file.name,
    });

    // Create database record
    const video = await createVideo({
      filmMuviUuid,
      name: customName || file.name,
      originalUrl: file.name,
      storageKey: storageResult.storageKey,
      url: storageResult.publicUrl,
      mimeType: storageResult.mimeType,
      size: storageResult.size,
    });

    // Trigger background validation (dimensions, duration, platform eligibility)
    validateVideoInBackground(
      video.id,
      video.url,
      filmMuviUuid,
      undefined,
      undefined,
      undefined,
      storageResult.size,
    );

    return NextResponse.json(video, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, 'Error uploading video');

    if (error instanceof StorageValidationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    if (error instanceof StorageUploadError) {
      return NextResponse.json(
        { error: 'Error al subir video' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
