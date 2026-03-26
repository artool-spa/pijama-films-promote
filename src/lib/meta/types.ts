import { z } from 'zod';

// ============================================================================
// CONFIGURATION
// ============================================================================

export const MetaConfigSchema = z.object({
  accessToken: z.string().min(1, 'META_ACCESS_TOKEN is required'),
  adAccountId: z.string().min(1, 'META_AD_ACCOUNT_ID is required'),
  pixelId: z.string().optional(),
  pageId: z.string().optional(),
  appId: z.string().optional(),
  appSecret: z.string().optional(),
  apiVersion: z.string().default('v19.0'),
  baseUrl: z.string().url().default('https://graph.facebook.com'),
});

export type MetaConfig = z.infer<typeof MetaConfigSchema>;

// ============================================================================
// API ERROR RESPONSE
// ============================================================================

export const MetaErrorResponseSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
    code: z.number(),
    error_subcode: z.number().optional(),
    fbtrace_id: z.string().optional(),
  }),
});

export type MetaErrorResponse = z.infer<typeof MetaErrorResponseSchema>;

// ============================================================================
// CAMPAIGN
// ============================================================================

export const MetaCampaignCreateSchema = z.object({
  name: z.string().min(1).max(255),
  objective: z
    .enum(['OUTCOME_SALES', 'OUTCOME_LEADS', 'OUTCOME_ENGAGEMENT', 'OUTCOME_TRAFFIC'])
    .optional()
    .default('OUTCOME_SALES'),
  status: z.enum(['ACTIVE', 'PAUSED']).optional().default('PAUSED'),
  special_ad_categories: z.array(z.string()).optional().default([]),
  // Campaign Budget Optimization (CBO) - budget at campaign level
  // When using CBO, AdSets don't have individual budgets
  daily_budget: z.number().int().positive().optional(), // In cents
  lifetime_budget: z.number().int().positive().optional(), // In cents
  // Bid strategy for CBO campaigns
  bid_strategy: z
    .enum(['LOWEST_COST_WITHOUT_CAP', 'LOWEST_COST_WITH_BID_CAP', 'COST_CAP'])
    .optional(),
  // Start/end times for lifetime budget campaigns
  start_time: z.string().optional(),
  end_time: z.string().optional(),
});

export const MetaCampaignResponseSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  objective: z.string().optional(),
  status: z.string().optional(),
  created_time: z.string().optional(),
  updated_time: z.string().optional(),
});

// Use z.input for the input type (before defaults are applied)
export type MetaCampaignCreate = z.input<typeof MetaCampaignCreateSchema>;
export type MetaCampaignResponse = z.infer<typeof MetaCampaignResponseSchema>;

// ============================================================================
// ADSET
// ============================================================================

// Interest/behavior item schema
const InterestItemSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
});

// Flexible spec for advanced targeting (v24.0+)
const TargetingFlexibleSpecSchema = z.object({
  interests: z.array(InterestItemSchema).optional(),
  behaviors: z.array(InterestItemSchema).optional(),
});

export const MetaTargetingSchema = z.object({
  // Use saved_audience_id for pre-configured audiences
  saved_audience_id: z.string().optional(),
  // Or use manual targeting fields
  geo_locations: z
    .object({
      countries: z.array(z.string()).default(['US']),
    })
    .optional(),
  age_min: z.number().int().min(13).max(65).optional(),
  age_max: z.number().int().min(13).max(65).optional(),
  genders: z.array(z.number().int()).optional(),
  // Legacy interests (pre-v24.0)
  interests: z.array(InterestItemSchema).optional(),
  // Flexible spec for combining interests/behaviors (v24.0+)
  flexible_spec: z.array(TargetingFlexibleSpecSchema).optional(),
  // Exclusions
  exclusions: z.object({
    interests: z.array(InterestItemSchema).optional(),
  }).optional(),
});

// Input type for targeting (before defaults)
export type MetaTargeting = z.input<typeof MetaTargetingSchema>;

