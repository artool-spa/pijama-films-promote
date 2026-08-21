import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { COLLECTIONS, IdSchema as DocIdSchema, docData, sanitize } from '@/lib/firestore';
import { withAds, withPartner, adsForCampaign, createdAtMillis } from './hydrate';

// ============================================================================
// SHARED SCHEMAS
// ============================================================================

const MetaEntityStatusSchema = z.enum(['DRAFT', 'PENDING_ASSETS', 'SYNCING', 'PENDING', 'ACTIVE', 'PAUSED', 'ARCHIVED', 'ERROR']);
const CampaignObjectiveSchema = z.enum(['CONVERSIONS', 'LANDING_PAGE_VIEW']);
const BudgetTypeSchema = z.enum(['DAILY', 'LIFETIME']);
const AdPlatformSchema = z.enum(['META', 'GOOGLE']);
const GoogleEntityStatusSchema = z.enum(['DRAFT', 'PENDING', 'ENABLED', 'PAUSED', 'REMOVED', 'ERROR']);
const YouTubeAdFormatSchema = z.enum(['IN_STREAM_SKIPPABLE', 'IN_STREAM_NON_SKIPPABLE', 'IN_FEED', 'BUMPER', 'SHORTS']);
const AdApprovalStatusSchema = z.enum(['UNKNOWN', 'PENDING_REVIEW', 'APPROVED', 'APPROVED_LIMITED', 'DISAPPROVED', 'APPEALED']);
const ApprovalSummarySchema = z.enum(['ALL_APPROVED', 'SOME_PENDING', 'SOME_DISAPPROVED', 'ALL_DISAPPROVED', 'UNKNOWN']);

/** Replace the enums Prisma used to generate. */
export type MetaEntityStatus = z.infer<typeof MetaEntityStatusSchema>;
export type CampaignObjective = z.infer<typeof CampaignObjectiveSchema>;
export type BudgetType = z.infer<typeof BudgetTypeSchema>;
export type AdPlatform = z.infer<typeof AdPlatformSchema>;

// ============================================================================
// VALIDATION SCHEMAS - INPUT (strict, no extra fields allowed)
// ============================================================================

export const CampaignCreateSchema = z
  .object({
    name: z.string().min(1).max(255),
    // Platform discriminator (array for multi-platform)
    platforms: z.array(AdPlatformSchema).min(1).default(['META']),
    objective: CampaignObjectiveSchema,
    budget: z.number().positive(),
    budgetType: BudgetTypeSchema.default('LIFETIME'),
    startDate: z.coerce.date(),
    endDate: z.coerce.date().optional(),
    // Language (single per campaign)
    language: z.string().min(2).max(10).default('es'),
    // Targeting
    targetCountries: z.array(z.string()).default(['US']),
    targetAgeMin: z.number().int().min(13).max(65).default(18),
    targetAgeMax: z.number().int().min(13).max(65).default(65),
    targetGenders: z.array(z.number().int()).default([]),
    includeBaseAudiences: z.boolean().default(true),
    filmGenres: z.array(z.string()).default([]),
    includeLgbtAudience: z.boolean().default(false),
    // Pixel/Conversion
    pixelId: z.string().optional(),
    conversionEvent: z.string().default('PURCHASE'),
    // Google Ads specific
    googleBidStrategy: z.string().optional(),
    targetCpvMicros: z.bigint().optional(),
    // Film reference (MUVI UUID)
    filmMuviUuid: z.string().min(1),
    // Partner relation
    partnerId: DocIdSchema,
    // Draft form state
    draftFormState: z.unknown().optional(),
  })
  .strict();

export const CampaignUpdateSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    status: MetaEntityStatusSchema.optional(),
    budget: z.number().positive().optional(),
    endDate: z.coerce.date().optional(),
    language: z.string().min(2).max(10).optional(),
    targetCountries: z.array(z.string()).optional(),
    targetAgeMin: z.number().int().optional(),
    targetAgeMax: z.number().int().optional(),
    targetGenders: z.array(z.number().int()).optional(),
    includeBaseAudiences: z.boolean().optional(),
    filmGenres: z.array(z.string()).optional(),
    includeLgbtAudience: z.boolean().optional(),
    // CBO Meta IDs
    metaCampaignId: z.string().optional(),
    imageAdSetId: z.string().optional(),
    videoAdSetId: z.string().optional(),
    // Google Ads IDs
    googleCampaignId: z.string().optional(),
    googleAdGroupId: z.string().optional(),
    googleEntityStatus: GoogleEntityStatusSchema.optional(),
    // Draft form state (null to clear, undefined to skip)
    draftFormState: z.unknown().nullable().optional(),
  })
  .strict();

