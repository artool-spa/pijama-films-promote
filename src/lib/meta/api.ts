import { MetaClient } from './client';
import {
  MetaCampaignCreate,
  MetaCampaignResponse,
  MetaCampaignCreateSchema,
  MetaCampaignResponseSchema,
  MetaAdSetCreate,
  MetaAdSetResponse,
  MetaAdSetCreateSchema,
  MetaAdSetResponseSchema,
  MetaAdCreate,
  MetaAdResponse,
  MetaAdCreateSchema,
  MetaAdResponseSchema,
  MetaInsightsRequest,
  MetaInsightsResponse,
  MetaInsightsRequestSchema,
  MetaInsightsResponseSchema,
  MetaErrorResponseSchema,
  MetaAdPreviewFormat,
  MetaSavedAudience,
  MetaSavedAudiencesResponse,
  MetaSavedAudiencesResponseSchema,
  MultiLanguageAdData,
  MetaTargeting,
} from './types';
import { getLocaleIdsForLanguage } from './locales';
import {
  MetaApiError,
  MetaAuthError,
  MetaValidationError,
  MetaRateLimitError,
} from './errors';

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Execute an API request with standardized error handling
 */
async function executeRequest<T>(
  client: MetaClient,
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...client.getAuthHeaders(),
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    const errorResult = MetaErrorResponseSchema.safeParse(data);
    if (errorResult.success) {
      const err = errorResult.data.error;

      // Handle specific error codes
      if (err.code === 190) {
        throw new MetaAuthError(err.message, response.status, err.code);
      }
      if (err.code === 17 || err.code === 80000) {
        throw new MetaRateLimitError(err.message);
      }

      throw new MetaApiError(err.message, {
        statusCode: response.status,
        endpoint: url,
        errorCode: err.code,
        errorSubcode: err.error_subcode,
        response: data,
      });
    }

    throw new MetaApiError(`Request failed: ${response.status}`, {
      statusCode: response.status,
      endpoint: url,
      response: data,
    });
  }

  return data as T;
}

/**
 * Build form data for POST requests (Meta API prefers form-encoded)
 */
function buildFormData(data: Record<string, unknown>, accessToken: string): URLSearchParams {
  const formData = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null) {
      if (typeof value === 'object') {
        formData.append(key, JSON.stringify(value));
      } else {
        formData.append(key, String(value));
      }
    }
  }
  formData.append('access_token', accessToken);
  return formData;
}

// ============================================================================
// CAMPAIGN OPERATIONS
// ============================================================================

/**
 * Create a new campaign in Meta Ads
 * Supports Campaign Budget Optimization (CBO) when daily_budget or lifetime_budget is provided
 */
export async function createCampaign(
  client: MetaClient,
  data: MetaCampaignCreate
): Promise<MetaCampaignResponse> {
  const validated = MetaCampaignCreateSchema.parse(data);
  const url = client.buildAdAccountUrl('campaigns');

  // Build request data - include CBO fields if provided
  const requestData: Record<string, unknown> = {
    name: validated.name,
    objective: validated.objective,
    status: validated.status,
    special_ad_categories: validated.special_ad_categories,
  };

  // CBO configuration - when budget is at campaign level
  if (validated.daily_budget || validated.lifetime_budget) {
    if (validated.daily_budget) {
      requestData.daily_budget = validated.daily_budget;
    }
    if (validated.lifetime_budget) {
      requestData.lifetime_budget = validated.lifetime_budget;
      // Lifetime budget requires start/end times
      if (validated.start_time) requestData.start_time = validated.start_time;
      if (validated.end_time) requestData.end_time = validated.end_time;
    }
    if (validated.bid_strategy) {
      requestData.bid_strategy = validated.bid_strategy;
    }
  }

  const formData = buildFormData(requestData, client.accessToken);

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  const result = await response.json();
  if (!response.ok) {
    const errorDetails = result.error?.error_user_msg || result.error?.message || 'Unknown error';
    const errorTitle = result.error?.error_user_title || '';
    console.error('[Meta] Campaign creation failed:', JSON.stringify(result, null, 2));
    console.error('[Meta] Request data:', requestData);
    throw new MetaApiError(
      `Failed to create campaign: ${errorTitle ? `${errorTitle} - ` : ''}${errorDetails}`,
      {
        statusCode: response.status,
        response: result,
        errorCode: result.error?.code,
        errorSubcode: result.error?.error_subcode,
      }
    );
  }

  return MetaCampaignResponseSchema.parse(result);
}

