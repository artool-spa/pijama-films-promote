import prisma from '#prisma';
import { z } from 'zod';

// ============================================================================
// SHARED SCHEMAS
// ============================================================================

const MetaEntityStatusSchema = z.enum(['DRAFT', 'PENDING', 'ACTIVE', 'PAUSED', 'ARCHIVED', 'ERROR']);
const CampaignObjectiveSchema = z.enum(['CONVERSIONS', 'LANDING_PAGE_VIEW']);
const BudgetTypeSchema = z.enum(['DAILY', 'LIFETIME']);

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
    imageIds: z.array(z.string().cuid()).max(10).default([]),
    videoIds: z.array(z.string().cuid()).max(10).default([]),
    // Campaign relation
    campaignId: z.string().cuid(),
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
    imageIds: z.array(z.string().cuid()).max(10).optional(),
    videoIds: z.array(z.string().cuid()).max(10).optional(),
    metaAdId: z.string().optional(),
  })
  .strict();

export const AdBulkCreateSchema = z
  .object({
    name: z.string().min(1).max(255),
    headlines: z.array(z.string().min(1).max(255)).min(1).max(5),
    bodies: z.array(z.string().min(1).max(2200)).min(1).max(5),
    descriptions: z.array(z.string().max(30)).max(5).default([]),
    callToAction: z.string().default('WATCH_MORE'),
    linkUrl: z.string().url(),
    imageIds: z.array(z.string().cuid()).max(10).default([]),
    videoIds: z.array(z.string().cuid()).max(10).default([]),
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

export const AdSchema = z.object({
  id: z.string().cuid(),
  metaAdId: z.string().nullable(),
  name: z.string(),
  status: MetaEntityStatusSchema,
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
  metaConversionsCampaignId: z.string().nullable(),
  metaLandingPageCampaignId: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CampaignSchema = z.object({
  id: z.string().cuid(),
  metaAdSetId: z.string().nullable(),
  name: z.string(),
  status: MetaEntityStatusSchema,
  objective: CampaignObjectiveSchema,
  budget: z.number(),
  budgetType: BudgetTypeSchema,
  startDate: z.coerce.date(),
  endDate: z.coerce.date().nullable(),
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
const IdSchema = z.string().cuid();
const MetaAdIdSchema = z.string().min(1);

// ============================================================================
// QUERY FUNCTIONS
// ============================================================================

/**
 * Get ad by ID with full details
 */
export async function getAdById(id: string) {
  const validId = IdSchema.parse(id);

  const result = await prisma.ad.findUnique({
    where: { id: validId },
    include: {
      images: true,
      videos: true,
      campaign: {
        include: {
          partner: true,
        },
      },
    },
  });

  if (!result) return null;

  return AdWithCampaignAndPartnerSchema.parse(result);
}

/**
 * Get ads by campaign ID
 */
export async function getAdsByCampaignId(campaignId: string) {
  const validCampaignId = IdSchema.parse(campaignId);

  const results = await prisma.ad.findMany({
    where: { campaignId: validCampaignId },
    include: {
      images: true,
      videos: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return z.array(AdSchema).parse(results);
}

/**
 * Get ad by its Meta API ID
 */
export async function getAdByMetaId(metaAdId: string) {
  const validMetaAdId = MetaAdIdSchema.parse(metaAdId);

  const result = await prisma.ad.findUnique({
    where: { metaAdId: validMetaAdId },
    include: {
      images: true,
      videos: true,
    },
  });

  if (!result) return null;

  return AdSchema.parse(result);
}

// ============================================================================
// MUTATION FUNCTIONS
// ============================================================================

/**
 * Create a new ad
 */
export async function createAd(data: AdCreateInput) {
  const validated = AdCreateSchema.parse(data);
  const { imageIds, videoIds, ...adData } = validated;

  const result = await prisma.ad.create({
    data: {
      ...adData,
      status: 'DRAFT',
      images: imageIds.length > 0 ? { connect: imageIds.map((id) => ({ id })) } : undefined,
      videos: videoIds.length > 0 ? { connect: videoIds.map((id) => ({ id })) } : undefined,
    },
    include: {
      images: true,
      videos: true,
      campaign: true,
    },
  });

  return AdWithCampaignSchema.parse(result);
}

/**
 * Update an existing ad
 */
export async function updateAd(id: string, data: AdUpdateInput) {
  const validId = IdSchema.parse(id);
  const validated = AdUpdateSchema.parse(data);
  const { imageIds, videoIds, ...adData } = validated;

  const result = await prisma.ad.update({
    where: { id: validId },
    data: {
      ...adData,
      syncedAt: validated.metaAdId ? new Date() : undefined,
      // Replace images if provided (set replaces all existing connections)
      images: imageIds ? { set: imageIds.map((id) => ({ id })) } : undefined,
      // Replace videos if provided
      videos: videoIds ? { set: videoIds.map((id) => ({ id })) } : undefined,
    },
    include: {
      images: true,
      videos: true,
    },
  });

  return AdSchema.parse(result);
}

/**
 * Delete an ad (only if in DRAFT status)
 */
export async function deleteAd(id: string) {
  const validId = IdSchema.parse(id);

  const ad = await prisma.ad.findUnique({
    where: { id: validId },
    select: { status: true },
  });

  const statusResult = z.object({ status: MetaEntityStatusSchema }).nullable().parse(ad);

  if (statusResult?.status !== 'DRAFT') {
    throw new Error('Solo se pueden eliminar anuncios en estado borrador');
  }

  const result = await prisma.ad.delete({
    where: { id: validId },
    include: {
      images: true,
      videos: true,
    },
  });

  return AdSchema.parse(result);
}

/**
 * Bulk create ads for a campaign
 */
export async function createAdsForCampaign(
  campaignId: string,
  adsData: AdBulkCreateInput[]
) {
  const validCampaignId = IdSchema.parse(campaignId);
  const validatedAds = z.array(AdBulkCreateSchema).parse(adsData);

  const results = await prisma.$transaction(
    validatedAds.map(({ imageIds, videoIds, ...adData }) =>
      prisma.ad.create({
        data: {
          ...adData,
          campaignId: validCampaignId,
          status: 'DRAFT',
          images: imageIds.length > 0 ? { connect: imageIds.map((id) => ({ id })) } : undefined,
          videos: videoIds.length > 0 ? { connect: videoIds.map((id) => ({ id })) } : undefined,
        },
        include: {
          images: true,
          videos: true,
        },
      })
    )
  );

  return z.array(AdSchema).parse(results);
}

/**
 * Mark ad as synced with Meta API
 */
export async function markAdSynced(id: string, metaAdId: string) {
  const validId = IdSchema.parse(id);
  const validMetaAdId = MetaAdIdSchema.parse(metaAdId);

  const result = await prisma.ad.update({
    where: { id: validId },
    data: {
      metaAdId: validMetaAdId,
      status: 'PENDING',
      syncedAt: new Date(),
    },
    include: {
      images: true,
      videos: true,
    },
  });

  return AdSchema.parse(result);
}

/**
 * Mark ad as having a sync error
 */
export async function markAdError(id: string) {
  const validId = IdSchema.parse(id);

  const result = await prisma.ad.update({
    where: { id: validId },
    data: { status: 'ERROR' },
    include: {
      images: true,
      videos: true,
    },
  });

  return AdSchema.parse(result);
}
