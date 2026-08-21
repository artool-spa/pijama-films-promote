import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { COLLECTIONS, IdSchema as DocIdSchema, docData, sanitize } from '@/lib/firestore';
import { attachMedia, loadByIds, createdAtMillis } from './hydrate';

// ============================================================================
// SHARED SCHEMAS
// ============================================================================

const MetaEntityStatusSchema = z.enum(['DRAFT', 'PENDING_ASSETS', 'PENDING', 'ACTIVE', 'PAUSED', 'ARCHIVED', 'ERROR']);
const CampaignObjectiveSchema = z.enum(['CONVERSIONS', 'LANDING_PAGE_VIEW']);
const BudgetTypeSchema = z.enum(['DAILY', 'LIFETIME']);
const AdSetTypeSchema = z.enum(['IMAGE', 'VIDEO']);
const AdPlatformSchema = z.enum(['META', 'GOOGLE']);
const GoogleEntityStatusSchema = z.enum(['DRAFT', 'PENDING', 'ENABLED', 'PAUSED', 'REMOVED', 'ERROR']);
const YouTubeAdFormatSchema = z.enum(['IN_STREAM_SKIPPABLE', 'IN_STREAM_NON_SKIPPABLE', 'IN_FEED', 'BUMPER', 'SHORTS']);
export const AdApprovalStatusSchema = z.enum(['UNKNOWN', 'PENDING_REVIEW', 'APPROVED', 'APPROVED_LIMITED', 'DISAPPROVED', 'APPEALED']);
export type AdApprovalStatusValue = z.infer<typeof AdApprovalStatusSchema>;
const ApprovalSummarySchema = z.enum(['ALL_APPROVED', 'SOME_PENDING', 'SOME_DISAPPROVED', 'ALL_DISAPPROVED', 'UNKNOWN']);

// ============================================================================
// VALIDATION SCHEMAS - INPUT (strict, no extra fields allowed)
// ============================================================================

export const AdCreateSchema = z
  .object({
    name: z.string().min(1).max(255),
    // Creative content - arrays for Meta dynamic creative testing
    headlines: z.array(z.string().min(1).max(255)).min(1).max(5),
    bodies: z.array(z.string().min(1).max(2200)).min(1).max(5),
    descriptions: z.array(z.string().max(30)).max(5).default([]),
    callToAction: z.string().default('WATCH_MORE'),
    linkUrl: z.string().url(),
    // Media relations
    imageIds: z.array(DocIdSchema).max(10).default([]),
    videoIds: z.array(DocIdSchema).max(10).default([]),
    // Campaign relation
    campaignId: DocIdSchema,
  })
  .strict()
  .refine(
    (data) => data.imageIds.length > 0 || data.videoIds.length > 0,
    { message: 'Se requiere al menos una imagen o video' }
  );

export const AdUpdateSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    status: MetaEntityStatusSchema.optional(),
    headlines: z.array(z.string().min(1).max(255)).min(1).max(5).optional(),
    bodies: z.array(z.string().min(1).max(2200)).min(1).max(5).optional(),
    descriptions: z.array(z.string().max(30)).max(5).optional(),
    callToAction: z.string().optional(),
    linkUrl: z.string().url().optional(),
    imageIds: z.array(DocIdSchema).max(10).optional(),
    videoIds: z.array(DocIdSchema).max(10).optional(),
    metaAdId: z.string().optional(),
  })
  .strict();

export const AdBulkCreateSchema = z
  .object({
    name: z.string().min(1).max(255),
    // adSetType is auto-detected based on media: IMAGE if has images, VIDEO if has videos
    // If both provided, caller must specify which type this ad is for
    adSetType: AdSetTypeSchema.optional(),
    headlines: z.array(z.string().min(1).max(255)).min(1).max(5),
    bodies: z.array(z.string().min(1).max(2200)).min(1).max(5),
    descriptions: z.array(z.string().max(30)).max(5).default([]),
    callToAction: z.string().default('WATCH_MORE'),
    linkUrl: z.string().url(),
    imageIds: z.array(DocIdSchema).max(10).default([]),
    videoIds: z.array(DocIdSchema).max(10).default([]),
  })
  .strict()
  .refine(
    (data) => data.imageIds.length > 0 || data.videoIds.length > 0,
    { message: 'Se requiere al menos una imagen o video' }
  );