/**
 * Configuration for creating a CBO campaign with AdSets
 */
export interface CBOCampaignConfig {
  name: string;
  objective: 'OUTCOME_SALES' | 'OUTCOME_TRAFFIC';
  budget: number; // In cents
  budgetType: 'daily' | 'lifetime';
  startTime: string; // ISO format
  endTime?: string; // ISO format, required for lifetime budget
  targeting: MetaTargeting;
  promotedObject?: {
    pixel_id: string;
    custom_event_type: 'PURCHASE' | 'ADD_TO_CART' | 'VIEW_CONTENT' | 'LEAD';
  };
  hasImages: boolean;
  hasVideos: boolean;
  optimizationGoal: 'OFFSITE_CONVERSIONS' | 'LANDING_PAGE_VIEWS' | 'LINK_CLICKS';
}

/**
 * Result from creating a CBO campaign with AdSets
 */
export interface CBOCampaignResult {
  campaignId: string;
  imageAdSetId?: string;
  videoAdSetId?: string;
}

/**
 * Create a Meta Campaign with CBO (Campaign Budget Optimization) and 1-2 AdSets
 *
 * This creates:
 * - 1 Campaign with budget at campaign level (CBO enabled)
 * - 1 AdSet for images (if hasImages is true)
 * - 1 AdSet for videos (if hasVideos is true)
 *
 * Each AdSet has dynamic creative enabled but NO individual budget (budget is at campaign level)
 */
export async function createCBOCampaignWithAdSets(
  client: MetaClient,
  config: CBOCampaignConfig
): Promise<CBOCampaignResult> {
  const {
    name,
    objective,
    budget,
    budgetType,
    startTime,
    endTime,
    targeting,
    promotedObject,
    hasImages,
    hasVideos,
    optimizationGoal,
  } = config;

  if (!hasImages && !hasVideos) {
    throw new MetaValidationError('At least one of hasImages or hasVideos must be true');
  }

  // Step 1: Create Campaign with CBO budget
  console.log('[Meta] Creating CBO campaign:', { name, objective, budget, budgetType });

  const campaignData: MetaCampaignCreate = {
    name,
    objective,
    status: 'PAUSED',
    special_ad_categories: [],
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    start_time: startTime,
  };

  if (budgetType === 'daily') {
    campaignData.daily_budget = budget;
  } else {
    campaignData.lifetime_budget = budget;
    if (endTime) {
      campaignData.end_time = endTime;
    }
  }

  const campaign = await createCampaign(client, campaignData);
  console.log('[Meta] CBO Campaign created:', campaign.id);

  const result: CBOCampaignResult = {
    campaignId: campaign.id,
  };

  // Step 2: Create AdSet for images (if needed)
  if (hasImages) {
    console.log('[Meta] Creating image AdSet for CBO campaign');

    const imageAdSet = await createAdSet(client, {
      name: `${name} - Images`,
      campaign_id: campaign.id,
      status: 'PAUSED',
      // NO budget - it's at campaign level with CBO
      start_time: startTime,
      end_time: endTime,
      billing_event: 'IMPRESSIONS',
      optimization_goal: optimizationGoal,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      targeting,
      promoted_object: promotedObject,
      is_dynamic_creative: true,
    });

    result.imageAdSetId = imageAdSet.id;
    console.log('[Meta] Image AdSet created:', imageAdSet.id);
  }

  // Step 3: Create AdSet for videos (if needed)
  if (hasVideos) {
    console.log('[Meta] Creating video AdSet for CBO campaign');

    const videoAdSet = await createAdSet(client, {
      name: `${name} - Videos`,
      campaign_id: campaign.id,
      status: 'PAUSED',
      // NO budget - it's at campaign level with CBO
      start_time: startTime,
      end_time: endTime,
      billing_event: 'IMPRESSIONS',
      optimization_goal: optimizationGoal,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      targeting,
      promoted_object: promotedObject,
      is_dynamic_creative: true,
    });

    result.videoAdSetId = videoAdSet.id;
    console.log('[Meta] Video AdSet created:', videoAdSet.id);
  }

  return result;
}

