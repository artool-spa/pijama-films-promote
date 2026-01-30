import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  meta,
  generateAdPreview,
  MetaApiError,
  MetaAdPreviewFormat,
} from '#meta';
import { getPartnerFromRequest } from '@/lib/auth';

// Validation schema for preview request
const PreviewRequestSchema = z.object({
  headline: z.string().min(1).max(255),
  description: z.string().max(500).optional(),
  primaryText: z.string().min(1).max(2200),
  linkUrl: z.string().url(),
  mediaUrl: z.string().url(),
  mediaType: z.enum(['IMAGE', 'VIDEO']),
  metaVideoId: z.string().optional(), // Required for video previews
  thumbnailUrl: z.string().url().optional(), // Thumbnail for video previews
  format: z.enum([
    'DESKTOP_FEED_STANDARD',
    'MOBILE_FEED_STANDARD',
    'INSTAGRAM_STANDARD',
    'INSTAGRAM_STORY',
  ]).default('MOBILE_FEED_STANDARD'),
});

/**
 * POST /api/meta/preview
 * Generate an ad preview without creating the ad in Meta.
 * Used during campaign creation to show how the ad will look.
 */
export async function POST(req: NextRequest) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  // Check if we have Page ID configured
  if (!meta.pageId) {
    return NextResponse.json(
      { error: 'META_PAGE_ID no está configurado. Se requiere para generar vistas previas.' },
      { status: 400 }
    );
  }

  try {
    const body = await req.json();
    const validationResult = PreviewRequestSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: 'Datos de solicitud inválidos',
          details: validationResult.error.issues,
        },
        { status: 400 }
      );
    }

    const { headline, description, primaryText, linkUrl, mediaUrl, mediaType, metaVideoId, thumbnailUrl, format } =
      validationResult.data;

    // For video previews, we need a Meta video ID
    if (mediaType === 'VIDEO' && !metaVideoId) {
      return NextResponse.json(
        {
          error: 'Video no disponible para vista previa',
          details: 'El video aún se está procesando. Intenta de nuevo en unos momentos o selecciona una imagen.',
          code: 'VIDEO_NOT_READY',
        },
        { status: 400 }
      );
    }

    // Build creative spec
    const creative = {
      pageId: meta.pageId,
      message: primaryText,
      headline,
      description,
      linkUrl,
      ...(mediaType === 'VIDEO'
        ? { metaVideoId, videoThumbnailUrl: thumbnailUrl || mediaUrl }
        : { imageUrl: mediaUrl }),
    };

    const preview = await generateAdPreview(
      meta,
      creative,
      format as MetaAdPreviewFormat
    );

    return NextResponse.json({
      preview: preview.body,
      format,
    });
  } catch (error) {
    console.error('Error generating ad preview:', error);

    if (error instanceof MetaApiError) {
      return NextResponse.json(
        {
          error: 'Error al generar vista previa',
          details: error.message,
          code: error.errorCode,
        },
        { status: 502 }
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Datos de solicitud inválidos',
          details: error.issues,
        },
        { status: 400 }
      );
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: 'Error al generar vista previa del anuncio', details: errorMessage },
      { status: 500 }
    );
  }
}
