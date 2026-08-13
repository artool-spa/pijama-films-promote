import { GoogleAdsClient } from './client';
import {
  GoogleCampaignCreate,
  GoogleCampaignCreateSchema,
  GoogleAdGroupCreate,
  GoogleAdGroupCreateSchema,
  GoogleVideoAdCreate,
  GoogleVideoAdCreateSchema,
  GoogleInsightsResponse,
  GoogleInsightsResponseSchema,
  DemandGenCampaignCreate,
  DemandGenCampaignCreateSchema,
  DemandGenAdGroupCreate,
  DemandGenAdGroupCreateSchema,
  DemandGenImageAdCreate,
  DemandGenImageAdCreateSchema,
  DisplayInsightsResponse,
  DisplayInsightsResponseSchema,
} from './types';
import { GoogleAdsApiError } from './errors';
import type { GoogleTargetingResult } from './targeting';
import { createLogger } from '@/lib/logger';

const log = createLogger('google');

// ============================================================================
// CUSTOM AUDIENCE TYPES & FETCHING
// ============================================================================

export interface GoogleCustomAudience {
  id: string;
  name: string;
  resourceName: string;
  type: string;
}

/**
 * Fetch all custom audiences from the Google Ads account via GAQL.
 * Mirrors Meta's getAllSavedAudiences() pattern.
 */
export async function getAllCustomAudiences(
  client: GoogleAdsClient
): Promise<GoogleCustomAudience[]> {
  const gaql = `
    SELECT
      custom_audience.id,
      custom_audience.name,
      custom_audience.type,
      custom_audience.resource_name
    FROM custom_audience
    ORDER BY custom_audience.name
  `;

  type StreamRow = {
    customAudience?: {
      id: string;
      name: string;
      type: string;
      resourceName: string;
    };
  };
  type StreamChunk = { results?: StreamRow[] };

  let raw: unknown;
  try {
    raw = await client.query<unknown>(gaql);
  } catch (error) {
    log.warn({ err: error }, 'Failed to fetch custom audiences via GAQL. Campaign will be created without custom audience targeting.');
    return [];
  }

  // searchStream returns an array of chunks: [{results: [...]}, ...]
  // search returns a single object: {results: [...]}
  // Handle both formats
  const allRows: StreamRow[] = [];

  if (Array.isArray(raw)) {
    for (const chunk of raw as StreamChunk[]) {
      if (chunk.results) {
        allRows.push(...chunk.results);
      }
    }
  } else if (raw && typeof raw === 'object' && 'results' in raw) {
    const single = raw as StreamChunk;
    if (single.results) {
      allRows.push(...single.results);
    }
  }

  const audiences = allRows
    .filter((row) => row.customAudience)
    .map((row) => ({
      id: row.customAudience!.id,
      name: row.customAudience!.name,
      resourceName: row.customAudience!.resourceName,
      type: row.customAudience!.type,
    }));

  log.info({ count: audiences.length }, 'Fetched custom audiences');
  return audiences;
}

// ============================================================================
// CAMPAIGN OPERATIONS
// ============================================================================

/**
 * Create a YouTube video campaign in Google Ads
 */
export async function createVideoCampaign(
  client: GoogleAdsClient,
  data: GoogleCampaignCreate
): Promise<{ resourceName: string }> {
  const validated = GoogleCampaignCreateSchema.parse(data);

  // Create campaign budget first
  // Google Ads only supports DAILY period — for lifetime budgets, divide total by campaign days
  // Budget must be a multiple of 10,000 micros ($0.01) to avoid NON_MULTIPLE_OF_MINIMUM_CURRENCY_UNIT error
  let dailyBudgetMicros = validated.budgetAmountMicros;
  if (validated.budgetType === 'TOTAL' && validated.startDate && validated.endDate) {
    const start = new Date(validated.startDate);
    const end = new Date(validated.endDate);
    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    dailyBudgetMicros = (validated.budgetAmountMicros / BigInt(days) / BigInt(10_000)) * BigInt(10_000);
    if (dailyBudgetMicros < BigInt(10_000)) dailyBudgetMicros = BigInt(10_000);
  }
  const budgetResult = await client.mutate('campaignBudgets', [
    {
      create: {
        name: `Budget - ${validated.name}`,
        amountMicros: dailyBudgetMicros.toString(),
        deliveryMethod: 'STANDARD',
        explicitlyShared: false,
      },
    },
  ]);

  const budgetResourceName = budgetResult.results[0].resourceName;
  log.info({ resourceName: budgetResourceName }, 'Budget created');

  // Build bidding strategy
  const biddingConfig: Record<string, unknown> = {};
  if (validated.biddingStrategy === 'TARGET_CPV') {
    biddingConfig.manualCpv = {};
  } else if (validated.biddingStrategy === 'MAXIMIZE_CONVERSIONS') {
    biddingConfig.maximizeConversions = {};
  } else if (validated.biddingStrategy === 'TARGET_CPA') {
    biddingConfig.targetCpa = {};
  } else {
    biddingConfig.maximizeConversionValue = {};
  }

  // Create the video campaign
  // v23: start_date/end_date replaced by startDateTime/endDateTime (format "YYYY-MM-DD HH:mm:ss")
  const campaignResult = await client.mutate('campaigns', [
    {
      create: {
        name: validated.name,
        status: validated.status,
        advertisingChannelType: 'VIDEO',
        campaignBudget: budgetResourceName,
        startDateTime: `${validated.startDate} 00:00:00`,
        ...(validated.endDate ? { endDateTime: `${validated.endDate} 23:59:59` } : {}),
        containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
        ...biddingConfig,
      },
    },
  ]);

  const resourceName = campaignResult.results[0].resourceName;
  log.info({ resourceName }, 'Video campaign created');

  return { resourceName };
}