/**
 * Update an existing campaign
 */
export async function updateCampaign(
  client: MetaClient,
  campaignId: string,
  data: Partial<MetaCampaignCreate>
): Promise<MetaCampaignResponse> {
  const url = client.buildObjectUrl(campaignId);

  const formData = buildFormData(
    {
      name: data.name,
      status: data.status,
    },
    client.accessToken
  );

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  const result = await response.json();
  if (!response.ok) {
    throw new MetaApiError(
      `Failed to update campaign: ${result.error?.message || 'Unknown error'}`,
      { statusCode: response.status, response: result }
    );
  }

  return { id: campaignId, ...data };
}

/**
 * Get campaign details
 */
export async function getCampaign(
  client: MetaClient,
  campaignId: string
): Promise<MetaCampaignResponse> {
  const fields = 'id,name,objective,status,created_time,updated_time';
  const url = `${client.buildObjectUrl(campaignId)}?fields=${fields}&access_token=${client.accessToken}`;
  return executeRequest<MetaCampaignResponse>(client, url);
}

// ============================================================================
// ADSET OPERATIONS
// ============================================================================

/**
 * Create a new adset
 */
export async function createAdSet(
  client: MetaClient,
  data: MetaAdSetCreate
): Promise<MetaAdSetResponse> {
  const validated = MetaAdSetCreateSchema.parse(data);
  const url = client.buildAdAccountUrl('adsets');

  // Log targeting being sent to Meta
  console.log('[Meta] Creating AdSet with targeting:', JSON.stringify(validated.targeting, null, 2));

  const formData = buildFormData(
    {
      name: validated.name,
      campaign_id: validated.campaign_id,
      status: validated.status,
      billing_event: validated.billing_event,
      optimization_goal: validated.optimization_goal,
      bid_strategy: validated.bid_strategy,
      start_time: validated.start_time,
      end_time: validated.end_time,
      daily_budget: validated.daily_budget,
      lifetime_budget: validated.lifetime_budget,
      targeting: validated.targeting,
      promoted_object: validated.promoted_object,
      is_dynamic_creative: validated.is_dynamic_creative,
    },
    client.accessToken
  );

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  const result = await response.json();
  if (!response.ok) {
    console.error('[Meta] AdSet creation failed:', JSON.stringify(result, null, 2));
    throw new MetaApiError(
      `Failed to create adset: ${result.error?.message || 'Unknown error'}`,
      { statusCode: response.status, response: result }
    );
  }

  return MetaAdSetResponseSchema.parse(result);
}

/**
 * Update an existing adset
 */
export async function updateAdSet(
  client: MetaClient,
  adSetId: string,
  data: Partial<MetaAdSetCreate>
): Promise<MetaAdSetResponse> {
  const url = client.buildObjectUrl(adSetId);

  const formData = buildFormData(
    {
      name: data.name,
      status: data.status,
      daily_budget: data.daily_budget,
      end_time: data.end_time,
      targeting: data.targeting,
    },
    client.accessToken
  );

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  const result = await response.json();
  if (!response.ok) {
    throw new MetaApiError(
      `Failed to update adset: ${result.error?.message || 'Unknown error'}`,
      { statusCode: response.status, response: result }
    );
  }

  return {
    id: adSetId,
    name: data.name,
    status: data.status,
    daily_budget: data.daily_budget?.toString(),
    lifetime_budget: data.lifetime_budget?.toString(),
    start_time: data.start_time,
    end_time: data.end_time,
  };
}

/**
 * Get adset details
 */
export async function getAdSet(
  client: MetaClient,
  adSetId: string
): Promise<MetaAdSetResponse> {
  const fields = 'id,name,status,daily_budget,lifetime_budget,start_time,end_time,targeting';
  const url = `${client.buildObjectUrl(adSetId)}?fields=${fields}&access_token=${client.accessToken}`;
  return executeRequest<MetaAdSetResponse>(client, url);
}

// ============================================================================
// AD OPERATIONS
// ============================================================================

/**
 * Create a new ad
 */
