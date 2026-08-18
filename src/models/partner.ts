import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { COLLECTIONS, IdSchema as DocIdSchema, docData, sanitize } from '@/lib/firestore';
import { withAds, createdAtMillis } from './hydrate';

// ============================================================================
// SHARED SCHEMAS
// ============================================================================

const MetaEntityStatusSchema = z.enum(['DRAFT', 'PENDING_ASSETS', 'PENDING', 'ACTIVE', 'PAUSED', 'ARCHIVED', 'ERROR']);
const CampaignObjectiveSchema = z.enum(['CONVERSIONS', 'LANDING_PAGE_VIEW']);
const BudgetTypeSchema = z.enum(['DAILY', 'LIFETIME']);

// ============================================================================
// VALIDATION SCHEMAS - INPUT (strict, no extra fields allowed)
// ============================================================================

export const PartnerCreateSchema = z
  .object({
    partnerId: z.string().min(1),
    name: z.string().min(1).max(255),
  })
  .strict();

export const PartnerUpdateSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
  })
  .strict();

export type PartnerCreateInput = z.infer<typeof PartnerCreateSchema>;
export type PartnerUpdateInput = z.infer<typeof PartnerUpdateSchema>;

// ============================================================================
// VALIDATION SCHEMAS - OUTPUT (validate database results)
// ============================================================================

export const PartnerSchema = z.object({
  id: DocIdSchema,
  partnerId: z.string(),
  name: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const PartnerWithCountSchema = PartnerSchema.extend({
  _count: z.object({
    campaigns: z.number().int().nonnegative(),
  }),
});

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
  thumbnailUrl: z.string().nullable(),
  metaVideoId: z.string().nullable(),
  createdAt: z.coerce.date(),
});

const AdSetTypeSchema = z.enum(['IMAGE', 'VIDEO']);

const AdSchema = z.object({
  id: DocIdSchema,
  metaAdId: z.string().nullable(),
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
});

const CampaignSchema = z.object({
  id: DocIdSchema,
  // CBO Meta IDs
  metaCampaignId: z.string().nullable(),
  imageAdSetId: z.string().nullable(),
  videoAdSetId: z.string().nullable(),
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
  ads: z.array(AdSchema),
});

export const PartnerWithCampaignsSchema = PartnerSchema.extend({
  campaigns: z.array(CampaignSchema),
});

export type Partner = z.infer<typeof PartnerSchema>;
export type PartnerWithCount = z.infer<typeof PartnerWithCountSchema>;
export type PartnerWithCampaigns = z.infer<typeof PartnerWithCampaignsSchema>;

// Input validation helpers
const IdSchema = DocIdSchema;
const PartnerIdSchema = z.string().min(1);

// ============================================================================
// FIRESTORE HELPERS
// ============================================================================

type Doc = Record<string, unknown>;

function partners() {
  return adminDb().collection(COLLECTIONS.partners);
}

/** Campaigns of a partner, ads and media attached, newest first. */
async function campaignsOfPartner(partnerDocId: string): Promise<Doc[]> {
  const snap = await adminDb()
    .collection(COLLECTIONS.campaigns)
    .where('partnerId', '==', partnerDocId)
    .get();

  const docs = snap.docs
    .map(docData)
    .filter((doc): doc is Doc => doc !== null)
    .sort((a, b) => createdAtMillis(b) - createdAtMillis(a));

  return withAds(docs);
}

/**
 * How many campaigns a partner owns. An aggregation query, so it reads index
 * entries instead of pulling every campaign document back.
 */
async function countCampaigns(partnerDocId: string): Promise<number> {
  const snap = await adminDb()
    .collection(COLLECTIONS.campaigns)
    .where('partnerId', '==', partnerDocId)
    .count()
    .get();

  return snap.data().count;
}

// ============================================================================
// QUERY FUNCTIONS
// ============================================================================

/**
 * Get partner by internal ID
 */
