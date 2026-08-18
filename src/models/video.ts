import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { COLLECTIONS, IdSchema as DocIdSchema, docData, sanitize } from '@/lib/firestore';
import { AssetStatusSchema, type AssetStatus } from '@/lib/assets/status';

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
  id: DocIdSchema,
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
const IdSchema = DocIdSchema;
const FilmMuviUuidSchema = z.string().min(1);

// ============================================================================
// FIRESTORE HELPERS
// ============================================================================

function videos() {
  return adminDb().collection(COLLECTIONS.videos);
}

/**
 * Column defaults Postgres used to apply. Firestore stores exactly what it is
 * given, so a create has to write them explicitly.
 */
function createDefaults() {
  return {
    archived: false,
    status: 'PENDING' as AssetStatus,
    validatedAt: null,
    validationError: null,
    width: null,
    height: null,
    aspectRatio: null,
    duration: null,
    thumbnailUrl: null,
    metaVideoId: null,
    facebookEligible: false,
    instagramEligible: false,
    youtubeEligible: false,
    youtubeVideoId: null,
    eligibilityError: null,
  };
}

/**
 * Apply a partial update and return the resulting document, mirroring what
 * Prisma's `update` returned. `update` rejects when the document is missing
 * instead of creating one, which is the behaviour the callers rely on.
 */
async function updateAndFetch(id: string, data: Record<string, unknown>): Promise<Video> {
  const ref = videos().doc(id);
  await ref.update(sanitize(data));

  const snap = await ref.get();
  return VideoSchema.parse(docData(snap));
}

/**
 * How many ads reference this video. The join table became a `videoIds` array
 * on the ad document, so this is an aggregation over index entries.
 */
async function countAdsUsing(videoId: string): Promise<number> {
  const snap = await adminDb()
    .collection(COLLECTIONS.ads)
    .where('videoIds', 'array-contains', videoId)
    .count()
    .get();

  return snap.data().count;
}

function byCreatedAtDesc(a: Video, b: Video): number {
  return b.createdAt.getTime() - a.createdAt.getTime();
}

// ============================================================================
// QUERY FUNCTIONS
// ============================================================================

/**
 * Get video by ID
 */
export async function getVideoById(id: string) {
  const validId = IdSchema.parse(id);

  const snap = await videos().doc(validId).get();
  const result = docData(snap);

  if (!result) return null;

  return VideoSchema.parse(result);
}

/**
 * Get videos by film MUVI UUID
 */
export async function getVideosByFilmMuviUuid(filmMuviUuid: string) {
  const validFilmMuviUuid = FilmMuviUuidSchema.parse(filmMuviUuid);

  const snap = await videos()
    .where('filmMuviUuid', '==', validFilmMuviUuid)
    .where('archived', '==', false)
    .get();

  return snap.docs.map((doc) => VideoSchema.parse(docData(doc))).sort(byCreatedAtDesc);
}

/**
 * Get videos by IDs
 */
export async function getVideosByIds(ids: string[]) {
  const validIds = z.array(IdSchema).parse(ids);

  if (validIds.length === 0) return [];

  // `getAll` has no 30-element ceiling, unlike a `where in` query.
  const snaps = await adminDb().getAll(...validIds.map((id) => videos().doc(id)));

  return snaps
    .map(docData)
    .filter((data): data is Record<string, unknown> => data !== null)
    .map((data) => VideoSchema.parse(data));
}

/**
 * Get video by original URL (to check if already uploaded)
 */
export async function getVideoByOriginalUrl(originalUrl: string, filmMuviUuid: string) {
  const validOriginalUrl = z.string().min(1).parse(originalUrl);
  const validFilmMuviUuid = FilmMuviUuidSchema.parse(filmMuviUuid);

  const snap = await videos()
    .where('filmMuviUuid', '==', validFilmMuviUuid)
    .where('originalUrl', '==', validOriginalUrl)
    .limit(1)
    .get();

  if (snap.empty) return null;

  return VideoSchema.parse(docData(snap.docs[0]));
}

// ============================================================================
// MUTATION FUNCTIONS
// ============================================================================

/**
 * Create a new video record
 */
export async function createVideo(data: VideoCreateInput) {
  const validated = VideoCreateSchema.parse(data);

  const ref = videos().doc();
  // `validated` is sanitized before the spread: an absent optional field must
  // fall back to its default, not overwrite it with undefined.
  const document = {
    ...createDefaults(),
    ...sanitize(validated),
    createdAt: new Date(),
  };

  await ref.set(document);

  return VideoSchema.parse({ id: ref.id, ...document });
}

/**
 * Update an existing video
 */
export async function updateVideo(id: string, data: VideoUpdateInput) {
  const validId = IdSchema.parse(id);
  const validated = VideoUpdateSchema.parse(data);

  return updateAndFetch(validId, validated);
}

/**
 * Delete a video (only if not used by any ads)
 */
export async function deleteVideo(id: string) {
  const validId = IdSchema.parse(id);

  const video = await getVideoById(validId);

  if (!video) {
    throw new Error('Video not found');
  }

  if ((await countAdsUsing(validId)) > 0) {
    throw new Error('Cannot delete a video that is being used by ads');
  }

  await videos().doc(validId).delete();

  return video;
}

/**
 * Set Meta video ID after uploading to Meta Ads
 */
export async function setMetaVideoId(id: string, metaVideoId: string) {
  const validId = IdSchema.parse(id);
  const validMetaVideoId = z.string().min(1).parse(metaVideoId);

  return updateAndFetch(validId, { metaVideoId: validMetaVideoId });
}

/**
 * Set YouTube video ID after uploading to YouTube
 */
export async function setYoutubeVideoId(id: string, youtubeVideoId: string) {
  const validId = IdSchema.parse(id);
  const validYoutubeVideoId = z.string().min(1).parse(youtubeVideoId);

  return updateAndFetch(validId, {
    youtubeVideoId: validYoutubeVideoId,
    youtubeEligible: true,
  });
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

  const snap = await videos()
    .where('filmMuviUuid', '==', validFilmMuviUuid)
    .where('archived', '==', archived)
    .get();

  const parsed = snap.docs.map((doc) => VideoSchema.parse(docData(doc))).sort(byCreatedAtDesc);

  // One aggregation per video, issued together: a film holds a handful of
  // videos, and each count reads index entries rather than documents.
  const counts = await Promise.all(parsed.map((video) => countAdsUsing(video.id)));

  return parsed.map((video, index) => ({ ...video, _count: { ads: counts[index] } }));
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

  let query = videos().where('filmMuviUuid', '==', validFilmMuviUuid);
  if (status) {
    query = query.where('status', '==', status);
  }

  const snap = await query.get();

  return snap.docs.map((doc) => VideoSchema.parse(docData(doc))).sort(byCreatedAtDesc);
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

  return updateAndFetch(validId, {
    ...validated,
    validatedAt: validated.validatedAt || new Date(),
  });
}

/**
 * Update video platform eligibility
 */
export async function updateVideoEligibility(id: string, data: VideoEligibilityUpdate) {
  const validId = IdSchema.parse(id);
  const validated = VideoEligibilityUpdateSchema.parse(data);

  return updateAndFetch(validId, validated);
}

/**
 * Set video status to VALIDATING
 */
export async function setVideoValidating(id: string) {
  const validId = IdSchema.parse(id);

  return updateAndFetch(validId, { status: 'VALIDATING' });
}

/**
 * Set video archived state (idempotent)
 */
export async function setVideoArchived(id: string, archived: boolean) {
  const validId = IdSchema.parse(id);

  return updateAndFetch(validId, { archived });
}
