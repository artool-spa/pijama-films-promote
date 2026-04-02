import prisma from '#prisma';
import { AssetStatus } from '@prisma/client';
import { z } from 'zod';

// ============================================================================
// VALIDATION SCHEMAS - INPUT (strict, no extra fields allowed)
// ============================================================================

export const VideoCreateSchema = z
  .object({
    filmMuviUuid: z.string().min(1),
    name: z.string().min(1).max(255),
    originalUrl: z.string().min(1).max(1024),
    storageKey: z.string().default('external'), // 'external' for MUVI assets
    url: z.string(), // Can be URL or streaming URL (HLS)
    mimeType: z.string().min(1),
    size: z.number().int().nonnegative().default(0), // 0 for external assets
    duration: z.number().int().positive().optional(),
    thumbnailUrl: z.string().optional(),
  })
  .strict();

export const VideoUpdateSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    duration: z.number().int().positive().optional(),
    thumbnailUrl: z.string().url().optional(),
    metaVideoId: z.string().min(1).optional(),
  })
  .strict();

export type VideoCreateInput = z.infer<typeof VideoCreateSchema>;
export type VideoUpdateInput = z.infer<typeof VideoUpdateSchema>;

// ============================================================================
// VALIDATION SCHEMAS - OUTPUT (validate database results)
// ============================================================================

// Zod schema for AssetStatus enum
const AssetStatusSchema = z.enum(['PENDING', 'VALIDATING', 'READY', 'INVALID', 'ERROR']);

export const VideoSchema = z.object({
  id: z.string().cuid(),
  filmMuviUuid: z.string(),
  name: z.string(),
  originalUrl: z.string(),
  storageKey: z.string(),
  url: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
  duration: z.number().int().nullable(),
  thumbnailUrl: z.string().nullable(),
  metaVideoId: z.string().nullable(),
  archived: z.boolean(),
  createdAt: z.coerce.date(),
  // Validation fields
  status: AssetStatusSchema,
  validatedAt: z.coerce.date().nullable(),
  validationError: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  aspectRatio: z.string().nullable(),
  // Platform eligibility
  facebookEligible: z.boolean(),
  instagramEligible: z.boolean(),
  youtubeEligible: z.boolean(),
  youtubeVideoId: z.string().nullable(),
  eligibilityError: z.string().nullable(),
});

export type Video = z.infer<typeof VideoSchema>;

// Input validation helpers
const IdSchema = z.string().cuid();
const FilmMuviUuidSchema = z.string().min(1);

// ============================================================================
// QUERY FUNCTIONS
// ============================================================================

/**
 * Get video by ID
 */
export async function getVideoById(id: string) {
  const validId = IdSchema.parse(id);

  const result = await prisma.video.findUnique({
    where: { id: validId },
  });

  if (!result) return null;

  return VideoSchema.parse(result);
}

/**
 * Get videos by film MUVI UUID
 */
export async function getVideosByFilmMuviUuid(filmMuviUuid: string) {
  const validFilmMuviUuid = FilmMuviUuidSchema.parse(filmMuviUuid);

  const results = await prisma.video.findMany({
    where: { filmMuviUuid: validFilmMuviUuid, archived: false },
    orderBy: { createdAt: 'desc' },
  });

  return z.array(VideoSchema).parse(results);
}

/**
 * Get videos by IDs
 */
export async function getVideosByIds(ids: string[]) {
  const validIds = z.array(IdSchema).parse(ids);

  const results = await prisma.video.findMany({
    where: { id: { in: validIds } },
  });

  return z.array(VideoSchema).parse(results);
}

/**
 * Get video by original URL (to check if already uploaded)
 */
export async function getVideoByOriginalUrl(originalUrl: string, filmMuviUuid: string) {
  const validOriginalUrl = z.string().min(1).parse(originalUrl);
  const validFilmMuviUuid = FilmMuviUuidSchema.parse(filmMuviUuid);

  const result = await prisma.video.findFirst({
    where: {
      originalUrl: validOriginalUrl,
      filmMuviUuid: validFilmMuviUuid,
    },
  });

  if (!result) return null;

  return VideoSchema.parse(result);
}

// ============================================================================
// MUTATION FUNCTIONS
// ============================================================================

/**
 * Create a new video record
 */
export async function createVideo(data: VideoCreateInput) {
  const validated = VideoCreateSchema.parse(data);

  const result = await prisma.video.create({
    data: validated,
  });

  return VideoSchema.parse(result);
}

/**
 * Update an existing video
 */
export async function updateVideo(id: string, data: VideoUpdateInput) {
  const validId = IdSchema.parse(id);
  const validated = VideoUpdateSchema.parse(data);

  const result = await prisma.video.update({
    where: { id: validId },
    data: validated,
  });

  return VideoSchema.parse(result);
}

/**
 * Delete a video (only if not used by any ads)
 */
