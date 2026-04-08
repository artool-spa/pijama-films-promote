import { z } from 'zod';

// ============================================================================
// CONFIGURATION
// ============================================================================

export const GoogleAdsConfigSchema = z.object({
  developerToken: z.string().min(1, 'GOOGLE_ADS_DEVELOPER_TOKEN is required'),
  clientId: z.string().min(1, 'GOOGLE_ADS_CLIENT_ID is required'),
  clientSecret: z.string().min(1, 'GOOGLE_ADS_CLIENT_SECRET is required'),
  refreshToken: z.string().min(1, 'GOOGLE_ADS_REFRESH_TOKEN is required'),
  customerId: z.string().min(1, 'GOOGLE_ADS_CUSTOMER_ID is required'),
  loginCustomerId: z.string().optional(), // For MCC accounts
  apiVersion: z.string().default('v23'),
  baseUrl: z.string().url().default('https://googleads.googleapis.com'),
});

export type GoogleAdsConfig = z.infer<typeof GoogleAdsConfigSchema>;

// ============================================================================
// CAMPAIGN
// ============================================================================

export const YouTubeAdFormatSchema = z.enum([
  'IN_STREAM_SKIPPABLE',
  'IN_STREAM_NON_SKIPPABLE',
  'IN_FEED',
  'BUMPER',
  'SHORTS',
]);

export type YouTubeAdFormat = z.infer<typeof YouTubeAdFormatSchema>;

export const GoogleCampaignCreateSchema = z.object({
  name: z.string().min(1).max(255),
  budgetAmountMicros: z.bigint().positive(), // Budget in micros (millionths of currency)
  budgetType: z.enum(['DAILY', 'TOTAL']).default('TOTAL'),
  startDate: z.string(), // YYYY-MM-DD format
  endDate: z.string().optional(),
  status: z.enum(['ENABLED', 'PAUSED']).default('PAUSED'),
  biddingStrategy: z.enum([
    'TARGET_CPV',
    'MAXIMIZE_CONVERSIONS',
    'TARGET_CPA',
    'MAXIMIZE_CONVERSION_VALUE',
  ]).default('TARGET_CPV'),
  targetCpvMicros: z.bigint().optional(), // For TARGET_CPV strategy
});

export type GoogleCampaignCreate = z.infer<typeof GoogleCampaignCreateSchema>;

// ============================================================================
// AD GROUP
// ============================================================================

export const GoogleAdGroupCreateSchema = z.object({
  name: z.string().min(1).max(255),
  campaignResourceName: z.string(),
  status: z.enum(['ENABLED', 'PAUSED']).default('PAUSED'),
  cpcBidMicros: z.bigint().optional(),
  cpvBidMicros: z.bigint().optional(),
});

export type GoogleAdGroupCreate = z.infer<typeof GoogleAdGroupCreateSchema>;

// ============================================================================
// VIDEO AD
// ============================================================================

export const GoogleVideoAdCreateSchema = z.object({
  name: z.string().min(1).max(255),
  adGroupResourceName: z.string(),
  youtubeVideoId: z.string().min(1), // YouTube video ID
  adFormat: YouTubeAdFormatSchema,
  headline: z.string().max(30).optional(), // For in-feed ads
  description1: z.string().max(90).optional(),
  description2: z.string().max(90).optional(),
  displayUrl: z.string().optional(),
  finalUrl: z.string().url(),
  callToAction: z.string().optional(),
  companionBannerUrl: z.string().optional(),
});

export type GoogleVideoAdCreate = z.infer<typeof GoogleVideoAdCreateSchema>;

// ============================================================================
// TARGETING
// ============================================================================

export const GoogleTargetingSchema = z.object({
  countries: z.array(z.string()).default(['US']),
  ageMin: z.number().int().min(18).max(65).optional(),
  ageMax: z.number().int().min(18).max(65).optional(),
  genders: z.array(z.enum(['MALE', 'FEMALE', 'UNDETERMINED'])).optional(),
  affinityAudiences: z.array(z.string()).optional(), // Affinity audience resource names
  customAudiences: z.array(z.string()).optional(), // Custom audience resource names
  topicIds: z.array(z.string()).optional(), // Topic targeting
  keywordTexts: z.array(z.string()).optional(), // Keyword targeting
});

export type GoogleTargeting = z.infer<typeof GoogleTargetingSchema>;

// ============================================================================
// INSIGHTS / METRICS
// ============================================================================

