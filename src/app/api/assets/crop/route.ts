import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { IdSchema } from '@/lib/firestore';
import sharp from 'sharp';
import logger from '@/lib/logger';
import { getPartnerFromRequest } from '@/lib/auth';
import { assertFilmAccessible, filmAccessResponse } from '@/lib/assets/film-access';
import { getImageById, createImage } from '@/models/image';
import { uploadImage } from '@/lib/storage';
import { validateImageInBackground } from '@/lib/assets';
import { META_IMAGE_REQUIREMENTS } from '@/lib/assets/validation';

const CropRequestSchema = z.object({
  imageId: IdSchema,
  filmMuviUuid: z.string().min(1),
  crop: z.object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  targetAspectRatio: z.string().min(1),
});

/**
 * POST /api/assets/crop
 * Crop an existing image server-side using sharp and save as a new asset
 */
export async function POST(req: NextRequest) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parseResult = CropRequestSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const { imageId, filmMuviUuid, crop, targetAspectRatio } = parseResult.data;

    // Fetch the original image from DB
    const originalImage = await getImageById(imageId);
    if (!originalImage) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    if (originalImage.filmMuviUuid !== filmMuviUuid) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    // Ownership comes from the STORED film, before any download or upload.
    await assertFilmAccessible(originalImage.filmMuviUuid);

    // Validate minimum dimensions before doing any work
    if (crop.width < META_IMAGE_REQUIREMENTS.minWidth || crop.height < META_IMAGE_REQUIREMENTS.minHeight) {
      return NextResponse.json(
        {
          error: `Cropped image is too small. Minimum dimensions are ${META_IMAGE_REQUIREMENTS.minWidth}x${META_IMAGE_REQUIREMENTS.minHeight}px, but crop is ${crop.width}x${crop.height}px.`,
        },
        { status: 400 }
      );
    }

    // Download the original image
    const response = await fetch(originalImage.url);
    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to download original image' },
        { status: 500 }
      );
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer());

    // Clamp crop to actual image bounds (client rounding may overshoot by 1-2px)
    const metadata = await sharp(imageBuffer).metadata();
    const imgWidth = metadata.width ?? 0;
    const imgHeight = metadata.height ?? 0;
    crop.x = Math.min(crop.x, imgWidth - 1);
    crop.y = Math.min(crop.y, imgHeight - 1);
    crop.width = Math.min(crop.width, imgWidth - crop.x);
    crop.height = Math.min(crop.height, imgHeight - crop.y);

    // Crop with sharp
    const croppedBuffer = await sharp(imageBuffer)
      .extract({
        left: crop.x,
        top: crop.y,
        width: crop.width,
        height: crop.height,
      })
      .toBuffer();

    // Upload the cropped image
    const storageResult = await uploadImage({
      buffer: croppedBuffer,
      mimeType: originalImage.mimeType,
      originalName: `${originalImage.name}_cropped_${targetAspectRatio.replace(':', 'x')}`,
    });

    // Create a new image record
    const croppedName = `${originalImage.name} (${targetAspectRatio})`;
    const newImage = await createImage({
      filmMuviUuid,
      name: croppedName,
      originalUrl: originalImage.url,
      storageKey: storageResult.storageKey,
      url: storageResult.publicUrl,
      mimeType: storageResult.mimeType,
      size: storageResult.size,
      width: crop.width,
      height: crop.height,
    });

    // Trigger background validation
    validateImageInBackground(
      newImage.id,
      newImage.url,
      filmMuviUuid,
      crop.width,
      crop.height,
      storageResult.size
    );

    return NextResponse.json(newImage, { status: 201 });
  } catch (error) {
    const denied = filmAccessResponse(error);
    if (denied) return denied;

    logger.error({ err: error }, 'Error cropping image');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