export async function createAd(
  client: MetaClient,
  data: MetaAdCreate
): Promise<MetaAdResponse> {
  const validated = MetaAdCreateSchema.parse(data);
  const url = client.buildAdAccountUrl('ads');

  const formData = buildFormData(
    {
      name: validated.name,
      adset_id: validated.adset_id,
      creative: validated.creative,
      status: validated.status,
    },
    client.accessToken
  );

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  const result = await response.json();
  if (!response.ok) {
    throw new MetaApiError(
      `Failed to create ad: ${result.error?.message || 'Unknown error'}`,
      { statusCode: response.status, response: result }
    );
  }

  return MetaAdResponseSchema.parse(result);
}

/**
 * Update an existing ad
 */
export async function updateAd(
  client: MetaClient,
  adId: string,
  data: Partial<MetaAdCreate>
): Promise<MetaAdResponse> {
  const url = client.buildObjectUrl(adId);

  const formData = buildFormData(
    {
      name: data.name,
      status: data.status,
    },
    client.accessToken
  );

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  const result = await response.json();
  if (!response.ok) {
    throw new MetaApiError(
      `Failed to update ad: ${result.error?.message || 'Unknown error'}`,
      { statusCode: response.status, response: result }
    );
  }

  return {
    id: adId,
    name: data.name,
    status: data.status,
    creative: data.creative ? { id: data.creative.creative_id } : undefined,
  };
}

// ============================================================================
// MEDIA UPLOAD
// ============================================================================

/**
 * Upload a video for use in ad creatives
 */
export async function uploadAdVideo(
  client: MetaClient,
  videoUrl: string,
  name: string
): Promise<{ video_id: string }> {
  const url = client.buildAdAccountUrl('advideos');

  const formData = buildFormData(
    {
      file_url: videoUrl,
      name,
    },
    client.accessToken
  );

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  const result = await response.json();
  if (!response.ok) {
    throw new MetaApiError(
      `Failed to upload video: ${result.error?.message || 'Unknown error'}`,
      { statusCode: response.status, response: result }
    );
  }

  return { video_id: result.id };
}

/**
 * Upload an image and get its hash for use in ad creatives
 */
export async function uploadAdImage(
  client: MetaClient,
  imageUrl: string,
  name: string
): Promise<{ image_hash: string }> {
  const url = client.buildAdAccountUrl('adimages');

  const formData = buildFormData(
    {
      url: imageUrl,
      name,
    },
    client.accessToken
  );

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  const result = await response.json();
  if (!response.ok) {
    throw new MetaApiError(
      `Failed to upload image: ${result.error?.message || 'Unknown error'}`,
      { statusCode: response.status, response: result }
    );
  }

  // Image upload returns: { images: { [filename]: { hash: "xxx" } } }
  const imageData = Object.values(result.images)[0] as { hash: string };
  return { image_hash: imageData.hash };
}

/**
 * Create an ad creative (video or image)
 */
export async function createAdCreative(
  client: MetaClient,
  data: {
    name: string;
    pageId: string;
    linkUrl: string;
    message: string;
    headline: string;
    description?: string;
    callToAction: string;
    videoId?: string;
    imageHash?: string;
    imageUrl?: string; // Direct URL (preferred over imageHash)
  }
): Promise<{ creative_id: string }> {
  const url = client.buildAdAccountUrl('adcreatives');

  let objectStorySpec: Record<string, unknown>;

  if (data.videoId) {
    objectStorySpec = {
      page_id: data.pageId,
      video_data: {
        video_id: data.videoId,
        title: data.headline,
        message: data.message,
        link_description: data.description,
        call_to_action: {
          type: data.callToAction,
          value: { link: data.linkUrl },
        },
      },
    };
  } else if (data.imageUrl) {
    // Use direct URL via picture field (no upload required)
    objectStorySpec = {
      page_id: data.pageId,
      link_data: {
        link: data.linkUrl,
        message: data.message,
        name: data.headline,
        description: data.description,
        picture: data.imageUrl,
        call_to_action: {
          type: data.callToAction,
        },
      },
    };
  } else if (data.imageHash) {
    // Fallback to image_hash (requires prior upload)
    objectStorySpec = {
      page_id: data.pageId,
      link_data: {
        link: data.linkUrl,
        message: data.message,
        name: data.headline,
        description: data.description,
        image_hash: data.imageHash,
        call_to_action: {
          type: data.callToAction,
        },
      },
    };
  } else {
    throw new MetaValidationError('Either videoId, imageUrl, or imageHash is required');
  }

  const formData = buildFormData(
    {
      name: data.name,
      object_story_spec: objectStorySpec,
    },
    client.accessToken
  );

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  const result = await response.json();
  if (!response.ok) {
    throw new MetaApiError(
      `Failed to create creative: ${result.error?.message || 'Unknown error'}`,
      { statusCode: response.status, response: result }
    );
  }

  return { creative_id: result.id };
}

