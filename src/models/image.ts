import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { COLLECTIONS, IdSchema as DocIdSchema, docData, sanitize } from '@/lib/firestore';
import { AssetStatusSchema, type AssetStatus } from '@/lib/assets/status';

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

export const ImageSchema = z.object({
  id: DocIdSchema,
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
const IdSchema = DocIdSchema;
const FilmMuviUuidSchema = z.string().min(1);

// ============================================================================
// FIRESTORE HELPERS
// ============================================================================

function images() {
  return adminDb().collection(COLLECTIONS.images);
}

/**
 * Column defaults Postgres used to apply. Firestore stores exactly what it is
 * given, so a create has to write them explicitly or the output schema (which
 * requires every field) would reject the document on the next read.
 */
function createDefaults() {
  return {
    archived: false,
    status: 'PENDING' as AssetStatus,
    validatedAt: null,
    validationError: null,
    aspectRatio: null,
    metaImageHash: null,
    facebookEligible: false,
    instagramEligible: false,
    googleEligible: false,
    eligibilityError: null,
    width: null,
    height: null,
  };
}

/**
 * Apply a partial update and return the resulting document, mirroring what
 * Prisma's `update` returned. `update` (rather than `set`) keeps the "record
 * must exist" behaviour: it rejects instead of silently creating a document.
 */
async function updateAndFetch(id: string, data: Record<string, unknown>): Promise<Image> {
  const ref = images().doc(id);
  await ref.update(sanitize(data));

  const snap = await ref.get();
  return ImageSchema.parse(docData(snap));
}

/**
 * How many ads reference this image.
 *
 * The many-to-many join table became an `imageIds` array on the ad document,
 * so the count is an aggregation query — it does not read the ad documents.
 */
async function countAdsUsing(imageId: string): Promise<number> {
  const snap = await adminDb()
    .collection(COLLECTIONS.ads)
    .where('imageIds', 'array-contains', imageId)
    .count()
    .get();

  return snap.data().count;
}

// Reproduces `orderBy: { createdAt: 'desc' }` without needing an index for
// every filter combination.
function byCreatedAtDesc(a: Image, b: Image): number {
  return b.createdAt.getTime() - a.createdAt.getTime();
}

// ============================================================================
// QUERY FUNCTIONS
// ============================================================================

/**
 * Get image by ID
 */
export async function getImageById(id: string) {
  const validId = IdSchema.parse(id);

  const snap = await images().doc(validId).get();
  const result = docData(snap);

  if (!result) return null;

  return ImageSchema.parse(result);
}

/**
 * Get images by film MUVI UUID
 */
export async function getImagesByFilmMuviUuid(filmMuviUuid: string) {
  const validFilmMuviUuid = FilmMuviUuidSchema.parse(filmMuviUuid);

  const snap = await images()
    .where('filmMuviUuid', '==', validFilmMuviUuid)
    .where('archived', '==', false)
    .get();

  return snap.docs.map((doc) => ImageSchema.parse(docData(doc))).sort(byCreatedAtDesc);
}

/**
 * Get images by IDs
 */
export async function getImagesByIds(ids: string[]) {
  const validIds = z.array(IdSchema).parse(ids);

  if (validIds.length === 0) return [];

  // `getAll` has no 30-element ceiling, unlike a `where in` query.
  const snaps = await adminDb().getAll(...validIds.map((id) => images().doc(id)));

  return snaps
    .map(docData)
    .filter((data): data is Record<string, unknown> => data !== null)
    .map((data) => ImageSchema.parse(data));
}

/**
 * Get image by original URL (to check if already uploaded)
 */
export async function getImageByOriginalUrl(originalUrl: string, filmMuviUuid: string) {
  const validOriginalUrl = z.string().min(1).parse(originalUrl);
  const validFilmMuviUuid = FilmMuviUuidSchema.parse(filmMuviUuid);

  const snap = await images()
    .where('filmMuviUuid', '==', validFilmMuviUuid)
    .where('originalUrl', '==', validOriginalUrl)
    .limit(1)
    .get();

  if (snap.empty) return null;

  return ImageSchema.parse(docData(snap.docs[0]));
}

// ============================================================================
// MUTATION FUNCTIONS
// ============================================================================

/**
 * Create a new image record
 */
export async function createImage(data: ImageCreateInput) {
  const validated = ImageCreateSchema.parse(data);

  const ref = images().doc();
  // `validated` is sanitized before the spread: an absent optional field must
  // fall back to its default, not overwrite it with undefined.
  const document = {
    ...createDefaults(),
    ...sanitize(validated),
    createdAt: new Date(),
  };

  await ref.set(document);

  return ImageSchema.parse({ id: ref.id, ...document });
}

/**
 * Update an existing image
 */
export async function updateImage(id: string, data: ImageUpdateInput) {
  const validId = IdSchema.parse(id);
  const validated = ImageUpdateSchema.parse(data);

  return updateAndFetch(validId, validated);
}

/**
 * Delete an image (only if not used by any ads)
 */
export async function deleteImage(id: string) {
  const validId = IdSchema.parse(id);

  const image = await getImageById(validId);

  if (!image) {
    throw new Error('Image not found');
  }

  if ((await countAdsUsing(validId)) > 0) {
    throw new Error('Cannot delete an image that is being used by ads');
  }

  await images().doc(validId).delete();

  return image;
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

  const snap = await images()
    .where('filmMuviUuid', '==', validFilmMuviUuid)
    .where('archived', '==', archived)
    .get();

  const parsed = snap.docs.map((doc) => ImageSchema.parse(docData(doc))).sort(byCreatedAtDesc);

  // One aggregation per image, issued together: a film holds a few dozen
  // images at most, and each count reads index entries rather than documents.
  const counts = await Promise.all(parsed.map((image) => countAdsUsing(image.id)));

  return parsed.map((image, index) => ({ ...image, _count: { ads: counts[index] } }));
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

  let query = images().where('filmMuviUuid', '==', validFilmMuviUuid);
  if (status) {
    query = query.where('status', '==', status);
  }

  const snap = await query.get();

  return snap.docs.map((doc) => ImageSchema.parse(docData(doc))).sort(byCreatedAtDesc);
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

  return updateAndFetch(validId, {
    ...validated,
    validatedAt: validated.validatedAt || new Date(),
  });
}

/**
 * Update image platform eligibility
 */
export async function updateImageEligibility(id: string, data: ImageEligibilityUpdate) {
  const validId = IdSchema.parse(id);
  const validated = ImageEligibilityUpdateSchema.parse(data);

  return updateAndFetch(validId, validated);
}

/**
 * Set image status to VALIDATING
 */
export async function setImageValidating(id: string) {
  const validId = IdSchema.parse(id);

  return updateAndFetch(validId, { status: 'VALIDATING' });
}

/**
 * Set image archived state (idempotent)
 */
export async function setImageArchived(id: string, archived: boolean) {
  const validId = IdSchema.parse(id);

  return updateAndFetch(validId, { archived });
}