export type AdCreateInput = z.infer<typeof AdCreateSchema>;
export type AdUpdateInput = z.infer<typeof AdUpdateSchema>;
export type AdBulkCreateInput = z.infer<typeof AdBulkCreateSchema>;

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
  aspectRatio: z.string().nullable(),
  createdAt: z.coerce.date(),
});

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
  // Dimensions travel with the hydrated ad because the Meta sync buckets each
  // asset by aspect ratio. Zod strips unknown keys, so leaving them out here
  // made every video look like a feed asset no matter its shape.
  width: z.number().int().nullable().default(null),
  height: z.number().int().nullable().default(null),
  aspectRatio: z.string().nullable().default(null),
  thumbnailUrl: z.string().nullable(),
  metaVideoId: z.string().nullable(),
  youtubeVideoId: z.string().nullable(),
  createdAt: z.coerce.date(),
});

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
  // CBO Meta IDs
  metaCampaignId: z.string().nullable(),
  imageAdSetId: z.string().nullable(),
  videoAdSetId: z.string().nullable(),
  // Google Ads IDs
  googleCampaignId: z.string().nullable(),
  googleAdGroupId: z.string().nullable(),
  googleEntityStatus: GoogleEntityStatusSchema.nullable(),
  googleBidStrategy: z.string().nullable(),
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
  approvalSummary: ApprovalSummarySchema.nullable(),
  lastSyncError: z.string().nullable(),
  lastSyncErrorAt: z.coerce.date().nullable(),
  lastSyncErrorDetails: z.unknown().nullable(),
});

export const AdWithCampaignSchema = AdSchema.extend({
  campaign: CampaignSchema,
});

export const AdWithCampaignAndPartnerSchema = AdSchema.extend({
  campaign: CampaignSchema.extend({
    partner: PartnerSchema,
  }),
});

export type Ad = z.infer<typeof AdSchema>;
export type AdWithCampaign = z.infer<typeof AdWithCampaignSchema>;
export type AdWithCampaignAndPartner = z.infer<typeof AdWithCampaignAndPartnerSchema>;

// Input validation helpers
const IdSchema = DocIdSchema;
const MetaAdIdSchema = z.string().min(1);

// ============================================================================
// FIRESTORE HELPERS
// ============================================================================

type Doc = Record<string, unknown>;

function ads() {
  return adminDb().collection(COLLECTIONS.ads);
}

/** Column defaults Postgres applied on insert. */
function createDefaults() {
  return {
    metaAdId: null,
    googleAdId: null,
    youtubeAdFormat: null,
    status: 'DRAFT',
    adSetType: 'IMAGE',
    syncedAt: null,
    approvalStatus: 'UNKNOWN',
    approvalCheckedAt: null,
    rejectionReason: null,
    rejectionDetails: null,
    suggestedCorrection: null,
    reviewSeenAt: null,
  };
}

/**
 * Apply a partial update and return the ad with its media attached, which is
 * the shape every mutation returned under Prisma's `include`.
 */
async function updateAndFetch(id: string, data: Doc): Promise<Ad> {
  const ref = ads().doc(id);
  await ref.update(sanitize({ ...data, updatedAt: new Date() }));

  const snap = await ref.get();
  const [hydrated] = await attachMedia([docData(snap) as Doc]);

  return AdSchema.parse(hydrated);
}

async function campaignDoc(campaignId: string): Promise<Doc | undefined> {
  const map = await loadByIds(COLLECTIONS.campaigns, [campaignId]);
  return map.get(campaignId);
}

// ============================================================================
// QUERY FUNCTIONS
// ============================================================================

/**
 * Get ad by ID with full details
 */
export async function getAdById(id: string) {
  const validId = IdSchema.parse(id);

  const snap = await ads().doc(validId).get();
  const ad = docData(snap);

  if (!ad) return null;

  const [hydrated] = await attachMedia([ad]);
  const campaign = await campaignDoc(ad.campaignId as string);
  const partners = await loadByIds(COLLECTIONS.partners, [campaign?.partnerId as string]);

  return AdWithCampaignAndPartnerSchema.parse({
    ...hydrated,
    campaign: { ...campaign, partner: partners.get(campaign?.partnerId as string) },
  });
}

/**
 * Get ads by campaign ID
 */
export async function getAdsByCampaignId(campaignId: string) {
  const validCampaignId = IdSchema.parse(campaignId);

  const snap = await ads().where('campaignId', '==', validCampaignId).get();

  const docs = snap.docs
    .map(docData)
    .filter((doc): doc is Doc => doc !== null)
    .sort((a, b) => createdAtMillis(b) - createdAtMillis(a));

  return z.array(AdSchema).parse(await attachMedia(docs));
}

/**
 * Get ad by its Meta API ID
 */
export async function getAdByMetaId(metaAdId: string) {
  const validMetaAdId = MetaAdIdSchema.parse(metaAdId);

  const snap = await ads().where('metaAdId', '==', validMetaAdId).limit(1).get();

  if (snap.empty) return null;

  const [hydrated] = await attachMedia([docData(snap.docs[0]) as Doc]);

  return AdSchema.parse(hydrated);
}