export async function getPartnerById(id: string) {
  const validId = IdSchema.parse(id);

  const snap = await partners().doc(validId).get();
  const partner = docData(snap);

  if (!partner) return null;

  return PartnerWithCampaignsSchema.parse({
    ...partner,
    campaigns: await campaignsOfPartner(validId),
  });
}

/**
 * Get partner by external Pijama partner ID
 */
export async function getPartnerByPartnerId(partnerId: string) {
  const validPartnerId = PartnerIdSchema.parse(partnerId);

  const snap = await partners().where('partnerId', '==', validPartnerId).limit(1).get();

  if (snap.empty) return null;

  const partner = docData(snap.docs[0]) as Doc;

  return PartnerWithCampaignsSchema.parse({
    ...partner,
    campaigns: await campaignsOfPartner(partner.id as string),
  });
}

/**
 * Get a partner record on its own, without loading the campaign graph.
 *
 * Postgres returned the bare row for any `findUnique`; here the campaigns are
 * separate documents, so the callers that only need identity (auth, headers)
 * use this instead of paying for the fan-out.
 */
export async function getPartnerRecordById(id: string): Promise<Partner | null> {
  const validId = IdSchema.parse(id);

  const snap = await partners().doc(validId).get();
  const partner = docData(snap);

  return partner ? PartnerSchema.parse(partner) : null;
}

/** Same, keyed by the external Pijama partner id. */
export async function getPartnerRecordByPartnerId(partnerId: string): Promise<Partner | null> {
  const validPartnerId = PartnerIdSchema.parse(partnerId);

  const snap = await partners().where('partnerId', '==', validPartnerId).limit(1).get();

  return snap.empty ? null : PartnerSchema.parse(docData(snap.docs[0]));
}

/**
 * Get all partners
 */
export async function getAllPartners() {
  const snap = await partners().get();

  const docs = snap.docs
    .map(docData)
    .filter((doc): doc is Doc => doc !== null)
    .sort((a, b) => createdAtMillis(b) - createdAtMillis(a));

  const counts = await Promise.all(docs.map((partner) => countCampaigns(partner.id as string)));

  return z
    .array(PartnerWithCountSchema)
    .parse(docs.map((partner, index) => ({ ...partner, _count: { campaigns: counts[index] } })));
}

// ============================================================================
// MUTATION FUNCTIONS
// ============================================================================

/**
 * Create a new partner
 */
export async function createPartner(data: PartnerCreateInput) {
  const validated = PartnerCreateSchema.parse(data);

  const ref = partners().doc();
  const now = new Date();
  const document = { ...sanitize(validated), createdAt: now, updatedAt: now };

  await ref.set(document);

  return PartnerSchema.parse({ id: ref.id, ...document });
}

/**
 * Update an existing partner
 */
export async function updatePartner(id: string, data: PartnerUpdateInput) {
  const validId = IdSchema.parse(id);
  const validated = PartnerUpdateSchema.parse(data);

  const ref = partners().doc(validId);
  await ref.update(sanitize({ ...validated, updatedAt: new Date() }));

  const snap = await ref.get();

  return PartnerSchema.parse(docData(snap));
}

/**
 * Get or create a partner by external Pijama partner ID
 */
export async function getOrCreatePartner(partnerId: string, name: string) {
  const validPartnerId = PartnerIdSchema.parse(partnerId);
  const validName = z.string().min(1).max(255).parse(name);

  const snap = await partners().where('partnerId', '==', validPartnerId).limit(1).get();

  if (!snap.empty) return PartnerSchema.parse(docData(snap.docs[0]));

  return createPartner({ partnerId: validPartnerId, name: validName });
}

/**
 * Delete a partner (only if they have no campaigns)
 */
export async function deletePartner(id: string) {
  const validId = IdSchema.parse(id);

  const snap = await partners().doc(validId).get();
  const partner = docData(snap);

  if (!partner) {
    throw new Error('Partner no encontrado');
  }

  if ((await countCampaigns(validId)) > 0) {
    throw new Error('No se puede eliminar un partner con campañas activas');
  }

  await partners().doc(validId).delete();

  return PartnerSchema.parse(partner);
}