/**
 * Create a dynamic creative ad with asset_feed_spec
 * Used when AdSet has is_dynamic_creative: true
 */
export async function createDynamicCreativeAd(
  client: MetaClient,
  data: {
    name: string;
    adsetId: string;
    pageId: string;
    linkUrl: string;
    headlines: string[];
    bodies: string[];
    descriptions?: string[];
    callToAction: string;
    imageHashes?: string[];
    imageUrls?: string[]; // Direct URLs (preferred over imageHashes)
    videoIds?: string[];
  }
): Promise<{ ad_id: string }> {
  const url = client.buildAdAccountUrl('ads');

  // Build asset_feed_spec for dynamic creative
  const assetFeedSpec: Record<string, unknown> = {
    titles: data.headlines.map((text) => ({ text })),
    bodies: data.bodies.map((text) => ({ text })),
    call_to_action_types: [data.callToAction],
    link_urls: [{ website_url: data.linkUrl }],
    ad_formats: ['SINGLE_IMAGE'],
  };

  // Add descriptions if provided
  if (data.descriptions && data.descriptions.length > 0) {
    assetFeedSpec.descriptions = data.descriptions.map((text) => ({ text }));
  }

  // Handle media: Meta doesn't allow mixing images and videos in the same ad
  // When both are provided, prioritize videos (they typically perform better)
  const hasVideos = data.videoIds && data.videoIds.length > 0;
  const hasImages = (data.imageUrls && data.imageUrls.length > 0) ||
                    (data.imageHashes && data.imageHashes.length > 0);

  if (hasVideos) {
    // Use videos only - SINGLE_VIDEO format
    assetFeedSpec.videos = data.videoIds!.map((video_id) => ({ video_id }));
    assetFeedSpec.ad_formats = ['SINGLE_VIDEO'];
    if (hasImages) {
      console.warn('[Meta] Both images and videos provided - using videos only (Meta does not support mixing)');
    }
  } else if (data.imageUrls && data.imageUrls.length > 0) {
    // Prefer URLs over hashes (no upload required)
    assetFeedSpec.images = data.imageUrls.map((url) => ({ url }));
    assetFeedSpec.ad_formats = ['SINGLE_IMAGE'];
  } else if (data.imageHashes && data.imageHashes.length > 0) {
    assetFeedSpec.images = data.imageHashes.map((hash) => ({ hash }));
    assetFeedSpec.ad_formats = ['SINGLE_IMAGE'];
  }

  const objectStorySpec = {
    page_id: data.pageId,
  };

  const formData = buildFormData(
    {
      name: data.name,
      adset_id: data.adsetId,
      status: 'PAUSED',
      creative: {
        object_story_spec: objectStorySpec,
        asset_feed_spec: assetFeedSpec,
      },
    },
    client.accessToken
  );

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  const result = await response.json();
  if (!response.ok) {
    console.error('[Meta] Dynamic creative ad creation failed:', JSON.stringify(result, null, 2));
    throw new MetaApiError(
      `Failed to create dynamic creative ad: ${result.error?.message || 'Unknown error'}`,
      { statusCode: response.status, response: result }
    );
  }

  console.log('[Meta] Dynamic creative ad created:', result);
  return { ad_id: result.id };
}

/**
 * Create a multi-language ad with asset_customization_rules
 * This creates ONE ad that serves different copy based on user's Facebook language preference.
 *
 * @param client - MetaClient instance
 * @param data - Multi-language ad configuration
 * @returns Object with ad_id
 *
 * Reference: https://developers.facebook.com/docs/marketing-api/dynamic-creative/multi-language
 */