/**
 * Create an ad group for a video campaign
 */
export async function createVideoAdGroup(
  client: GoogleAdsClient,
  data: GoogleAdGroupCreate
): Promise<{ resourceName: string }> {
  const validated = GoogleAdGroupCreateSchema.parse(data);

  const adGroupData: Record<string, unknown> = {
    name: validated.name,
    campaign: validated.campaignResourceName,
    status: validated.status,
    type: 'VIDEO_RESPONSIVE',
  };

  if (validated.cpvBidMicros) {
    adGroupData.cpvBidMicros = validated.cpvBidMicros.toString();
  }

  const result = await client.mutate('adGroups', [
    { create: adGroupData },
  ]);

  const resourceName = result.results[0].resourceName;
  log.info({ resourceName }, 'Ad group created');

  return { resourceName };
}

/**
 * Create a video ad in an ad group
 */
export async function createVideoAd(
  client: GoogleAdsClient,
  data: GoogleVideoAdCreate
): Promise<{ resourceName: string }> {
  const validated = GoogleVideoAdCreateSchema.parse(data);

  // Build the video ad info based on format
  let videoAdInfo: Record<string, unknown>;

  switch (validated.adFormat) {
    case 'IN_STREAM_SKIPPABLE':
      videoAdInfo = {
        inStreamAd: {
          actionButton: validated.callToAction
            ? { label: validated.callToAction }
            : undefined,
          actionHeadline: validated.headline,
          companionBanner: validated.companionBannerUrl
            ? { asset: validated.companionBannerUrl }
            : undefined,
        },
      };
      break;

    case 'IN_STREAM_NON_SKIPPABLE':
      videoAdInfo = {
        nonSkippableAd: {
          actionButton: validated.callToAction
            ? { label: validated.callToAction }
            : undefined,
          actionHeadline: validated.headline,
        },
      };
      break;

    case 'IN_FEED':
      videoAdInfo = {
        inFeedAd: {
          headline: validated.headline || '',
          description1: validated.description1 || '',
          description2: validated.description2 || '',
        },
      };
      break;

    case 'BUMPER':
      videoAdInfo = {
        bumperAd: {
          companionBanner: validated.companionBannerUrl
            ? { asset: validated.companionBannerUrl }
            : undefined,
        },
      };
      break;

    case 'SHORTS':
      videoAdInfo = {
        inStreamAd: {
          actionButton: validated.callToAction
            ? { label: validated.callToAction }
            : undefined,
          actionHeadline: validated.headline,
        },
      };
      break;

    default:
      videoAdInfo = { inStreamAd: {} };
  }

  const result = await client.mutate('adGroupAds', [
    {
      create: {
        adGroup: validated.adGroupResourceName,
        status: 'ENABLED',
        ad: {
          name: validated.name,
          finalUrls: [validated.finalUrl],
          displayUrl: validated.displayUrl,
          videoAd: {
            video: { youtubeVideoId: validated.youtubeVideoId },
            ...videoAdInfo,
          },
        },
      },
    },
  ]);

  const resourceName = result.results[0].resourceName;
  log.info({ resourceName }, 'Video ad created');

  return { resourceName };
}

/**
 * Create a complete YouTube campaign with ad group and targeting
 * This is the combined flow for creating everything in one operation
 */