// ============================================================================
// MUTATION FUNCTIONS
// ============================================================================

/**
 * Create a new ad
 */
export async function createAd(data: AdCreateInput) {
  const validated = AdCreateSchema.parse(data);

  const ref = ads().doc();
  const now = new Date();
  // The join table became `imageIds` / `videoIds` on the document itself, so
  // the ids the caller passes are stored as-is.
  const document = {
    ...createDefaults(),
    ...sanitize(validated),
    createdAt: now,
    updatedAt: now,
  };

  await ref.set(document);

  const [hydrated] = await attachMedia([{ id: ref.id, ...document }]);
  const campaign = await campaignDoc(validated.campaignId);

  return AdWithCampaignSchema.parse({ ...hydrated, campaign });
}

/**
 * Update an existing ad
 */
export async function updateAd(id: string, data: AdUpdateInput) {
  const validId = IdSchema.parse(id);
  const validated = AdUpdateSchema.parse(data);

  // Passing `imageIds` replaces the whole list, matching the `set` semantics of
  // the previous relation update.
  return updateAndFetch(validId, {
    ...validated,
    syncedAt: validated.metaAdId ? new Date() : undefined,
  });
}

/**
 * Delete an ad (only if in DRAFT status)
 */
export async function deleteAd(id: string) {
  const validId = IdSchema.parse(id);

  const snap = await ads().doc(validId).get();
  const ad = docData(snap);

  if (ad?.status !== 'DRAFT') {
    throw new Error('Solo se pueden eliminar anuncios en estado borrador');
  }

  const [hydrated] = await attachMedia([ad]);

  await ads().doc(validId).delete();

  return AdSchema.parse(hydrated);
}

/**
 * Bulk create ads for a campaign
 * Auto-detects adSetType based on media: VIDEO if has videos, IMAGE otherwise
 */
export async function createAdsForCampaign(campaignId: string, adsData: AdBulkCreateInput[]) {
  const validCampaignId = IdSchema.parse(campaignId);
  const validatedAds = z.array(AdBulkCreateSchema).parse(adsData);

  // One batch keeps the insert atomic, as the Prisma transaction did.
  const batch = adminDb().batch();
  const now = new Date();

  const documents = validatedAds.map(({ adSetType, ...adData }) => {
    const ref = ads().doc();
    // Auto-detect adSetType: VIDEO if has videos, IMAGE otherwise
    const detectedType = adSetType || (adData.videoIds.length > 0 ? 'VIDEO' : 'IMAGE');

    const document = {
      ...createDefaults(),
      ...sanitize(adData),
      adSetType: detectedType,
      campaignId: validCampaignId,
      createdAt: now,
      updatedAt: now,
    };

    batch.set(ref, document);

    return { id: ref.id, ...document };
  });

  await batch.commit();

  return z.array(AdSchema).parse(await attachMedia(documents));
}

/**
 * Mark ad as synced with Meta API
 */
export async function markAdSynced(id: string, metaAdId: string) {
  const validId = IdSchema.parse(id);
  const validMetaAdId = MetaAdIdSchema.parse(metaAdId);

  return updateAndFetch(validId, {
    metaAdId: validMetaAdId,
    status: 'PENDING',
    syncedAt: new Date(),
  });
}

/**
 * Mark ad as having a sync error
 */
export async function markAdError(id: string) {
  const validId = IdSchema.parse(id);

  return updateAndFetch(validId, { status: 'ERROR' });
}

// ============================================================================
// GOOGLE ADS SYNC FUNCTIONS
// ============================================================================

/**
 * Mark ad as synced with Google Ads
 */
export async function markGoogleAdSynced(id: string, googleAdId: string, youtubeAdFormat?: string) {
  const validId = IdSchema.parse(id);
  const validGoogleAdId = z.string().min(1).parse(googleAdId);
  const validFormat = youtubeAdFormat ? YouTubeAdFormatSchema.parse(youtubeAdFormat) : undefined;

  return updateAndFetch(validId, {
    googleAdId: validGoogleAdId,
    youtubeAdFormat: validFormat,
    status: 'PENDING',
    syncedAt: new Date(),
  });
}

// ============================================================================
// APPROVAL / REVIEW TRACKING
// ============================================================================

/**
 * Persist the platform-side review result for an ad.
 * Called by the sync-ad-approvals cron and by on-demand refresh endpoints.
 */