export async function createMultiLanguageAd(
  client: MetaClient,
  data: MultiLanguageAdData
): Promise<{ ad_id: string }> {
  const url = client.buildAdAccountUrl('ads');
  const languages = Object.keys(data.languageCopies);
  const defaultCopies = data.languageCopies[data.defaultLanguage];

  // Build titles array with both labeled and unlabeled (fallback) assets
  // Unlabeled assets are used for users whose locale doesn't match any rule
  type TitleEntry = { text: string; adlabels?: Array<{ name: string }> };
  const titles: TitleEntry[] = [];

  // Add unlabeled fallback titles from default language (must come first)
  for (const headline of defaultCopies.headlines) {
    titles.push({ text: headline });
  }

  // Add labeled titles for each language
  for (const [lang, copies] of Object.entries(data.languageCopies)) {
    for (const headline of copies.headlines) {
      titles.push({
        text: headline,
        adlabels: [{ name: lang }],
      });
    }
  }

  // Build bodies array with both labeled and unlabeled (fallback) assets
  type BodyEntry = { text: string; adlabels?: Array<{ name: string }> };
  const bodies: BodyEntry[] = [];

  // Add unlabeled fallback bodies from default language (must come first)
  for (const body of defaultCopies.bodies) {
    bodies.push({ text: body });
  }

  // Add labeled bodies for each language
  for (const [lang, copies] of Object.entries(data.languageCopies)) {
    for (const body of copies.bodies) {
      bodies.push({
        text: body,
        adlabels: [{ name: lang }],
      });
    }
  }

  // Build descriptions array with both labeled and unlabeled (fallback) assets
  type DescEntry = { text: string; adlabels?: Array<{ name: string }> };
  const descriptions: DescEntry[] = [];

  // Add unlabeled fallback descriptions from default language
  if (defaultCopies.descriptions && defaultCopies.descriptions.length > 0) {
    for (const desc of defaultCopies.descriptions) {
      descriptions.push({ text: desc });
    }
  }

  // Add labeled descriptions for each language
  for (const [lang, copies] of Object.entries(data.languageCopies)) {
    if (copies.descriptions && copies.descriptions.length > 0) {
      for (const desc of copies.descriptions) {
        descriptions.push({
          text: desc,
          adlabels: [{ name: lang }],
        });
      }
    }
  }

  // Build link URLs - always include unlabeled fallback URL
  type LinkUrlEntry = { website_url: string; adlabels?: Array<{ name: string }> };
  const linkUrls: LinkUrlEntry[] = [];
  let hasPerLanguageUrls = false;

  // Add unlabeled fallback URL first
  linkUrls.push({ website_url: data.linkUrl });

  // Add labeled URLs if per-language URLs are provided
  for (const [lang, copies] of Object.entries(data.languageCopies)) {
    if (copies.linkUrl) {
      hasPerLanguageUrls = true;
      linkUrls.push({
        website_url: copies.linkUrl,
        adlabels: [{ name: lang }],
      });
    }
  }

  // Build asset_customization_rules - one rule per language
  const assetCustomizationRules = languages.map((lang) => {
    const locales = getLocaleIdsForLanguage(lang);
    const rule: Record<string, unknown> = {
      customization_spec: {
        locales,
      },
      title_label: { name: lang },
      body_label: { name: lang },
      is_default: lang === data.defaultLanguage,
    };

    // Add description label if we have labeled descriptions
    const hasLabeledDescriptions = Object.values(data.languageCopies).some(
      (c) => c.descriptions && c.descriptions.length > 0
    );
    if (hasLabeledDescriptions) {
      rule.description_label = { name: lang };
    }

    // Add link_url label if we have per-language URLs
    if (hasPerLanguageUrls) {
      rule.link_url_label = { name: lang };
    }

    return rule;
  });

  // Build asset_feed_spec
  const assetFeedSpec: Record<string, unknown> = {
    titles,
    bodies,
    call_to_action_types: [data.callToAction],
    link_urls: linkUrls,
    ad_formats: ['SINGLE_IMAGE'],
    asset_customization_rules: assetCustomizationRules,
  };

  // Add descriptions if provided
  if (descriptions.length > 0) {
    assetFeedSpec.descriptions = descriptions;
  }

  // Handle media: Multi-language ads with asset_customization_rules only allow ONE media asset
  // Caller must provide exactly ONE image OR ONE video
  const hasVideos = data.videoIds && data.videoIds.length > 0;
  const hasImages = data.imageUrls && data.imageUrls.length > 0;

  if (hasVideos && hasImages) {
    throw new MetaValidationError('Cannot mix images and videos in the same ad - create separate ads for each media type');
  }

  if (hasVideos) {
    if (data.videoIds!.length > 1) {
      throw new MetaValidationError('Multi-language ads only support one video per ad - create separate ads for each video');
    }
    assetFeedSpec.videos = data.videoIds!.map((video_id) => ({ video_id }));
    assetFeedSpec.ad_formats = ['SINGLE_VIDEO'];
  } else if (hasImages) {
    if (data.imageUrls!.length > 1) {
      throw new MetaValidationError('Multi-language ads only support one image per ad - create separate ads for each image');
    }
    assetFeedSpec.images = data.imageUrls!.map((url) => ({ url }));
    assetFeedSpec.ad_formats = ['SINGLE_IMAGE'];
  }

  const objectStorySpec = {
    page_id: data.pageId,
  };

  const formData = buildFormData(
    {
      name: data.name,
      adset_id: data.adsetId,
      status: 'PAUSED',
      creative: {
        object_story_spec: objectStorySpec,
        asset_feed_spec: assetFeedSpec,
      },
    },
    client.accessToken
  );

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  const result = await response.json();
  if (!response.ok) {
    console.error('[Meta] Multi-language ad creation failed:', JSON.stringify(result, null, 2));
    console.error('[Meta] Asset feed spec:', JSON.stringify(assetFeedSpec, null, 2));
    throw new MetaApiError(
      `Failed to create multi-language ad: ${result.error?.message || 'Unknown error'}`,
      { statusCode: response.status, response: result }
    );
  }

  console.log('[Meta] Multi-language ad created:', result);
  console.log('[Meta] Languages:', languages.join(', '));
  console.log('[Meta] Customization rules:', assetCustomizationRules.length);

  return { ad_id: result.id };
}