export async function deleteVideo(id: string) {
  const validId = IdSchema.parse(id);

  const video = await prisma.video.findUnique({
    where: { id: validId },
    include: {
      _count: {
        select: { ads: true },
      },
    },
  });

  if (!video) {
    throw new Error('Video not found');
  }

  if (video._count.ads > 0) {
    throw new Error('Cannot delete a video that is being used by ads');
  }

  const result = await prisma.video.delete({
    where: { id: validId },
  });

  return VideoSchema.parse(result);
}

/**
 * Set Meta video ID after uploading to Meta Ads
 */
export async function setMetaVideoId(id: string, metaVideoId: string) {
  const validId = IdSchema.parse(id);
  const validMetaVideoId = z.string().min(1).parse(metaVideoId);

  const result = await prisma.video.update({
    where: { id: validId },
    data: { metaVideoId: validMetaVideoId },
  });

  return VideoSchema.parse(result);
}

/**
 * Set YouTube video ID after uploading to YouTube
 */
export async function setYoutubeVideoId(id: string, youtubeVideoId: string) {
  const validId = IdSchema.parse(id);
  const validYoutubeVideoId = z.string().min(1).parse(youtubeVideoId);

  const result = await prisma.video.update({
    where: { id: validId },
    data: {
      youtubeVideoId: validYoutubeVideoId,
      youtubeEligible: true,
    },
  });

  return VideoSchema.parse(result);
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Input schema for validation update
 */
const VideoValidationUpdateSchema = z.object({
  status: AssetStatusSchema,
  validatedAt: z.date().optional(),
  validationError: z.string().nullable().optional(),
  aspectRatio: z.string().nullable().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration: z.number().int().positive().optional(),
});

export type VideoValidationUpdate = z.infer<typeof VideoValidationUpdateSchema>;

/**
 * Input schema for eligibility update
 */
const VideoEligibilityUpdateSchema = z.object({
  facebookEligible: z.boolean(),
  instagramEligible: z.boolean(),
  youtubeEligible: z.boolean().optional(),
  eligibilityError: z.string().nullable().optional(),
});

export type VideoEligibilityUpdate = z.infer<typeof VideoEligibilityUpdateSchema>;

/**
 * Get videos by film MUVI UUID with ad usage counts
 * @param archived - filter by archived state (default: false = active videos only)
 */
export async function getVideosWithUsageByFilmMuviUuid(filmMuviUuid: string, archived = false) {
  const validFilmMuviUuid = FilmMuviUuidSchema.parse(filmMuviUuid);

  const results = await prisma.video.findMany({
    where: { filmMuviUuid: validFilmMuviUuid, archived },
    include: { _count: { select: { ads: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return results.map((result) => ({
    ...VideoSchema.parse(result),
    _count: { ads: result._count.ads },
  }));
}

export type VideoWithUsage = Awaited<ReturnType<typeof getVideosWithUsageByFilmMuviUuid>>[number];

/**
 * Get videos by film MUVI UUID with optional status filter
 */
export async function getVideosByFilmMuviUuidWithStatus(
  filmMuviUuid: string,
  status?: AssetStatus
) {
  const validFilmMuviUuid = FilmMuviUuidSchema.parse(filmMuviUuid);

  const results = await prisma.video.findMany({
    where: {
      filmMuviUuid: validFilmMuviUuid,
      ...(status && { status }),
    },
    orderBy: { createdAt: 'desc' },
  });

  return z.array(VideoSchema).parse(results);
}

/**
 * Get only READY videos for a film
 */
export async function getReadyVideosByFilmMuviUuid(filmMuviUuid: string) {
  return getVideosByFilmMuviUuidWithStatus(filmMuviUuid, 'READY');
}

/**
 * Update video validation status and metadata
 */
export async function updateVideoValidation(id: string, data: VideoValidationUpdate) {
  const validId = IdSchema.parse(id);
  const validated = VideoValidationUpdateSchema.parse(data);

  const result = await prisma.video.update({
    where: { id: validId },
    data: {
      ...validated,
      validatedAt: validated.validatedAt || new Date(),
    },
  });

  return VideoSchema.parse(result);
}

/**
 * Update video platform eligibility
 */
export async function updateVideoEligibility(id: string, data: VideoEligibilityUpdate) {
  const validId = IdSchema.parse(id);
  const validated = VideoEligibilityUpdateSchema.parse(data);

  const result = await prisma.video.update({
    where: { id: validId },
    data: validated,
  });

  return VideoSchema.parse(result);
}

/**
 * Set video status to VALIDATING
 */
export async function setVideoValidating(id: string) {
  const validId = IdSchema.parse(id);

  const result = await prisma.video.update({
    where: { id: validId },
    data: { status: 'VALIDATING' },
  });

  return VideoSchema.parse(result);
}

/**
 * Set video archived state (idempotent)
 */
export async function setVideoArchived(id: string, archived: boolean) {
  const validId = IdSchema.parse(id);

  const result = await prisma.video.update({
    where: { id: validId },
    data: { archived },
  });

  return VideoSchema.parse(result);
}