export async function createYouTubeCampaignWithAdGroup(
  client: GoogleAdsClient,
  config: {
    name: string;
    budget: number; // In currency units (e.g., dollars)
    budgetType: 'DAILY' | 'TOTAL';
    startDate: string; // YYYY-MM-DD
    endDate?: string;
    biddingStrategy: string;
    targetCpvMicros?: bigint;
    targeting: GoogleTargetingResult;
  }
): Promise<{ campaignResourceName: string; adGroupResourceName: string }> {
  // Convert budget to micros
  const budgetMicros = BigInt(Math.round(config.budget * 1_000_000));

  // Step 1: Create campaign
  const campaign = await createVideoCampaign(client, {
    name: config.name,
    budgetAmountMicros: budgetMicros,
    budgetType: config.budgetType === 'DAILY' ? 'DAILY' : 'TOTAL',
    startDate: config.startDate,
    endDate: config.endDate,
    status: 'ENABLED',
    biddingStrategy: config.biddingStrategy as GoogleCampaignCreate['biddingStrategy'],
    targetCpvMicros: config.targetCpvMicros,
  });

  // Step 2: Apply targeting criteria to campaign (Video supports all criteria types)
  await applyTargetingToCampaign(client, campaign.resourceName, config.targeting, 'VIDEO');

  // Step 3: Create ad group
  const adGroup = await createVideoAdGroup(client, {
    name: `${config.name} - Ad Group`,
    campaignResourceName: campaign.resourceName,
    status: 'ENABLED',
    cpvBidMicros: config.targetCpvMicros,
  });

  return {
    campaignResourceName: campaign.resourceName,
    adGroupResourceName: adGroup.resourceName,
  };
}

/**
 * Apply targeting criteria to a campaign.
 *
 * Demand Gen campaigns: geo targeting applied at ad group level via adGroupCriteria.
 * Video campaigns: geo, age, gender, and audience criteria at campaign level.
 */
async function applyTargetingToCampaign(
  client: GoogleAdsClient,
  campaignResourceName: string,
  targeting: GoogleTargetingResult,
  campaignType: 'VIDEO' | 'DEMAND_GEN' = 'VIDEO',
  adGroupResourceName?: string
): Promise<void> {
  // Demand Gen: apply geo targeting at ad group level (campaignCriteria triggers
  // OWNED_AND_OPERATED error in API v23 for Demand Gen campaigns)
  if (campaignType === 'DEMAND_GEN') {
    if (adGroupResourceName && targeting.geoTargets.length > 0) {
      const geoOps = targeting.geoTargets.map((geoTarget) => ({
        create: {
          adGroup: adGroupResourceName,
          location: { geoTargetConstant: geoTarget },
        },
      }));
      await client.mutate('adGroupCriteria', geoOps);
      log.info({ count: geoOps.length }, 'Applied geo targeting at ad group level for Demand Gen');
    }
    return;
  }

  const operations: Array<{ create: unknown }> = [];

  // Geo targeting at campaign level for Video campaigns
  for (const geoTarget of targeting.geoTargets) {
    operations.push({
      create: {
        campaign: campaignResourceName,
        location: { geoTargetConstant: geoTarget },
      },
    });
  }

  // Video campaign: demographics and audiences
  {
    // Add gender targeting
    for (const gender of targeting.genders) {
      operations.push({
        create: {
          campaign: campaignResourceName,
          gender: { type: gender },
        },
      });
    }

    // Add age range targeting
    if (targeting.ageRange) {
      const allRanges = [
        'AGE_RANGE_18_24',
        'AGE_RANGE_25_34',
        'AGE_RANGE_35_44',
        'AGE_RANGE_45_54',
        'AGE_RANGE_55_64',
        'AGE_RANGE_65_UP',
      ];
      const minIdx = allRanges.indexOf(targeting.ageRange.min);
      const maxIdx = allRanges.indexOf(targeting.ageRange.max);

      for (let i = minIdx; i <= maxIdx; i++) {
        operations.push({
          create: {
            campaign: campaignResourceName,
            ageRange: { type: allRanges[i] },
          },
        });
      }
    }

    // Add custom audiences
    if (targeting.customAudiences) {
      for (const audienceResourceName of targeting.customAudiences) {
        operations.push({
          create: {
            campaign: campaignResourceName,
            customAudience: { customAudience: audienceResourceName },
          },
        });
      }
    }

    // Add affinity audiences (legacy)
    for (const audience of targeting.affinityAudiences) {
      operations.push({
        create: {
          campaign: campaignResourceName,
          userInterest: { userInterestCategory: audience },
        },
      });
    }
  }

  if (operations.length > 0) {
    await client.mutate('campaignCriteria', operations);
    log.info({ count: operations.length }, 'Applied targeting criteria');
  }
}

// ============================================================================
// INSIGHTS / METRICS
// ============================================================================

/**
 * Get YouTube campaign insights using GAQL
 */