export const MetaAdSetCreateSchema = z.object({
  name: z.string().min(1).max(255),
  campaign_id: z.string(),
  status: z.enum(['ACTIVE', 'PAUSED']).default('PAUSED'),
  daily_budget: z.number().int().positive().optional(),
  lifetime_budget: z.number().int().positive().optional(),
  start_time: z.string(),
  end_time: z.string().optional(),
  billing_event: z.enum(['IMPRESSIONS', 'LINK_CLICKS', 'APP_INSTALLS']).default('IMPRESSIONS'),
  optimization_goal: z
    .enum(['OFFSITE_CONVERSIONS', 'LANDING_PAGE_VIEWS', 'LINK_CLICKS', 'REACH'])
    .default('OFFSITE_CONVERSIONS'),
  bid_strategy: z
    .enum(['LOWEST_COST_WITHOUT_CAP', 'LOWEST_COST_WITH_BID_CAP', 'COST_CAP'])
    .default('LOWEST_COST_WITHOUT_CAP'),
  targeting: MetaTargetingSchema,
  promoted_object: z
    .object({
      pixel_id: z.string().optional(),
      custom_event_type: z.enum(['PURCHASE', 'ADD_TO_CART', 'VIEW_CONTENT', 'LEAD']).optional(),
      page_id: z.string().optional(),
    })
    .optional(),
  // Dynamic creative optimization
  is_dynamic_creative: z.boolean().optional(),
  // DSA compliance (required for EU-targeted campaigns)
  dsa_beneficiary: z.string().optional(),
  dsa_payor: z.string().optional(),
  // Advantage audience targeting automation
  targeting_automation: z.object({
    advantage_audience: z.number(),
  }).optional(),
});

export const MetaAdSetResponseSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  status: z.string().optional(),
  daily_budget: z.string().optional(),
  lifetime_budget: z.string().optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
});

export type MetaAdSetCreate = z.input<typeof MetaAdSetCreateSchema>;
export type MetaAdSetResponse = z.infer<typeof MetaAdSetResponseSchema>;

// ============================================================================
// AD CREATIVE
// ============================================================================

export const MetaAdCreativeCreateSchema = z.object({
  name: z.string().min(1).max(255),
  object_story_spec: z.object({
    page_id: z.string(),
    video_data: z
      .object({
        video_id: z.string(),
        title: z.string().max(255),
        message: z.string().max(2200),
        link_description: z.string().max(30).optional(),
        call_to_action: z.object({
          type: z.enum(['WATCH_MORE', 'LEARN_MORE', 'SHOP_NOW', 'SIGN_UP', 'BOOK_TRAVEL']),
          value: z.object({
            link: z.string().url(),
          }),
        }),
      })
      .optional(),
    link_data: z
      .object({
        link: z.string().url(),
        message: z.string().max(2200),
        name: z.string().max(255),
        description: z.string().max(30).optional(),
        image_hash: z.string(),
        call_to_action: z.object({
          type: z.enum(['WATCH_MORE', 'LEARN_MORE', 'SHOP_NOW', 'SIGN_UP']),
        }),
      })
      .optional(),
  }),
});

export type MetaAdCreativeCreate = z.infer<typeof MetaAdCreativeCreateSchema>;

// ============================================================================
// AD
// ============================================================================

export const MetaAdCreateSchema = z.object({
  name: z.string().min(1).max(255),
  adset_id: z.string(),
  creative: z.object({
    creative_id: z.string(),
  }),
  status: z.enum(['ACTIVE', 'PAUSED']).default('PAUSED'),
});

export const MetaAdResponseSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  status: z.string().optional(),
  creative: z
    .object({
      id: z.string(),
    })
    .optional(),
});

export type MetaAdCreate = z.infer<typeof MetaAdCreateSchema>;
export type MetaAdResponse = z.infer<typeof MetaAdResponseSchema>;

// ============================================================================
// INSIGHTS / STATS
// ============================================================================

export const MetaInsightsRequestSchema = z.object({
  level: z.enum(['campaign', 'adset', 'ad']),
  time_range: z.object({
    since: z.string(),
    until: z.string(),
  }),
  fields: z.array(z.string()).default([
    'impressions',
    'clicks',
    'spend',
    'reach',
    'frequency',
    'cpm',
    'cpc',
    'ctr',
    'actions',
    'cost_per_action_type',
  ]),
  breakdowns: z.array(z.string()).optional(),
});

export const MetaInsightDataSchema = z.object({
  publisher_platform: z.string().optional(),
  impressions: z.string().optional(),
  clicks: z.string().optional(),
  spend: z.string().optional(),
  reach: z.string().optional(),
  frequency: z.string().optional(),
  cpm: z.string().optional(),
  cpc: z.string().optional(),
  ctr: z.string().optional(),
  actions: z
    .array(
      z.object({
        action_type: z.string(),
        value: z.string(),
      })
    )
    .optional(),
  cost_per_action_type: z
    .array(
      z.object({
        action_type: z.string(),
        value: z.string(),
      })
    )
    .optional(),
  date_start: z.string().optional(),
  date_stop: z.string().optional(),
});

