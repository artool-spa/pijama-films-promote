import prisma from '#prisma';
import { z } from 'zod';
import type { BudgetType, CampaignObjective } from '@prisma/client';

// ============================================================================
// SHARED SCHEMAS
// ============================================================================

const MetaEntityStatusSchema = z.enum(['DRAFT', 'PENDING', 'ACTIVE', 'PAUSED', 'ARCHIVED', 'ERROR']);
const CampaignObjectiveSchema = z.enum(['CONVERSIONS', 'LANDING_PAGE_VIEW']);
const BudgetTypeSchema = z.enum(['DAILY', 'LIFETIME']);

// ============================================================================
// VALIDATION SCHEMAS - INPUT (strict, no extra fields allowed)
// ============================================================================

export const CampaignCreateSchema = z
  .object({
    name: z.string().min(1).max(255),
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
    // Film reference (MUVI UUID)
    filmMuviUuid: z.string().min(1),
    // Partner relation
    partnerId: z.string().cuid(),
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
  })
  .strict();

export type CampaignCreateInput = z.infer<typeof CampaignCreateSchema>;
export type CampaignUpdateInput = z.infer<typeof CampaignUpdateSchema>;

// ============================================================================
// VALIDATION SCHEMAS - OUTPUT (validate database results)
// ============================================================================

const ImageSchema = z.object({
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
  createdAt: z.coerce.date(),
});

const VideoSchema = z.object({
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

const AdSetTypeSchema = z.enum(['IMAGE', 'VIDEO']);

export const AdSchema = z.object({
  id: z.string().cuid(),
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
  campaignId: z.string().cuid(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  syncedAt: z.coerce.date().nullable(),
});

export const PartnerSchema = z.object({
  id: z.string().cuid(),
  partnerId: z.string(),
  name: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CampaignSchema = z.object({
  id: z.string().cuid(),
  // CBO Meta IDs (dedicated campaign per local campaign)
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
  partnerId: z.string().cuid(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  syncedAt: z.coerce.date().nullable(),
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
const IdSchema = z.string().cuid();
const FilmMuviUuidSchema = z.string().min(1);

// ============================================================================
// QUERY FUNCTIONS
// ============================================================================

/**
 * Get campaign by ID with full details
 */
export async function getCampaignById(id: string) {
  const validId = IdSchema.parse(id);

  const result = await prisma.campaign.findUnique({
    where: { id: validId },
    include: {
      partner: true,
      ads: {
        include: {
          images: true,
          videos: true,
        },
      },
    },
  });

  if (!result) return null;

  return CampaignWithPartnerAndAdsSchema.parse(result);
}

/**
 * Get campaigns by film MUVI UUID
 */
export async function getCampaignsByFilmMuviUuid(filmMuviUuid: string) {
  const validFilmMuviUuid = FilmMuviUuidSchema.parse(filmMuviUuid);

  const results = await prisma.campaign.findMany({
    where: { filmMuviUuid: validFilmMuviUuid },
    include: {
      ads: {
        include: {
          images: true,
          videos: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return z.array(CampaignWithAdsSchema).parse(results);
}

/**
 * Get campaigns by partner ID
 */
export async function getCampaignsByPartnerId(partnerId: string) {
  const validPartnerId = IdSchema.parse(partnerId);

  const results = await prisma.campaign.findMany({
    where: { partnerId: validPartnerId },
    include: {
      ads: {
        include: {
          images: true,
          videos: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return z.array(CampaignWithAdsSchema).parse(results);
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

  const results = await prisma.campaign.findMany({
    where: { partnerId: validPartnerId, objective: validObjective },
    include: {
      ads: {
        include: {
          images: true,
          videos: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return z.array(CampaignWithAdsSchema).parse(results);
}

/**
 * Get all active campaigns
 */
export async function getActiveCampaigns() {
  const results = await prisma.campaign.findMany({
    where: {
      status: 'ACTIVE',
      metaCampaignId: { not: null },
    },
    select: {
      id: true,
      metaCampaignId: true,
      imageAdSetId: true,
      videoAdSetId: true,
      ads: {
        where: { metaAdId: { not: null } },
        select: { id: true, metaAdId: true, adSetType: true },
      },
    },
  });

  const ActiveCampaignSchema = z.object({
    id: z.string().cuid(),
    metaCampaignId: z.string(),
    imageAdSetId: z.string().nullable(),
    videoAdSetId: z.string().nullable(),
    ads: z.array(
      z.object({
        id: z.string().cuid(),
        metaAdId: z.string(),
        adSetType: z.enum(['IMAGE', 'VIDEO']),
      })
    ),
  });

  return z.array(ActiveCampaignSchema).parse(results);
}

// ============================================================================
// MUTATION FUNCTIONS
// ============================================================================

/**
 * Create a new campaign
 */
export async function createCampaign(data: CampaignCreateInput) {
  const validated = CampaignCreateSchema.parse(data);

  const result = await prisma.campaign.create({
    data: {
      ...validated,
      budgetType: validated.budgetType as BudgetType,
      objective: validated.objective as CampaignObjective,
      status: 'DRAFT',
    },
    include: { partner: true },
  });

  return CampaignWithPartnerSchema.parse(result);
}

/**
 * Update an existing campaign
 */
export async function updateCampaign(id: string, data: CampaignUpdateInput) {
  const validId = IdSchema.parse(id);
  const validated = CampaignUpdateSchema.parse(data);

  // Determine if any Meta IDs are being set (indicates sync)
  const isSyncing = validated.metaCampaignId || validated.imageAdSetId || validated.videoAdSetId;

  const result = await prisma.campaign.update({
    where: { id: validId },
    data: {
      ...validated,
      syncedAt: isSyncing ? new Date() : undefined,
    },
  });

  return CampaignSchema.parse(result);
}

/**
 * Delete a campaign (only if in DRAFT status)
 */
export async function deleteCampaign(id: string) {
  const validId = IdSchema.parse(id);

  const campaign = await prisma.campaign.findUnique({
    where: { id: validId },
    select: { status: true },
  });

  const statusResult = z.object({ status: MetaEntityStatusSchema }).nullable().parse(campaign);

  if (statusResult?.status !== 'DRAFT') {
    throw new Error('Solo se pueden eliminar campañas en estado borrador');
  }

  const result = await prisma.campaign.delete({
    where: { id: validId },
  });

  return CampaignSchema.parse(result);
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

  const result = await prisma.campaign.update({
    where: { id: validId },
    data: {
      metaCampaignId: validMetaCampaignId,
      imageAdSetId: validImageAdSetId,
      videoAdSetId: validVideoAdSetId,
      status: 'PENDING',
      syncedAt: new Date(),
    },
  });

  return CampaignSchema.parse(result);
}

/**
 * Mark campaign as having a sync error
 */
export async function markCampaignError(id: string) {
  const validId = IdSchema.parse(id);

  const result = await prisma.campaign.update({
    where: { id: validId },
    data: { status: 'ERROR' },
  });

  return CampaignSchema.parse(result);
}