// ============================================================================
// INSIGHTS / STATS
// ============================================================================

/**
 * Get insights for a campaign, adset, or ad
 */
export async function getInsights(
  client: MetaClient,
  objectId: string,
  options: MetaInsightsRequest
): Promise<MetaInsightsResponse> {
  const validated = MetaInsightsRequestSchema.parse(options);

  const params = new URLSearchParams();
  params.append('level', validated.level);
  params.append('time_range', JSON.stringify(validated.time_range));
  params.append('fields', validated.fields.join(','));
  if (validated.breakdowns) {
    params.append('breakdowns', validated.breakdowns.join(','));
  }
  params.append('access_token', client.accessToken);

  const url = `${client.buildObjectUrl(objectId, 'insights')}?${params.toString()}`;
  const result = await executeRequest<MetaInsightsResponse>(client, url);

  return MetaInsightsResponseSchema.parse(result);
}

/**
 * Get daily insights breakdown for a specific date range
 */
export async function getDailyInsights(
  client: MetaClient,
  objectId: string,
  level: 'campaign' | 'adset' | 'ad',
  since: string,
  until: string
): Promise<MetaInsightsResponse> {
  return getInsights(client, objectId, {
    level,
    time_range: { since, until },
    fields: [
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
    ],
    breakdowns: ['date_start'],
  });
}

// ============================================================================
// AD PREVIEW
// ============================================================================

/**
 * Generate an ad preview for a creative
 */
export async function getAdPreview(
  client: MetaClient,
  creativeId: string,
  adFormat: MetaAdPreviewFormat
): Promise<{ body: string }> {
  const params = new URLSearchParams();
  params.append('ad_format', adFormat);
  params.append('access_token', client.accessToken);

  const url = `${client.buildObjectUrl(creativeId, 'previews')}?${params.toString()}`;
  const result = await executeRequest<{ data: Array<{ body: string }> }>(client, url);

  if (result.data && result.data.length > 0) {
    return { body: result.data[0].body };
  }

  throw new MetaApiError('No preview available');
}

/**
 * Generate an ad preview without saving anything to Meta.
 * Uses the generatepreviews endpoint which accepts a creative spec directly.
 * NOTE: This endpoint requires GET request with URL-encoded parameters.
 */