export const MetaInsightsResponseSchema = z.object({
  data: z.array(MetaInsightDataSchema),
  paging: z
    .object({
      cursors: z
        .object({
          before: z.string().optional(),
          after: z.string().optional(),
        })
        .optional(),
      next: z.string().optional(),
    })
    .optional(),
});

export type MetaInsightsRequest = z.infer<typeof MetaInsightsRequestSchema>;
export type MetaInsightData = z.infer<typeof MetaInsightDataSchema>;
export type MetaInsightsResponse = z.infer<typeof MetaInsightsResponseSchema>;

// ============================================================================
// AD PREVIEW
// ============================================================================

export const MetaAdPreviewFormatSchema = z.enum([
  'DESKTOP_FEED_STANDARD',
  'MOBILE_FEED_STANDARD',
  'FACEBOOK_STORY_MOBILE',
  'FACEBOOK_REELS_MOBILE',
  'INSTAGRAM_STANDARD',
  'INSTAGRAM_STORY',
  'INSTAGRAM_REELS',
]);

export type MetaAdPreviewFormat = z.infer<typeof MetaAdPreviewFormatSchema>;

// ============================================================================
// SAVED AUDIENCES
// ============================================================================

// Flexible spec item for v24.0 targeting structure
const FlexibleSpecItemSchema = z.object({
  interests: z.array(z.object({ id: z.string(), name: z.string().optional() })).optional(),
  behaviors: z.array(z.object({ id: z.string(), name: z.string().optional() })).optional(),
});

export const MetaSavedAudienceSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  approximate_count: z.number().optional(),
  targeting: z
    .object({
      geo_locations: z
        .object({
          countries: z.array(z.string()).optional(),
          cities: z.array(z.object({ key: z.string(), name: z.string().optional() })).optional(),
          regions: z.array(z.object({ key: z.string(), name: z.string().optional() })).optional(),
        })
        .optional(),
      age_min: z.number().optional(),
      age_max: z.number().optional(),
      genders: z.array(z.number()).optional(),
      // Legacy structure (pre-v24.0)
      interests: z
        .array(z.object({ id: z.string(), name: z.string().optional() }))
        .optional(),
      behaviors: z
        .array(z.object({ id: z.string(), name: z.string().optional() }))
        .optional(),
      // New v24.0 structure
      flexible_spec: z.array(FlexibleSpecItemSchema).optional(),
      custom_audiences: z
        .array(z.object({ id: z.string(), name: z.string().optional() }))
        .optional(),
      excluded_custom_audiences: z
        .array(z.object({ id: z.string(), name: z.string().optional() }))
        .optional(),
    })
    .optional(),
  time_created: z.string().optional(),
  time_updated: z.string().optional(),
});

export const MetaSavedAudiencesResponseSchema = z.object({
  data: z.array(MetaSavedAudienceSchema),
  paging: z
    .object({
      cursors: z
        .object({
          before: z.string().optional(),
          after: z.string().optional(),
        })
        .optional(),
      next: z.string().optional(),
    })
    .optional(),
});

export type MetaSavedAudience = z.infer<typeof MetaSavedAudienceSchema>;
export type MetaSavedAudiencesResponse = z.infer<typeof MetaSavedAudiencesResponseSchema>;

// ============================================================================
// MEDIA UPLOAD
// ============================================================================

export const MetaVideoUploadResponseSchema = z.object({
  id: z.string(),
});

export const MetaImageUploadResponseSchema = z.object({
  images: z.record(
    z.object({
      hash: z.string(),
      url: z.string().optional(),
    })
  ),
});

export type MetaVideoUploadResponse = z.infer<typeof MetaVideoUploadResponseSchema>;
export type MetaImageUploadResponse = z.infer<typeof MetaImageUploadResponseSchema>;

// ============================================================================
// MULTI-LANGUAGE ADS
// ============================================================================

/**
 * Language-specific ad copy for multi-language ads
 */
export interface LanguageCopies {
  headlines: string[];
  bodies: string[];
  descriptions?: string[];
  linkUrl?: string;
}

/**
 * Data structure for creating a multi-language ad with asset_customization_rules
 */
export interface MultiLanguageAdData {
  name: string;
  adsetId: string;
  pageId: string;
  defaultLanguage: string;
  languageCopies: Record<string, LanguageCopies>;
  imageUrls?: string[];
  videoIds?: string[];
  callToAction: string;
  linkUrl: string; // Fallback URL if not specified per language
}