export async function getYouTubeInsights(
  client: GoogleAdsClient,
  campaignResourceName: string,
  startDate: string,
  endDate: string
): Promise<GoogleInsightsResponse> {
  const query = `
    SELECT
      metrics.impressions,
      metrics.video_trueview_views,
      metrics.video_trueview_view_rate,
      metrics.trueview_average_cpv,
      metrics.cost_micros,
      metrics.clicks,
      metrics.ctr,
      metrics.video_quartile_p25_rate,
      metrics.video_quartile_p50_rate,
      metrics.video_quartile_p75_rate,
      metrics.video_quartile_p100_rate,
      segments.date
    FROM campaign
    WHERE campaign.resource_name = '${campaignResourceName}'
      AND segments.date BETWEEN '${startDate}' AND '${endDate}'
    ORDER BY segments.date
  `;

  type MetricsRow = {
    metrics?: Record<string, string>;
    segments?: { date: string };
  };
  type StreamChunk = { results?: MetricsRow[] };

  const raw = await client.query<StreamChunk | StreamChunk[]>(query);

  // searchStream returns an array of chunks: [{results: [...]}, ...]
  // search returns a single object: {results: [...]}
  const allRows: MetricsRow[] = [];
  if (Array.isArray(raw)) {
    for (const chunk of raw) {
      if (chunk.results) allRows.push(...chunk.results);
    }
  } else if (raw?.results) {
    allRows.push(...raw.results);
  }

  // Aggregate results
  let totalImpressions = 0;
  let totalViews = 0;
  let totalCostMicros = BigInt(0);
  let totalClicks = 0;
  let weightedViewRate = 0;
  let weightedCpv = 0;
  let weightedCtr = 0;
  let weightedQ25 = 0;
  let weightedQ50 = 0;
  let weightedQ75 = 0;
  let weightedQ100 = 0;
  let count = 0;

  for (const row of allRows) {
    const m = row.metrics;
    if (!m) continue;

    totalImpressions += parseInt(m.impressions || '0', 10);
    totalViews += parseInt(m.videoTrueviewViews || '0', 10);
    totalCostMicros += BigInt(m.costMicros || '0');
    totalClicks += parseInt(m.clicks || '0', 10);
    weightedViewRate += parseFloat(m.videoTrueviewViewRate || '0');
    weightedCpv += parseFloat(m.trueviewAverageCpv || '0');
    weightedCtr += parseFloat(m.ctr || '0');
    weightedQ25 += parseFloat(m.videoQuartileP25Rate || '0');
    weightedQ50 += parseFloat(m.videoQuartileP50Rate || '0');
    weightedQ75 += parseFloat(m.videoQuartileP75Rate || '0');
    weightedQ100 += parseFloat(m.videoQuartileP100Rate || '0');
    count++;
  }

  const avgDivisor = count || 1;

  return GoogleInsightsResponseSchema.parse({
    impressions: totalImpressions,
    videoViews: totalViews,
    videoViewRate: weightedViewRate / avgDivisor,
    averageCpv: weightedCpv / avgDivisor,
    costMicros: totalCostMicros,
    clicks: totalClicks,
    ctr: weightedCtr / avgDivisor,
    videoQuartile25Rate: weightedQ25 / avgDivisor,
    videoQuartile50Rate: weightedQ50 / avgDivisor,
    videoQuartile75Rate: weightedQ75 / avgDivisor,
    videoQuartile100Rate: weightedQ100 / avgDivisor,
    dateStart: startDate,
    dateEnd: endDate,
  });
}

// ============================================================================
// DEMAND GEN CAMPAIGN OPERATIONS
// ============================================================================

/**
 * Create a Demand Gen campaign in Google Ads
 */