export type CampaignCreateInput = z.infer<typeof CampaignCreateSchema>;
export type CampaignUpdateInput = z.infer<typeof CampaignUpdateSchema>;

// ============================================================================
// VALIDATION SCHEMAS - OUTPUT (validate database results)
// ============================================================================

const ImageSchema = z.object({
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
  aspectRatio: z.string().nullable(),
  createdAt: z.coerce.date(),
});

const VideoSchema = z.object({
  id: DocIdSchema,
  filmMuviUuid: z.string(),
  name: z.string(),
  originalUrl: z.string(),
  storageKey: z.string(),
  url: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
  duration: z.number().int().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  aspectRatio: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  metaVideoId: z.string().nullable(),
  youtubeVideoId: z.string().nullable(),
  createdAt: z.coerce.date(),
});

const AdSetTypeSchema = z.enum(['IMAGE', 'VIDEO']);

export const AdSchema = z.object({
  id: DocIdSchema,
  metaAdId: z.string().nullable(),
  googleAdId: z.string().nullable(),
  youtubeAdFormat: YouTubeAdFormatSchema.nullable(),
  name: z.string(),
  status: MetaEntityStatusSchema,
  adSetType: AdSetTypeSchema,
  headlines: z.array(z.string()),
  bodies: z.array(z.string()),
  descriptions: z.array(z.string()),
  callToAction: z.string(),
  linkUrl: z.string(),
  images: z.array(ImageSchema),
  videos: z.array(VideoSchema),
  campaignId: DocIdSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  syncedAt: z.coerce.date().nullable(),
  approvalStatus: AdApprovalStatusSchema,
  approvalCheckedAt: z.coerce.date().nullable(),
  rejectionReason: z.string().nullable(),
  rejectionDetails: z.unknown().nullable(),
  suggestedCorrection: z.string().nullable(),
  reviewSeenAt: z.coerce.date().nullable(),
});

