import prisma from '#prisma';
import { z } from 'zod';

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
  id: z.string().cuid(),
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

const AdSchema = z.object({
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

const CampaignSchema = z.object({
  id: z.string().cuid(),
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
  partnerId: z.string().cuid(),
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
const IdSchema = z.string().cuid();
const PartnerIdSchema = z.string().min(1);

// ============================================================================
// QUERY FUNCTIONS
// ============================================================================

/**
 * Get partner by internal ID
 */
export async function getPartnerById(id: string) {
  const validId = IdSchema.parse(id);

  const result = await prisma.partner.findUnique({
    where: { id: validId },
    include: {
      campaigns: {
        include: {
          ads: {
            include: {
              images: true,
              videos: true,
            },
          },
        },
      },
    },
  });

  if (!result) return null;

  return PartnerWithCampaignsSchema.parse(result);
}

/**
 * Get partner by external Pijama partner ID
 */
export async function getPartnerByPartnerId(partnerId: string) {
  const validPartnerId = PartnerIdSchema.parse(partnerId);

  const result = await prisma.partner.findUnique({
    where: { partnerId: validPartnerId },
    include: {
      campaigns: {
        include: {
          ads: {
            include: {
              images: true,
              videos: true,
            },
          },
        },
      },
    },
  });

  if (!result) return null;

  return PartnerWithCampaignsSchema.parse(result);
}

/**
 * Get all partners
 */
export async function getAllPartners() {
  const results = await prisma.partner.findMany({
    include: {
      _count: {
        select: { campaigns: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return z.array(PartnerWithCountSchema).parse(results);
}

// ============================================================================
// MUTATION FUNCTIONS
// ============================================================================

/**
 * Create a new partner
 */
export async function createPartner(data: PartnerCreateInput) {
  const validated = PartnerCreateSchema.parse(data);

  const result = await prisma.partner.create({
    data: validated,
  });

  return PartnerSchema.parse(result);
}

/**
 * Update an existing partner
 */
export async function updatePartner(id: string, data: PartnerUpdateInput) {
  const validId = IdSchema.parse(id);
  const validated = PartnerUpdateSchema.parse(data);

  const result = await prisma.partner.update({
    where: { id: validId },
    data: validated,
  });

  return PartnerSchema.parse(result);
}

/**
 * Get or create a partner by external Pijama partner ID
 */
export async function getOrCreatePartner(partnerId: string, name: string) {
  const validPartnerId = PartnerIdSchema.parse(partnerId);
  const validName = z.string().min(1).max(255).parse(name);

  const existing = await prisma.partner.findUnique({
    where: { partnerId: validPartnerId },
  });

  if (existing) return PartnerSchema.parse(existing);

  return await createPartner({ partnerId: validPartnerId, name: validName });
}

/**
 * Delete a partner (only if they have no campaigns)
 */
export async function deletePartner(id: string) {
  const validId = IdSchema.parse(id);

  const partner = await prisma.partner.findUnique({
    where: { id: validId },
    include: {
      _count: {
        select: { campaigns: true },
      },
    },
  });

  if (!partner) {
    throw new Error('Partner no encontrado');
  }

  const validated = PartnerWithCountSchema.parse(partner);

  if (validated._count.campaigns > 0) {
    throw new Error('No se puede eliminar un partner con campañas activas');
  }

  const result = await prisma.partner.delete({
    where: { id: validId },
  });

  return PartnerSchema.parse(result);
}