export async function createDemandGenCampaign(
  client: GoogleAdsClient,
  data: DemandGenCampaignCreate
): Promise<{ resourceName: string }> {
  const validated = DemandGenCampaignCreateSchema.parse(data);

  // Create campaign budget first
  // Google Ads only supports DAILY period — for lifetime budgets, divide total by campaign days
  // Budget must be a multiple of 10,000 micros ($0.01) to avoid NON_MULTIPLE_OF_MINIMUM_CURRENCY_UNIT error
  let dailyBudgetMicros = validated.budgetAmountMicros;
  if (validated.budgetType === 'TOTAL' && validated.startDate && validated.endDate) {
    const start = new Date(validated.startDate);
    const end = new Date(validated.endDate);
    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    dailyBudgetMicros = (validated.budgetAmountMicros / BigInt(days) / BigInt(10_000)) * BigInt(10_000);
    if (dailyBudgetMicros < BigInt(10_000)) dailyBudgetMicros = BigInt(10_000);
  }
  const budgetResult = await client.mutate('campaignBudgets', [
    {
      create: {
        name: `Budget - ${validated.name}`,
        amountMicros: dailyBudgetMicros.toString(),
        deliveryMethod: 'STANDARD',
        explicitlyShared: false,
      },
    },
  ]);

  const budgetResourceName = budgetResult.results[0].resourceName;
  log.info({ resourceName: budgetResourceName }, 'Budget created');

  // Build bidding strategy
  // Note: MAXIMIZE_CLICKS uses targetSpend as its Campaign-level bidding scheme
  const biddingConfig: Record<string, unknown> = {};
  if (validated.biddingStrategy === 'MAXIMIZE_CLICKS') {
    biddingConfig.targetSpend = {};
  } else if (validated.biddingStrategy === 'MAXIMIZE_CONVERSIONS') {
    biddingConfig.maximizeConversions = {};
  } else if (validated.biddingStrategy === 'TARGET_CPA') {
    biddingConfig.targetCpa = {};
  }

  // Create the Demand Gen campaign
  // v23: start_date/end_date replaced by startDateTime/endDateTime (format "YYYY-MM-DD HH:mm:ss")
  const campaignResult = await client.mutate('campaigns', [
    {
      create: {
        name: validated.name,
        status: validated.status,
        advertisingChannelType: 'DEMAND_GEN',
        campaignBudget: budgetResourceName,
        startDateTime: `${validated.startDate} 00:00:00`,
        ...(validated.endDate ? { endDateTime: `${validated.endDate} 23:59:59` } : {}),
        containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
        ...biddingConfig,
      },
    },
  ]);

  const resourceName = campaignResult.results[0].resourceName;
  log.info({ resourceName }, 'Demand Gen campaign created');

  return { resourceName };
}

/**
 * Create an ad group for a Demand Gen campaign
 */
export async function createDemandGenAdGroup(
  client: GoogleAdsClient,
  data: DemandGenAdGroupCreate
): Promise<{ resourceName: string }> {
  const validated = DemandGenAdGroupCreateSchema.parse(data);

  const adGroupData: Record<string, unknown> = {
    name: validated.name,
    campaign: validated.campaignResourceName,
    status: validated.status,
  };

  if (validated.cpcBidMicros) {
    adGroupData.cpcBidMicros = validated.cpcBidMicros.toString();
  }

  const result = await client.mutate('adGroups', [
    { create: adGroupData },
  ]);

  const resourceName = result.results[0].resourceName;
  log.info({ resourceName }, 'Demand Gen ad group created');

  return { resourceName };
}

/**
 * Upload an image asset to Google Ads from a URL
 */