export async function generateAdPreview(
  client: MetaClient,
  creative: {
    pageId: string;
    message: string;
    headline: string;
    description?: string;
    linkUrl: string;
    imageUrl?: string;
    metaVideoId?: string; // Meta's video ID (from uploadAdVideo)
    videoThumbnailUrl?: string; // Thumbnail for video ads
  },
  adFormat: MetaAdPreviewFormat
): Promise<{ body: string }> {
  if (!creative.imageUrl && !creative.metaVideoId) {
    throw new MetaValidationError('Either imageUrl or metaVideoId is required');
  }

  // Build creative spec based on media type
  let objectStorySpec: Record<string, unknown>;

  if (creative.metaVideoId) {
    // Video creative - uses video_data with Meta's video_id
    // Requires a thumbnail image
    objectStorySpec = {
      page_id: creative.pageId,
      video_data: {
        video_id: creative.metaVideoId,
        image_url: creative.videoThumbnailUrl || creative.imageUrl, // Thumbnail required
        title: creative.headline,
        message: creative.message,
        link_description: creative.description,
        call_to_action: {
          type: 'WATCH_MORE',
          value: { link: creative.linkUrl },
        },
      },
    };
  } else {
    // Image creative - uses link_data
    objectStorySpec = {
      page_id: creative.pageId,
      link_data: {
        link: creative.linkUrl,
        message: creative.message,
        name: creative.headline,
        description: creative.description,
        picture: creative.imageUrl,
        call_to_action: {
          type: 'LEARN_MORE',
        },
      },
    };
  }

  const creativeSpec = {
    object_story_spec: objectStorySpec,
  };

  // Build URL with query parameters (Meta API requires GET for generatepreviews)
  const params = new URLSearchParams();
  params.append('access_token', client.accessToken);
  params.append('ad_format', adFormat);
  params.append('creative', JSON.stringify(creativeSpec));

  const url = `${client.buildAdAccountUrl('generatepreviews')}?${params.toString()}`;

  const response = await fetch(url, {
    method: 'GET',
  });

  const result = await response.json();

  if (!response.ok) {
    console.error('[Meta] Preview error:', JSON.stringify(result, null, 2));
    console.error('[Meta] Creative spec:', JSON.stringify(creativeSpec, null, 2));
    throw new MetaApiError(
      `Failed to generate preview: ${result.error?.message || 'Unknown error'}`,
      { statusCode: response.status, response: result }
    );
  }

  if (result.data && result.data.length > 0) {
    return { body: result.data[0].body };
  }

  throw new MetaApiError('No preview available');
}

// ============================================================================
// SAVED AUDIENCES
// ============================================================================

/**
 * Get all saved audiences for the ad account
 */
export async function getSavedAudiences(
  client: MetaClient,
  options?: {
    limit?: number;
    after?: string;
  }
): Promise<MetaSavedAudiencesResponse> {
  // Note: approximate_count was removed in v24.0
  const fields = [
    'id',
    'name',
    'description',
    'targeting',
    'time_created',
    'time_updated',
  ].join(',');

  const params = new URLSearchParams();
  params.append('fields', fields);
  params.append('limit', String(options?.limit || 50));
  if (options?.after) {
    params.append('after', options.after);
  }
  params.append('access_token', client.accessToken);

  const url = `${client.buildAdAccountUrl('saved_audiences')}?${params.toString()}`;
  const result = await executeRequest<MetaSavedAudiencesResponse>(client, url);

  return MetaSavedAudiencesResponseSchema.parse(result);
}

/**
 * Get a specific saved audience by ID
 */
export async function getSavedAudience(
  client: MetaClient,
  audienceId: string
): Promise<MetaSavedAudience> {
  // Note: approximate_count was removed in v24.0
  const fields = [
    'id',
    'name',
    'description',
    'targeting',
    'time_created',
    'time_updated',
  ].join(',');

  const url = `${client.buildObjectUrl(audienceId)}?fields=${fields}&access_token=${client.accessToken}`;
  const result = await executeRequest<MetaSavedAudience>(client, url);

  return result;
}

/**
 * Get all saved audiences (handles pagination automatically)
 */
export async function getAllSavedAudiences(
  client: MetaClient
): Promise<MetaSavedAudience[]> {
  const audiences: MetaSavedAudience[] = [];
  let after: string | undefined;

  do {
    const response = await getSavedAudiences(client, { limit: 100, after });
    audiences.push(...response.data);
    after = response.paging?.cursors?.after;
  } while (after);

  return audiences;
}