export const GoogleInsightsResponseSchema = z.object({
  impressions: z.number().default(0),
  videoViews: z.number().default(0),
  videoViewRate: z.number().default(0),
  averageCpv: z.number().default(0), // In currency (not micros)
  costMicros: z.bigint().default(BigInt(0)),
  clicks: z.number().default(0),
  ctr: z.number().default(0),
  videoQuartile25Rate: z.number().default(0),
  videoQuartile50Rate: z.number().default(0),
  videoQuartile75Rate: z.number().default(0),
  videoQuartile100Rate: z.number().default(0),
  dateStart: z.string(),
  dateEnd: z.string(),
});

export type GoogleInsightsResponse = z.infer<typeof GoogleInsightsResponseSchema>;

// ============================================================================
// DEMAND GEN CAMPAIGN
// ============================================================================

export const DemandGenCampaignCreateSchema = z.object({
  name: z.string().min(1).max(255),
  budgetAmountMicros: z.bigint().positive(),
  budgetType: z.enum(['DAILY', 'TOTAL']).default('TOTAL'),
  startDate: z.string(), // YYYY-MM-DD format
  endDate: z.string().optional(),
  status: z.enum(['ENABLED', 'PAUSED']).default('PAUSED'),
  biddingStrategy: z.enum([
    'MAXIMIZE_CLICKS',
    'MAXIMIZE_CONVERSIONS',
    'TARGET_CPA',
  ]).default('MAXIMIZE_CLICKS'),
});

export type DemandGenCampaignCreate = z.infer<typeof DemandGenCampaignCreateSchema>;

// ============================================================================
// DEMAND GEN AD GROUP
// ============================================================================

export const DemandGenAdGroupCreateSchema = z.object({
  name: z.string().min(1).max(255),
  campaignResourceName: z.string(),
  status: z.enum(['ENABLED', 'PAUSED']).default('PAUSED'),
  cpcBidMicros: z.bigint().optional(),
});

export type DemandGenAdGroupCreate = z.infer<typeof DemandGenAdGroupCreateSchema>;

// ============================================================================
// DEMAND GEN IMAGE AD
// ============================================================================

export const DemandGenImageAdCreateSchema = z.object({
  name: z.string().min(1).max(255),
  adGroupResourceName: z.string(),
  landscapeImageAssetResourceNames: z.array(z.string()).default([]),
  squareImageAssetResourceNames: z.array(z.string()).default([]),
  portraitImageAssetResourceNames: z.array(z.string()).default([]),
  logoImageAssetResourceNames: z.array(z.string()).min(1),
  headlines: z.array(z.string().min(1).max(30)).min(1).max(5),
  descriptions: z.array(z.string().min(1).max(90)).min(1).max(5),
  finalUrl: z.string().url(),
  businessName: z.string().min(1).max(25),
}).refine(
  data => data.landscapeImageAssetResourceNames.length > 0
    || data.squareImageAssetResourceNames.length > 0
    || data.portraitImageAssetResourceNames.length > 0,
  { message: 'At least one image asset is required' }
);

export type DemandGenImageAdCreate = z.infer<typeof DemandGenImageAdCreateSchema>;

// ============================================================================
// DISPLAY INSIGHTS / METRICS
// ============================================================================

export const DisplayInsightsResponseSchema = z.object({
  impressions: z.number().default(0),
  clicks: z.number().default(0),
  ctr: z.number().default(0),
  averageCpc: z.number().default(0), // In currency (not micros)
  costMicros: z.bigint().default(BigInt(0)),
  conversions: z.number().default(0),
  cpm: z.number().default(0), // Cost per 1000 impressions
  cpc: z.number().default(0), // Cost per click (computed)
  costPerConversion: z.number().default(0),
  dateStart: z.string(),
  dateEnd: z.string(),
});

export type DisplayInsightsResponse = z.infer<typeof DisplayInsightsResponseSchema>;

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export const GoogleErrorResponseSchema = z.object({
  error: z.object({
    code: z.number(),
    message: z.string(),
    status: z.string(),
    details: z.array(z.unknown()).optional(),
  }),
});

export type GoogleErrorResponse = z.infer<typeof GoogleErrorResponseSchema>;

export interface GoogleMutateResponse {
  results: Array<{
    resourceName: string;
  }>;
}

export interface GoogleSearchResponse {
  results?: Array<Record<string, unknown>>;
  fieldMask?: string;
  totalResultsCount?: string;
}