export async function uploadImageAsset(
  client: GoogleAdsClient,
  imageUrl: string,
  assetName: string
): Promise<{ resourceName: string }> {
  // Download image and convert to base64
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new GoogleAdsApiError(`Failed to download image from ${imageUrl}: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const base64Data = Buffer.from(arrayBuffer).toString('base64');

  const result = await client.mutate('assets', [
    {
      create: {
        name: assetName,
        type: 'IMAGE',
        imageAsset: {
          data: base64Data,
        },
      },
    },
  ]);

  const resourceName = result.results[0].resourceName;
  log.info({ resourceName }, 'Image asset uploaded');

  return { resourceName };
}

/**
 * Create a Demand Gen multi-asset image ad
 */
export async function createDemandGenImageAd(
  client: GoogleAdsClient,
  data: DemandGenImageAdCreate
): Promise<{ resourceName: string }> {
  const validated = DemandGenImageAdCreateSchema.parse(data);

  const marketingImages = validated.landscapeImageAssetResourceNames.map(
    resourceName => ({ asset: resourceName })
  );
  const squareMarketingImages = validated.squareImageAssetResourceNames.map(
    resourceName => ({ asset: resourceName })
  );
  const portraitMarketingImages = validated.portraitImageAssetResourceNames.map(
    resourceName => ({ asset: resourceName })
  );

  const logoImages = validated.logoImageAssetResourceNames.map(resourceName => ({
    asset: resourceName,
  }));

  const headlines = validated.headlines.map(text => ({
    text,
  }));

  const descriptions = validated.descriptions.map(text => ({
    text,
  }));

  const result = await client.mutate('adGroupAds', [
    {
      create: {
        adGroup: validated.adGroupResourceName,
        status: 'ENABLED',
        ad: {
          name: validated.name,
          finalUrls: [validated.finalUrl],
          demandGenMultiAssetAd: {
            ...(marketingImages.length > 0 && { marketingImages }),
            ...(squareMarketingImages.length > 0 && { squareMarketingImages }),
            ...(portraitMarketingImages.length > 0 && { portraitMarketingImages }),
            logoImages,
            headlines,
            descriptions,
            businessName: validated.businessName,
            callToActionText: 'See More',
          },
        },
      },
    },
  ]);

  const resourceName = result.results[0].resourceName;
  log.info({ resourceName }, 'Demand Gen image ad created');

  return { resourceName };
}

/**
 * Create a complete Demand Gen campaign with ad group and targeting
 */
export async function createDemandGenCampaignWithAdGroup(
  client: GoogleAdsClient,
  config: {
    name: string;
    budget: number; // In currency units (e.g., dollars)
    budgetType: 'DAILY' | 'TOTAL';
    startDate: string; // YYYY-MM-DD
    endDate?: string;
    biddingStrategy: string;
    targeting: GoogleTargetingResult;
  }
): Promise<{ campaignResourceName: string; adGroupResourceName: string }> {
  // Convert budget to micros
  const budgetMicros = BigInt(Math.round(config.budget * 1_000_000));

  // Step 1: Create Demand Gen campaign
  const campaign = await createDemandGenCampaign(client, {
    name: config.name,
    budgetAmountMicros: budgetMicros,
    budgetType: config.budgetType === 'DAILY' ? 'DAILY' : 'TOTAL',
    startDate: config.startDate,
    endDate: config.endDate,
    status: 'ENABLED',
    biddingStrategy: config.biddingStrategy as DemandGenCampaignCreate['biddingStrategy'],
  });

  // Step 2: Create ad group (Demand Gen ad groups have no type per Google Ads docs)
  const adGroup = await createDemandGenAdGroup(client, {
    name: `${config.name} - Ad Group`,
    campaignResourceName: campaign.resourceName,
    status: 'ENABLED',
  });

  // Step 3: Apply geo targeting at ad group level (Demand Gen doesn't support campaign-level geo in API v23)
  await applyTargetingToCampaign(client, campaign.resourceName, config.targeting, 'DEMAND_GEN', adGroup.resourceName);

  return {
    campaignResourceName: campaign.resourceName,
    adGroupResourceName: adGroup.resourceName,
  };
}

// ============================================================================
// DISPLAY INSIGHTS / METRICS
// ============================================================================

/**
 * Get Demand Gen / Display campaign insights using GAQL
 */
export async function getDisplayInsights(
  client: GoogleAdsClient,
  campaignResourceName: string,
  startDate: string,
  endDate: string
): Promise<DisplayInsightsResponse> {
  const query = `
    SELECT
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_micros,
      metrics.conversions,
      segments.date
    FROM campaign
    WHERE campaign.resource_name = '${campaignResourceName}'
      AND segments.date BETWEEN '${startDate}' AND '${endDate}'
    ORDER BY segments.date
  `;

  type MetricsRow = {
    metrics?: Record<string, string>;
    segments?: { date: string };
  };
  type StreamChunk = { results?: MetricsRow[] };

  const raw = await client.query<StreamChunk | StreamChunk[]>(query);

  // searchStream returns an array of chunks: [{results: [...]}, ...]
  // search returns a single object: {results: [...]}
  const allRows: MetricsRow[] = [];
  if (Array.isArray(raw)) {
    for (const chunk of raw) {
      if (chunk.results) allRows.push(...chunk.results);
    }
  } else if (raw?.results) {
    allRows.push(...raw.results);
  }

  // Aggregate results
  let totalImpressions = 0;
  let totalClicks = 0;
  let totalCostMicros = BigInt(0);
  let totalConversions = 0;
  let weightedCtr = 0;
  let weightedCpc = 0;
  let count = 0;

  for (const row of allRows) {
    const m = row.metrics;
    if (!m) continue;

    totalImpressions += parseInt(m.impressions || '0', 10);
    totalClicks += parseInt(m.clicks || '0', 10);
    totalCostMicros += BigInt(m.costMicros || '0');
    totalConversions += parseFloat(m.conversions || '0');
    weightedCtr += parseFloat(m.ctr || '0');
    weightedCpc += parseFloat(m.averageCpc || '0');
    count++;
  }

  const avgDivisor = count || 1;
  const totalSpend = Number(totalCostMicros) / 1_000_000;

  return DisplayInsightsResponseSchema.parse({
    impressions: totalImpressions,
    clicks: totalClicks,
    ctr: weightedCtr / avgDivisor,
    averageCpc: weightedCpc / avgDivisor,
    costMicros: totalCostMicros,
    conversions: totalConversions,
    cpm: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
    cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
    costPerConversion: totalConversions > 0 ? totalSpend / totalConversions : 0,
    dateStart: startDate,
    dateEnd: endDate,
  });
}

// ============================================================================
// PER-AD INSIGHTS
// ============================================================================

/**
 * Get per-ad insights for a Google Ads ad using GAQL
 */
export async function getAdInsights(
  client: GoogleAdsClient,
  adResourceName: string,
  startDate: string,
  endDate: string
): Promise<DisplayInsightsResponse> {
  const query = `
    SELECT
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_micros,
      metrics.conversions,
      segments.date
    FROM ad_group_ad
    WHERE ad_group_ad.resource_name = '${adResourceName}'
      AND segments.date BETWEEN '${startDate}' AND '${endDate}'
    ORDER BY segments.date
  `;

  type MetricsRow = {
    metrics?: Record<string, string>;
    segments?: { date: string };
  };
  type StreamChunk = { results?: MetricsRow[] };

  const raw = await client.query<StreamChunk | StreamChunk[]>(query);

  const allRows: MetricsRow[] = [];
  if (Array.isArray(raw)) {
    for (const chunk of raw) {
      if (chunk.results) allRows.push(...chunk.results);
    }
  } else if (raw?.results) {
    allRows.push(...raw.results);
  }

  let totalImpressions = 0;
  let totalClicks = 0;
  let totalCostMicros = BigInt(0);
  let totalConversions = 0;
  let weightedCtr = 0;
  let weightedCpc = 0;
  let count = 0;

  for (const row of allRows) {
    const m = row.metrics;
    if (!m) continue;

    totalImpressions += parseInt(m.impressions || '0', 10);
    totalClicks += parseInt(m.clicks || '0', 10);
    totalCostMicros += BigInt(m.costMicros || '0');
    totalConversions += parseFloat(m.conversions || '0');
    weightedCtr += parseFloat(m.ctr || '0');
    weightedCpc += parseFloat(m.averageCpc || '0');
    count++;
  }

  const avgDivisor = count || 1;
  const totalSpend = Number(totalCostMicros) / 1_000_000;

  return DisplayInsightsResponseSchema.parse({
    impressions: totalImpressions,
    clicks: totalClicks,
    ctr: weightedCtr / avgDivisor,
    averageCpc: weightedCpc / avgDivisor,
    costMicros: totalCostMicros,
    conversions: totalConversions,
    cpm: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
    cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
    costPerConversion: totalConversions > 0 ? totalSpend / totalConversions : 0,
    dateStart: startDate,
    dateEnd: endDate,
  });
}

// ============================================================================
// CAMPAIGN STATUS
// ============================================================================

/**
 * Update campaign status in Google Ads
 */
export async function updateCampaignStatus(
  client: GoogleAdsClient,
  campaignResourceName: string,
  status: 'ENABLED' | 'PAUSED' | 'REMOVED'
): Promise<void> {
  if (status === 'REMOVED') {
    await client.mutate('campaigns', [
      { remove: campaignResourceName },
    ]);
  } else {
    await client.mutate('campaigns', [
      {
        update: {
          resourceName: campaignResourceName,
          status,
        },
      },
    ]);
  }

  log.info({ resourceName: campaignResourceName, status }, 'Campaign status updated');
}

/**
 * Update ad group status in Google Ads
 */
export async function updateAdGroupStatus(
  client: GoogleAdsClient,
  adGroupResourceName: string,
  status: 'ENABLED' | 'PAUSED' | 'REMOVED'
): Promise<void> {
  await client.mutate('adGroups', [
    {
      update: {
        resourceName: adGroupResourceName,
        status,
      },
    },
  ]);

  log.info({ resourceName: adGroupResourceName, status }, 'Ad group status updated');
}

/**
 * Update the daily budget for a Google campaign. The campaign owns a
 * `campaignBudget` resource — that's what we mutate.
 */
export async function updateCampaignBudget(
  client: GoogleAdsClient,
  campaignResourceName: string,
  amountMicros: bigint
): Promise<void> {
  const query = `
    SELECT campaign_budget.resource_name
    FROM campaign
    WHERE campaign.resource_name = '${campaignResourceName}'
  `;

  type BudgetRow = { campaign?: { campaignBudget?: string; campaign_budget?: string } };
  type StreamChunk = { results?: BudgetRow[] };
  const raw = await client.query<StreamChunk | StreamChunk[]>(query);
  const rows: BudgetRow[] = [];
  if (Array.isArray(raw)) {
    for (const chunk of raw) if (chunk.results) rows.push(...chunk.results);
  } else if (raw?.results) {
    rows.push(...raw.results);
  }
  const budgetResourceName =
    rows[0]?.campaign?.campaignBudget || rows[0]?.campaign?.campaign_budget;
  if (!budgetResourceName) {
    throw new GoogleAdsApiError('Campaign budget not found for this campaign');
  }

  await client.mutate('campaignBudgets', [
    {
      update: {
        resourceName: budgetResourceName,
        amountMicros: amountMicros.toString(),
      },
    },
  ]);

  log.info({ resourceName: budgetResourceName, amountMicros: amountMicros.toString() }, 'Campaign budget updated');
}

/**
 * Update the end date of a Google campaign.
 */
export async function updateCampaignEndDate(
  client: GoogleAdsClient,
  campaignResourceName: string,
  endDateIsoDate: string | null
): Promise<void> {
  await client.mutate('campaigns', [
    {
      update: {
        resourceName: campaignResourceName,
        ...(endDateIsoDate ? { endDateTime: `${endDateIsoDate} 23:59:59` } : { endDateTime: null }),
      },
    },
  ]);
  log.info({ resourceName: campaignResourceName, endDateIsoDate }, 'Campaign end date updated');
}

/**
 * Remove an ad from Google Ads (used when swapping a rejected ad for a fresh
 * one — Demand Gen ads are immutable, so the pattern is "create new, remove old").
 */
export async function removeAd(
  client: GoogleAdsClient,
  adGroupAdResourceName: string
): Promise<void> {
  await client.mutate('adGroupAds', [{ remove: adGroupAdResourceName }]);
  log.info({ resourceName: adGroupAdResourceName }, 'Google ad removed');
}

/**
 * Fetch approval/review state for a batch of Google ads.
 */
export type GoogleAdApprovalRaw = {
  resourceName: string;
  approvalStatus: string | null;
  reviewStatus: string | null;
  policyTopicEntries: Array<{
    topic?: string;
    type?: string;
    evidences?: unknown[];
    constraints?: unknown[];
  }>;
};

export async function getAdApprovalStatuses(
  client: GoogleAdsClient,
  adResourceNames: string[]
): Promise<GoogleAdApprovalRaw[]> {
  if (adResourceNames.length === 0) return [];

  const inClause = adResourceNames.map((r) => `'${r}'`).join(', ');
  const query = `
    SELECT
      ad_group_ad.resource_name,
      ad_group_ad.policy_summary.approval_status,
      ad_group_ad.policy_summary.review_status,
      ad_group_ad.policy_summary.policy_topic_entries
    FROM ad_group_ad
    WHERE ad_group_ad.resource_name IN (${inClause})
  `;

  type Row = {
    adGroupAd?: {
      resourceName?: string;
      policySummary?: {
        approvalStatus?: string;
        reviewStatus?: string;
        policyTopicEntries?: Array<{
          topic?: string;
          type?: string;
          evidences?: unknown[];
          constraints?: unknown[];
        }>;
      };
    };
    // Some client shapes return snake_case; handle both.
    ad_group_ad?: {
      resource_name?: string;
      policy_summary?: {
        approval_status?: string;
        review_status?: string;
        policy_topic_entries?: Array<{
          topic?: string;
          type?: string;
          evidences?: unknown[];
          constraints?: unknown[];
        }>;
      };
    };
  };
  type StreamChunk = { results?: Row[] };

  const raw = await client.query<StreamChunk | StreamChunk[]>(query);
  const rows: Row[] = [];
  if (Array.isArray(raw)) {
    for (const chunk of raw) if (chunk.results) rows.push(...chunk.results);
  } else if (raw?.results) {
    rows.push(...raw.results);
  }

  return rows.map((row) => {
    const camel = row.adGroupAd;
    const snake = row.ad_group_ad;
    const resourceName = camel?.resourceName || snake?.resource_name || '';
    const summary = camel?.policySummary;
    const summarySnake = snake?.policy_summary;
    return {
      resourceName,
      approvalStatus: summary?.approvalStatus || summarySnake?.approval_status || null,
      reviewStatus: summary?.reviewStatus || summarySnake?.review_status || null,
      policyTopicEntries: summary?.policyTopicEntries || summarySnake?.policy_topic_entries || [],
    };
  });
}

/**
 * Get campaign status from Google Ads
 */
export async function getCampaignStatus(
  client: GoogleAdsClient,
  campaignResourceName: string
): Promise<string> {
  const query = `
    SELECT campaign.status
    FROM campaign
    WHERE campaign.resource_name = '${campaignResourceName}'
  `;

  type StatusRow = { campaign?: { status: string } };
  type StreamChunk = { results?: StatusRow[] };

  const raw = await client.query<StreamChunk | StreamChunk[]>(query);

  const allRows: StatusRow[] = [];
  if (Array.isArray(raw)) {
    for (const chunk of raw) {
      if (chunk.results) allRows.push(...chunk.results);
    }
  } else if (raw?.results) {
    allRows.push(...raw.results);
  }

  if (allRows.length === 0) {
    throw new GoogleAdsApiError('Campaign not found in Google Ads');
  }

  return allRows[0].campaign?.status || 'UNKNOWN';
}
