import prisma from '#prisma';
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
  createdAt: z.coerce.date(),
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
    where: { filmMuviUuid: validFilmMuviUuid },
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
    throw new Error('Video no encontrado');
  }

  if (video._count.ads > 0) {
    throw new Error('No se puede eliminar un video que está siendo usado por anuncios');
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
