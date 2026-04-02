import prisma from '#prisma';
import { AssetStatus } from '@prisma/client';
import { z } from 'zod';

// ============================================================================
// VALIDATION SCHEMAS - INPUT (strict, no extra fields allowed)
// ============================================================================

export const ImageCreateSchema = z
  .object({
    filmMuviUuid: z.string().min(1),
    name: z.string().min(1).max(255),
    originalUrl: z.string().min(1).max(1024),
    storageKey: z.string().default('external'), // 'external' for MUVI assets
    url: z.string().url(),
    mimeType: z.string().min(1),
    size: z.number().int().nonnegative().default(0), // 0 for external assets
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .strict();

export const ImageUpdateSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .strict();

export type ImageCreateInput = z.infer<typeof ImageCreateSchema>;
export type ImageUpdateInput = z.infer<typeof ImageUpdateSchema>;

// ============================================================================
// VALIDATION SCHEMAS - OUTPUT (validate database results)
// ============================================================================

// Zod schema for AssetStatus enum
const AssetStatusSchema = z.enum(['PENDING', 'VALIDATING', 'READY', 'INVALID', 'ERROR']);

export const ImageSchema = z.object({
  id: z.string().cuid(),
  filmMuviUuid: z.string(),
  name: z.string(),
  originalUrl: z.string(),
  storageKey: z.string(),
  url: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  archived: z.boolean(),
  createdAt: z.coerce.date(),
  // Validation fields
  status: AssetStatusSchema,
  validatedAt: z.coerce.date().nullable(),
  validationError: z.string().nullable(),
  aspectRatio: z.string().nullable(),
  metaImageHash: z.string().nullable(),
  // Platform eligibility
  facebookEligible: z.boolean(),
  instagramEligible: z.boolean(),
  googleEligible: z.boolean(),
  eligibilityError: z.string().nullable(),
});

export type Image = z.infer<typeof ImageSchema>;

// Input validation helpers
const IdSchema = z.string().cuid();
const FilmMuviUuidSchema = z.string().min(1);

// ============================================================================
// QUERY FUNCTIONS
// ============================================================================

/**
 * Get image by ID
 */
export async function getImageById(id: string) {
  const validId = IdSchema.parse(id);

  const result = await prisma.image.findUnique({
    where: { id: validId },
  });

  if (!result) return null;

  return ImageSchema.parse(result);
}

/**
 * Get images by film MUVI UUID
 */
export async function getImagesByFilmMuviUuid(filmMuviUuid: string) {
  const validFilmMuviUuid = FilmMuviUuidSchema.parse(filmMuviUuid);

  const results = await prisma.image.findMany({
    where: { filmMuviUuid: validFilmMuviUuid, archived: false },
    orderBy: { createdAt: 'desc' },
  });

  return z.array(ImageSchema).parse(results);
}

/**
 * Get images by IDs
 */
export async function getImagesByIds(ids: string[]) {
  const validIds = z.array(IdSchema).parse(ids);

  const results = await prisma.image.findMany({
    where: { id: { in: validIds } },
  });

  return z.array(ImageSchema).parse(results);
}

/**
 * Get image by original URL (to check if already uploaded)
 */
export async function getImageByOriginalUrl(originalUrl: string, filmMuviUuid: string) {
  const validOriginalUrl = z.string().min(1).parse(originalUrl);
  const validFilmMuviUuid = FilmMuviUuidSchema.parse(filmMuviUuid);

  const result = await prisma.image.findFirst({
    where: {
      originalUrl: validOriginalUrl,
      filmMuviUuid: validFilmMuviUuid,
    },
  });

  if (!result) return null;

  return ImageSchema.parse(result);
}

// ============================================================================
// MUTATION FUNCTIONS
// ============================================================================

/**
 * Create a new image record
 */
export async function createImage(data: ImageCreateInput) {
  const validated = ImageCreateSchema.parse(data);

  const result = await prisma.image.create({
    data: validated,
  });

  return ImageSchema.parse(result);
}

/**
 * Update an existing image
 */
export async function updateImage(id: string, data: ImageUpdateInput) {
  const validId = IdSchema.parse(id);
  const validated = ImageUpdateSchema.parse(data);

  const result = await prisma.image.update({
    where: { id: validId },
    data: validated,
  });

  return ImageSchema.parse(result);
}

/**
 * Delete an image (only if not used by any ads)
 */
export async function deleteImage(id: string) {
  const validId = IdSchema.parse(id);

  const image = await prisma.image.findUnique({
    where: { id: validId },
    include: {
      _count: {
        select: { ads: true },
      },
    },
  });

  if (!image) {
    throw new Error('Image not found');
  }

  if (image._count.ads > 0) {
    throw new Error('Cannot delete an image that is being used by ads');
  }

  const result = await prisma.image.delete({
    where: { id: validId },
  });

  return ImageSchema.parse(result);
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Input schema for validation update
 */
const ImageValidationUpdateSchema = z.object({
  status: AssetStatusSchema,
  validatedAt: z.date().optional(),
  validationError: z.string().nullable().optional(),
  aspectRatio: z.string().nullable().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export type ImageValidationUpdate = z.infer<typeof ImageValidationUpdateSchema>;

/**
 * Input schema for eligibility update
 */
const ImageEligibilityUpdateSchema = z.object({
  facebookEligible: z.boolean(),
  instagramEligible: z.boolean(),
  googleEligible: z.boolean(),
  eligibilityError: z.string().nullable().optional(),
  metaImageHash: z.string().nullable().optional(),
});

export type ImageEligibilityUpdate = z.infer<typeof ImageEligibilityUpdateSchema>;

/**
 * Get images by film MUVI UUID with ad usage counts
 * @param archived - filter by archived state (default: false = active images only)
 */
export async function getImagesWithUsageByFilmMuviUuid(filmMuviUuid: string, archived = false) {
  const validFilmMuviUuid = FilmMuviUuidSchema.parse(filmMuviUuid);

  const results = await prisma.image.findMany({
    where: { filmMuviUuid: validFilmMuviUuid, archived },
    include: { _count: { select: { ads: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return results.map((result) => ({
    ...ImageSchema.parse(result),
    _count: { ads: result._count.ads },
  }));
}

export type ImageWithUsage = Awaited<ReturnType<typeof getImagesWithUsageByFilmMuviUuid>>[number];

/**
 * Get images by film MUVI UUID with optional status filter
 */
export async function getImagesByFilmMuviUuidWithStatus(
  filmMuviUuid: string,
  status?: AssetStatus
) {
  const validFilmMuviUuid = FilmMuviUuidSchema.parse(filmMuviUuid);

  const results = await prisma.image.findMany({
    where: {
      filmMuviUuid: validFilmMuviUuid,
      ...(status && { status }),
    },
    orderBy: { createdAt: 'desc' },
  });

  return z.array(ImageSchema).parse(results);
}

/**
 * Get only READY images for a film
 */
export async function getReadyImagesByFilmMuviUuid(filmMuviUuid: string) {
  return getImagesByFilmMuviUuidWithStatus(filmMuviUuid, 'READY');
}

/**
 * Update image validation status and metadata
 */
export async function updateImageValidation(id: string, data: ImageValidationUpdate) {
  const validId = IdSchema.parse(id);
  const validated = ImageValidationUpdateSchema.parse(data);

  const result = await prisma.image.update({
    where: { id: validId },
    data: {
      ...validated,
      validatedAt: validated.validatedAt || new Date(),
    },
  });

  return ImageSchema.parse(result);
}

/**
 * Update image platform eligibility
 */
export async function updateImageEligibility(id: string, data: ImageEligibilityUpdate) {
  const validId = IdSchema.parse(id);
  const validated = ImageEligibilityUpdateSchema.parse(data);

  const result = await prisma.image.update({
    where: { id: validId },
    data: validated,
  });

  return ImageSchema.parse(result);
}

/**
 * Set image status to VALIDATING
 */
export async function setImageValidating(id: string) {
  const validId = IdSchema.parse(id);

  const result = await prisma.image.update({
    where: { id: validId },
    data: { status: 'VALIDATING' },
  });

  return ImageSchema.parse(result);
}

/**
 * Set image archived state (idempotent)
 */
export async function setImageArchived(id: string, archived: boolean) {
  const validId = IdSchema.parse(id);

  const result = await prisma.image.update({
    where: { id: validId },
    data: { archived },
  });

  return ImageSchema.parse(result);
}