export async function updateAdApproval(
  id: string,
  data: {
    approvalStatus: AdApprovalStatusValue;
    rejectionReason?: string | null;
    rejectionDetails?: unknown;
    suggestedCorrection?: string | null;
  }
) {
  const validId = IdSchema.parse(id);
  const validated = z
    .object({
      approvalStatus: AdApprovalStatusSchema,
      rejectionReason: z.string().nullable().optional(),
      suggestedCorrection: z.string().nullable().optional(),
    })
    .parse({
      approvalStatus: data.approvalStatus,
      rejectionReason: data.rejectionReason,
      suggestedCorrection: data.suggestedCorrection,
    });

  return updateAndFetch(validId, {
    approvalStatus: validated.approvalStatus,
    approvalCheckedAt: new Date(),
    rejectionReason: validated.rejectionReason ?? null,
    rejectionDetails: data.rejectionDetails,
    suggestedCorrection: validated.suggestedCorrection ?? null,
    // When a new review comes in, clear the "seen" flag so the badge shows again.
    reviewSeenAt:
      validated.approvalStatus === 'DISAPPROVED' || validated.approvalStatus === 'APPROVED_LIMITED'
        ? null
        : undefined,
  });
}

/**
 * Mark that the producer has opened the review details for an ad.
 */
export async function markAdReviewSeen(id: string) {
  const validId = IdSchema.parse(id);

  return updateAndFetch(validId, { reviewSeenAt: new Date() });
}

/**
 * Get every ad that needs its approval status refreshed from Meta/Google.
 *
 * The campaign-status condition was a join, so the campaigns are resolved
 * first and their ads fetched by id; the freshness cutoff and the "never
 * checked first" ordering are applied in memory, which avoids an index on
 * every combination of the three predicates.
 */
export async function getAdsNeedingApprovalRefresh(options: {
  olderThanMinutes: number;
  metaLimit?: number;
  googleLimit?: number;
}) {
  const cutoff = new Date(Date.now() - options.olderThanMinutes * 60_000);

  const campaignSnap = await adminDb()
    .collection(COLLECTIONS.campaigns)
    .where('status', 'in', ['PENDING', 'ACTIVE'])
    .get();

  const campaigns = campaignSnap.docs
    .map(docData)
    .filter((doc): doc is Doc => doc !== null);

  if (campaigns.length === 0) {
    return { metaAds: [], googleAds: [] };
  }

  const partnerByCampaign = new Map(
    campaigns.map((campaign) => [campaign.id as string, campaign.partnerId as string])
  );

  const chunks: string[][] = [];
  const campaignIds = [...partnerByCampaign.keys()];
  for (let i = 0; i < campaignIds.length; i += 30) {
    chunks.push(campaignIds.slice(i, i + 30));
  }

  const snaps = await Promise.all(
    chunks.map((batch) => ads().where('campaignId', 'in', batch).get())
  );

  const candidates = snaps
    .flatMap((snap) => snap.docs.map(docData))
    .filter((ad): ad is Doc => ad !== null)
    .filter((ad) => {
      const checkedAt = ad.approvalCheckedAt;
      return checkedAt === null || !(checkedAt instanceof Date) || checkedAt < cutoff;
    })
    // Never-checked ads first, then the stalest.
    .sort((a, b) => {
      const left = a.approvalCheckedAt instanceof Date ? a.approvalCheckedAt.getTime() : -1;
      const right = b.approvalCheckedAt instanceof Date ? b.approvalCheckedAt.getTime() : -1;
      return left - right;
    });

  const metaAds = candidates
    .filter((ad) => ad.metaAdId !== null)
    .slice(0, options.metaLimit ?? 50)
    .map((ad) => ({
      id: ad.id as string,
      metaAdId: ad.metaAdId as string,
      campaignId: ad.campaignId as string,
    }));

  const googleAds = candidates
    .filter((ad) => ad.googleAdId !== null)
    .slice(0, options.googleLimit ?? 50)
    .map((ad) => ({
      id: ad.id as string,
      googleAdId: ad.googleAdId as string,
      campaignId: ad.campaignId as string,
      campaign: { partnerId: partnerByCampaign.get(ad.campaignId as string) as string },
    }));

  return { metaAds, googleAds };
}

/**
 * Get disapproved ads for a campaign (used by the UI banner).
 */
export async function getDisapprovedAdsByCampaign(campaignId: string) {
  const validId = IdSchema.parse(campaignId);

  const snap = await ads()
    .where('campaignId', '==', validId)
    .where('approvalStatus', '==', 'DISAPPROVED')
    .get();

  return snap.docs
    .map(docData)
    .filter((ad): ad is Doc => ad !== null)
    .map((ad) => ({
      id: ad.id as string,
      name: ad.name as string,
      rejectionReason: (ad.rejectionReason ?? null) as string | null,
      approvalStatus: AdApprovalStatusSchema.parse(ad.approvalStatus),
    }));
}