export const PartnerSchema = z.object({
  id: DocIdSchema,
  partnerId: z.string(),
  name: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CampaignSchema = z.object({
  id: DocIdSchema,
  // Platform discriminator (array for multi-platform)
  platforms: z.array(AdPlatformSchema),
  // CBO Meta IDs (dedicated campaign per local campaign)
  metaCampaignId: z.string().nullable(),
  imageAdSetId: z.string().nullable(),
  videoAdSetId: z.string().nullable(),
  // Google Ads IDs
  googleCampaignId: z.string().nullable(),
  googleAdGroupId: z.string().nullable(),
  googleEntityStatus: GoogleEntityStatusSchema.nullable(),
  googleBidStrategy: z.string().nullable(),
  // Stored as a number: Firestore has no BigInt, and micros of currency stay
  // far below 2^53. Coerced back so callers keep receiving a bigint.
  targetCpvMicros: z.coerce.bigint().nullable(),
  name: z.string(),
  status: MetaEntityStatusSchema,
  objective: CampaignObjectiveSchema,
  budget: z.number(),
  budgetType: BudgetTypeSchema,
  startDate: z.coerce.date(),
  endDate: z.coerce.date().nullable(),
  language: z.string(),
  targetCountries: z.array(z.string()),
  targetAgeMin: z.number().int(),
  targetAgeMax: z.number().int(),
  targetGenders: z.array(z.number().int()),
  includeBaseAudiences: z.boolean(),
  filmGenres: z.array(z.string()),
  includeLgbtAudience: z.boolean(),
  pixelId: z.string().nullable(),
  conversionEvent: z.string(),
  optimizationGoal: z.string(),
  billingEvent: z.string(),
  bidStrategy: z.string(),
  filmMuviUuid: z.string(),
  partnerId: DocIdSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  syncedAt: z.coerce.date().nullable(),
  draftFormState: z.unknown().nullable(),
  approvalSummary: ApprovalSummarySchema.nullable(),
  lastSyncError: z.string().nullable(),
  lastSyncErrorAt: z.coerce.date().nullable(),
  lastSyncErrorDetails: z.unknown().nullable(),
});

export const CampaignWithAdsSchema = CampaignSchema.extend({
  ads: z.array(AdSchema),
});

export const CampaignWithPartnerSchema = CampaignSchema.extend({
  partner: PartnerSchema,
});

export const CampaignWithPartnerAndAdsSchema = CampaignSchema.extend({
  partner: PartnerSchema,
  ads: z.array(AdSchema),
});

export type Campaign = z.infer<typeof CampaignSchema>;
export type CampaignWithAds = z.infer<typeof CampaignWithAdsSchema>;
export type CampaignWithPartner = z.infer<typeof CampaignWithPartnerSchema>;
export type CampaignWithPartnerAndAds = z.infer<typeof CampaignWithPartnerAndAdsSchema>;

// Input validation helpers
const IdSchema = DocIdSchema;
const FilmMuviUuidSchema = z.string().min(1);

// ============================================================================
// FIRESTORE HELPERS
// ============================================================================

type Doc = Record<string, unknown>;

function campaigns() {
  return adminDb().collection(COLLECTIONS.campaigns);
}

/**
 * Column defaults Postgres applied on insert. Firestore stores only what it is
 * handed, so every field the output schema requires has to be written.
 */
function createDefaults() {
  return {
    status: 'DRAFT' as MetaEntityStatus,
    metaCampaignId: null,
    imageAdSetId: null,
    videoAdSetId: null,
    googleCampaignId: null,
    googleAdGroupId: null,
    googleEntityStatus: null,
    googleBidStrategy: null,
    targetCpvMicros: null,
    endDate: null,
    pixelId: null,
    optimizationGoal: 'OFFSITE_CONVERSIONS',
    billingEvent: 'IMPRESSIONS',
    bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
    syncedAt: null,
    draftFormState: null,
    approvalSummary: null,
    lastSyncError: null,
    lastSyncErrorAt: null,
    lastSyncErrorDetails: null,
  };
}

/** Firestore has no BigInt; micros are stored as a plain number. */
function encodeCpv(value: bigint | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}

async function updateAndFetch(id: string, data: Doc): Promise<Campaign> {
  const ref = campaigns().doc(id);
  await ref.update(sanitize(data));

  const snap = await ref.get();
  return CampaignSchema.parse(docData(snap));
}

async function campaignDocs(query: FirebaseFirestore.Query): Promise<Doc[]> {
  const snap = await query.get();

  return snap.docs
    .map(docData)
    .filter((doc): doc is Doc => doc !== null)
    .sort((a, b) => createdAtMillis(b) - createdAtMillis(a));
}

// ============================================================================
// QUERY FUNCTIONS
// ============================================================================

/**
 * Get campaign by ID with full details
 */
export async function getCampaignById(id: string) {
  const validId = IdSchema.parse(id);

  const snap = await campaigns().doc(validId).get();
  const campaign = docData(snap);

  if (!campaign) return null;

  const [ads, [withPartnerDoc]] = await Promise.all([
    adsForCampaign(validId),
    withPartner([campaign]),
  ]);

  return CampaignWithPartnerAndAdsSchema.parse({ ...withPartnerDoc, ads });
}

/**
 * Get campaigns by film MUVI UUID
 */
export async function getCampaignsByFilmMuviUuid(filmMuviUuid: string) {
  const validFilmMuviUuid = FilmMuviUuidSchema.parse(filmMuviUuid);

  const docs = await campaignDocs(campaigns().where('filmMuviUuid', '==', validFilmMuviUuid));
  // `status != DRAFT` is filtered here rather than in the query: an inequality
  // would force the sort onto `status` and demand a composite index.
  const published = docs.filter((doc) => doc.status !== 'DRAFT');

  return z.array(CampaignWithAdsSchema).parse(await withAds(published));
}

/**
 * Get campaigns by partner ID
 */
export async function getCampaignsByPartnerId(partnerId: string) {
  const validPartnerId = IdSchema.parse(partnerId);

  const docs = await campaignDocs(campaigns().where('partnerId', '==', validPartnerId));

  return z.array(CampaignWithAdsSchema).parse(await withAds(docs));
}

/**
 * Get campaigns by partner ID and objective
 */
export async function getCampaignsByPartnerAndObjective(
  partnerId: string,
  objective: CampaignObjective
) {
  const validPartnerId = IdSchema.parse(partnerId);
  const validObjective = CampaignObjectiveSchema.parse(objective);

  const docs = await campaignDocs(
    campaigns().where('partnerId', '==', validPartnerId).where('objective', '==', validObjective)
  );

  return z.array(CampaignWithAdsSchema).parse(await withAds(docs));
}

/**
 * Get all active campaigns
 */
export async function getActiveCampaigns() {
  const docs = await campaignDocs(campaigns().where('status', '==', 'ACTIVE'));
  const synced = docs.filter((doc) => doc.metaCampaignId !== null);

  const hydrated = await withAds(synced);

  const ActiveCampaignSchema = z.object({
    id: DocIdSchema,
    metaCampaignId: z.string(),
    imageAdSetId: z.string().nullable(),
    videoAdSetId: z.string().nullable(),
    ads: z.array(
      z.object({
        id: DocIdSchema,
        metaAdId: z.string(),
        adSetType: AdSetTypeSchema,
      })
    ),
  });

  // Only ads that reached Meta are relevant here, matching the nested
  // `where: { metaAdId: { not: null } }` of the original query.
  return z.array(ActiveCampaignSchema).parse(
    hydrated.map((campaign) => ({
      ...campaign,
      ads: (campaign.ads as Doc[]).filter((ad) => ad.metaAdId !== null),
    }))
  );
}

/**
 * Get draft campaigns by partner ID
 */
export async function getDraftCampaignsByPartnerId(partnerId: string) {
  const validPartnerId = IdSchema.parse(partnerId);

  const snap = await campaigns()
    .where('partnerId', '==', validPartnerId)
    .where('status', '==', 'DRAFT')
    .get();

  const docs = snap.docs
    .map(docData)
    .filter((doc): doc is Doc => doc !== null)
    .sort((a, b) => {
      const left = a.updatedAt instanceof Date ? a.updatedAt.getTime() : 0;
      const right = b.updatedAt instanceof Date ? b.updatedAt.getTime() : 0;
      return right - left;
    });

  return z.array(CampaignWithAdsSchema).parse(await withAds(docs));
}

/**
 * Get all campaigns with PENDING_ASSETS status (waiting for video uploads)
 */
/**
 * Campaigns stuck mid-publish: the platform objects exist but no ad was ever
 * created, and the request that was creating them never finished.
 *
 * The sync is synchronous inside one request, so anything still SYNCING after a
 * few minutes means that request died (deploy, timeout, crash). `olderThan`
 * keeps a campaign being published right now out of the result.
 */
export async function getCampaignsStuckSyncing(olderThan: Date) {
  const docs = await campaignDocs(campaigns().where('status', '==', 'SYNCING'));

  const stale = docs.filter((doc) => {
    const updatedAt = doc.updatedAt instanceof Date ? doc.updatedAt : null;
    return updatedAt !== null && updatedAt < olderThan;
  });

  const hydrated = await withAds(await withPartner(stale));

  return z.array(CampaignWithPartnerAndAdsSchema).parse(hydrated);
}

export async function getCampaignsPendingAssets() {
  const docs = await campaignDocs(campaigns().where('status', '==', 'PENDING_ASSETS'));
  // The original ordered oldest first.
  const oldestFirst = [...docs].reverse();

  const hydrated = await withAds(await withPartner(oldestFirst));

  return z.array(CampaignWithPartnerAndAdsSchema).parse(hydrated);
}

// ============================================================================
// MUTATION FUNCTIONS
// ============================================================================

async function insertCampaign(data: CampaignCreateInput) {
  const validated = CampaignCreateSchema.parse(data);
  const { draftFormState, targetCpvMicros, ...rest } = validated;

  const ref = campaigns().doc();
  const now = new Date();
  const document = {
    ...createDefaults(),
    // Sanitized before the spread so an absent optional field falls back to its
    // default instead of overwriting it with undefined.
    ...sanitize(rest),
    targetCpvMicros: encodeCpv(targetCpvMicros) ?? null,
    draftFormState: draftFormState === undefined ? null : draftFormState,
    createdAt: now,
    updatedAt: now,
  };

  await ref.set(document);

  const [hydrated] = await withPartner([{ id: ref.id, ...document }]);

  return CampaignWithPartnerSchema.parse(hydrated);
}

/**
 * Create a new campaign
 */
export async function createCampaign(data: CampaignCreateInput) {
  return insertCampaign(data);
}

/**
 * Save a draft campaign with form state
 */
export async function saveDraftCampaign(data: CampaignCreateInput) {
  return insertCampaign(data);
}

/**
 * Update an existing campaign
 */
export async function updateCampaign(id: string, data: CampaignUpdateInput) {
  const validId = IdSchema.parse(id);
  const validated = CampaignUpdateSchema.parse(data);
  const { draftFormState, ...rest } = validated;

  // Determine if any Meta IDs are being set (indicates sync)
  const isSyncing = rest.metaCampaignId || rest.imageAdSetId || rest.videoAdSetId;

  return updateAndFetch(validId, {
    ...rest,
    // null clears the stored form state; undefined leaves it untouched.
    draftFormState,
    syncedAt: isSyncing ? new Date() : undefined,
    updatedAt: new Date(),
  });
}

/**
 * Delete a campaign (only if in DRAFT status)
 */
export async function deleteCampaign(id: string) {
  const validId = IdSchema.parse(id);

  const snap = await campaigns().doc(validId).get();
  const campaign = docData(snap);

  if (campaign?.status !== 'DRAFT') {
    throw new Error('Solo se pueden eliminar campañas en estado borrador');
  }

  await campaigns().doc(validId).delete();

  return CampaignSchema.parse(campaign);
}

/**
 * Mark campaign as synced with Meta API using CBO structure
 * @param id - Local campaign ID
 * @param metaCampaignId - Meta Campaign ID (with CBO enabled)
 * @param imageAdSetId - Optional Meta AdSet ID for image ads
 * @param videoAdSetId - Optional Meta AdSet ID for video ads
 */
export async function markCampaignSynced(
  id: string,
  metaCampaignId: string,
  imageAdSetId?: string,
  videoAdSetId?: string
) {
  const validId = IdSchema.parse(id);
  const validMetaCampaignId = z.string().min(1).parse(metaCampaignId);
  const validImageAdSetId = imageAdSetId ? z.string().min(1).parse(imageAdSetId) : undefined;
  const validVideoAdSetId = videoAdSetId ? z.string().min(1).parse(videoAdSetId) : undefined;

  return updateAndFetch(validId, {
    metaCampaignId: validMetaCampaignId,
    imageAdSetId: validImageAdSetId,
    videoAdSetId: validVideoAdSetId,
    // SYNCING, not PENDING: the campaign shell and its ad sets exist on Meta,
    // but no ad has been created yet, so nothing is under review. Only
    // `markCampaignSubmitted` may promote it, once an ad exists.
    status: 'SYNCING',
    syncedAt: new Date(),
    updatedAt: new Date(),
  });
}

/**
 * Promote a campaign to PENDING once at least one ad exists on the platform.
 *
 * This is the only place that may claim the campaign is awaiting review, and
 * the caller must have a platform ad id in hand when it calls.
 */
export async function markCampaignSubmitted(id: string) {
  const validId = IdSchema.parse(id);

  return updateAndFetch(validId, {
    status: 'PENDING',
    updatedAt: new Date(),
  });
}

/**
 * Drop the Meta ids after a sync was rolled back.
 *
 * Used when the campaign and its ad sets were deleted on Meta because no ad
 * could be created: keeping the ids would point the app at objects that no
 * longer exist, and a later edit would try to update them.
 */
export async function clearMetaSync(id: string) {
  const validId = IdSchema.parse(id);

  return updateAndFetch(validId, {
    metaCampaignId: null,
    imageAdSetId: null,
    videoAdSetId: null,
    syncedAt: null,
    updatedAt: new Date(),
  });
}

/**
 * Mark campaign as having a sync error. When `error` is provided, persist
 * details for the UI to display.
 */
export async function markCampaignError(
  id: string,
  error?: { message: string; details?: unknown }
) {
  const validId = IdSchema.parse(id);

  return updateAndFetch(validId, {
    status: 'ERROR',
    lastSyncError: error?.message,
    lastSyncErrorAt: error ? new Date() : undefined,
    lastSyncErrorDetails: error?.details,
    updatedAt: new Date(),
  });
}

/**
 * Update only budget and endDate. Used by the "edit campaign" flow.
 */
export async function updateCampaignBudgetAndEndDate(
  id: string,
  data: { budget?: number; endDate?: Date | null }
) {
  const validId = IdSchema.parse(id);
  const parsed = z
    .object({
      budget: z.number().positive().optional(),
      endDate: z.coerce.date().nullable().optional(),
    })
    .parse(data);

  return updateAndFetch(validId, {
    budget: parsed.budget,
    endDate: parsed.endDate ?? undefined,
    updatedAt: new Date(),
  });
}

/**
 * Compute the approval summary rollup from an ad's approval statuses.
 * Pure — no I/O. Extracted here so it can be reused by sync helpers.
 */
export function computeApprovalSummary(
  statuses: Array<'UNKNOWN' | 'PENDING_REVIEW' | 'APPROVED' | 'APPROVED_LIMITED' | 'DISAPPROVED' | 'APPEALED'>
): 'ALL_APPROVED' | 'SOME_PENDING' | 'SOME_DISAPPROVED' | 'ALL_DISAPPROVED' | 'UNKNOWN' {
  if (statuses.length === 0) return 'UNKNOWN';
  if (statuses.every((s) => s === 'UNKNOWN')) return 'UNKNOWN';
  if (statuses.every((s) => s === 'DISAPPROVED')) return 'ALL_DISAPPROVED';
  if (statuses.some((s) => s === 'DISAPPROVED')) return 'SOME_DISAPPROVED';
  if (statuses.some((s) => s === 'PENDING_REVIEW' || s === 'UNKNOWN')) return 'SOME_PENDING';
  return 'ALL_APPROVED';
}

/**
 * Recompute Campaign.approvalSummary from the current ad approval statuses.
 */
export async function recomputeApprovalSummary(campaignId: string) {
  const validId = IdSchema.parse(campaignId);

  const snap = await adminDb()
    .collection(COLLECTIONS.ads)
    .where('campaignId', '==', validId)
    .get();

  // Only ads that reached a platform carry a meaningful review state; the
  // original expressed this as `OR [metaAdId, googleAdId] IS NOT NULL`.
  const statuses = snap.docs
    .map(docData)
    .filter((ad): ad is Doc => ad !== null)
    .filter((ad) => ad.metaAdId !== null || ad.googleAdId !== null)
    .map((ad) => AdApprovalStatusSchema.parse(ad.approvalStatus));

  const summary = computeApprovalSummary(statuses);

  await campaigns().doc(validId).update({ approvalSummary: summary, updatedAt: new Date() });

  return summary;
}

/**
 * Mark campaign as pending assets (waiting for video/image uploads)
 */
export async function markCampaignPendingAssets(id: string) {
  const validId = IdSchema.parse(id);

  return updateAndFetch(validId, { status: 'PENDING_ASSETS', updatedAt: new Date() });
}

// ============================================================================
// GOOGLE ADS SYNC FUNCTIONS
// ============================================================================

/**
 * Mark campaign as synced with Google Ads
 */
export async function markGoogleCampaignSynced(
  id: string,
  googleCampaignId: string,
  googleAdGroupId: string
) {
  const validId = IdSchema.parse(id);
  const validGoogleCampaignId = z.string().min(1).parse(googleCampaignId);
  const validGoogleAdGroupId = z.string().min(1).parse(googleAdGroupId);

  // Preserve PENDING_ASSETS status if Meta hasn't synced yet. Otherwise SYNCING,
  // not PENDING: the Google campaign and ad group exist, but the ad does not, so
  // there is nothing under review yet. `markCampaignSubmitted` promotes it once
  // an ad is created.
  const snap = await campaigns().doc(validId).get();
  const current = docData(snap);
  const newStatus =
    current?.status === 'PENDING_ASSETS' && !current?.metaCampaignId ? 'PENDING_ASSETS' : 'SYNCING';

  return updateAndFetch(validId, {
    googleCampaignId: validGoogleCampaignId,
    googleAdGroupId: validGoogleAdGroupId,
    googleEntityStatus: 'PENDING',
    status: newStatus,
    syncedAt: new Date(),
    updatedAt: new Date(),
  });
}

/**
 * Mark Google campaign as having a sync error
 */
export async function markGoogleCampaignError(id: string) {
  const validId = IdSchema.parse(id);

  return updateAndFetch(validId, {
    googleEntityStatus: 'ERROR',
    status: 'ERROR',
    updatedAt: new Date(),
  });
}

/**
 * Get Google campaigns by partner ID
 */
export async function getGoogleCampaignsByPartnerId(partnerId: string) {
  const validPartnerId = IdSchema.parse(partnerId);

  const docs = await campaignDocs(
    campaigns()
      .where('partnerId', '==', validPartnerId)
      .where('platforms', 'array-contains', 'GOOGLE')
  );

  return z.array(CampaignWithAdsSchema).parse(await withAds(docs));
}
