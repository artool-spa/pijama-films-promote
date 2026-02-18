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
  const budgetResult = await client.mutate('campaignBudgets', [
    {
      create: {
        name: `Budget - ${validated.name}`,
        amountMicros: validated.budgetAmountMicros.toString(),
        deliveryMethod: 'STANDARD',
        ...(validated.budgetType === 'TOTAL'
          ? { explicitlyShared: false }
          : {}),
      },
    },
  ]);

  const budgetResourceName = budgetResult.results[0].resourceName;
  console.log('[Google] Budget created:', budgetResourceName);

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
  const campaignResult = await client.mutate('campaigns', [
    {
      create: {
        name: validated.name,
        status: validated.status,
        advertisingChannelType: 'VIDEO',
        campaignBudget: budgetResourceName,
        startDate: validated.startDate,
        endDate: validated.endDate,
        ...biddingConfig,
      },
    },
  ]);

  const resourceName = campaignResult.results[0].resourceName;
  console.log('[Google] Video campaign created:', resourceName);

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
    type: 'VIDEO_RESPONSIVE', // Supports multiple ad formats (skippable, non-skippable, bumper, etc.)
  };

  if (validated.cpvBidMicros) {
    adGroupData.cpvBidMicros = validated.cpvBidMicros.toString();
  }

  const result = await client.mutate('adGroups', [
    { create: adGroupData },
  ]);

  const resourceName = result.results[0].resourceName;
  console.log('[Google] Ad group created:', resourceName);

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
        status: 'PAUSED',
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
  console.log('[Google] Video ad created:', resourceName);

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
    status: 'PAUSED',
    biddingStrategy: config.biddingStrategy as GoogleCampaignCreate['biddingStrategy'],
    targetCpvMicros: config.targetCpvMicros,
  });

  // Step 2: Apply targeting criteria to campaign
  await applyTargetingToCampaign(client, campaign.resourceName, config.targeting);

  // Step 3: Create ad group
  const adGroup = await createVideoAdGroup(client, {
    name: `${config.name} - Ad Group`,
    campaignResourceName: campaign.resourceName,
    status: 'PAUSED',
    cpvBidMicros: config.targetCpvMicros,
  });

  return {
    campaignResourceName: campaign.resourceName,
    adGroupResourceName: adGroup.resourceName,
  };
}

/**
 * Apply targeting criteria to a campaign
 */
async function applyTargetingToCampaign(
  client: GoogleAdsClient,
  campaignResourceName: string,
  targeting: GoogleTargetingResult
): Promise<void> {
  const operations: Array<{ create: unknown }> = [];

  // Add geo targets
  for (const geoTarget of targeting.geoTargets) {
    operations.push({
      create: {
        campaign: campaignResourceName,
        type: 'LOCATION',
        location: { geoTargetConstant: geoTarget },
      },
    });
  }

  // Add gender targeting
  for (const gender of targeting.genders) {
    operations.push({
      create: {
        campaign: campaignResourceName,
        type: 'GENDER',
        gender: { type: gender },
      },
    });
  }

  // Add age range targeting
  if (targeting.ageRange) {
    // We need to add all applicable age ranges between min and max
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
          type: 'AGE_RANGE',
          ageRange: { type: allRanges[i] },
        },
      });
    }
  }

  // Add affinity audiences
  for (const audience of targeting.affinityAudiences) {
    operations.push({
      create: {
        campaign: campaignResourceName,
        type: 'USER_INTEREST',
        userInterest: { userInterestCategory: audience },
      },
    });
  }

  if (operations.length > 0) {
    await client.mutate('campaignCriteria', operations);
    console.log('[Google] Applied', operations.length, 'targeting criteria');
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
      metrics.video_views,
      metrics.video_view_rate,
      metrics.average_cpv,
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

  const response = await client.query<{
    results?: Array<{
      metrics?: Record<string, string>;
      segments?: { date: string };
    }>;
  }>(query);

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

  if (response.results) {
    for (const row of response.results) {
      const m = row.metrics;
      if (!m) continue;

      totalImpressions += parseInt(m.impressions || '0', 10);
      totalViews += parseInt(m.video_views || '0', 10);
      totalCostMicros += BigInt(m.cost_micros || '0');
      totalClicks += parseInt(m.clicks || '0', 10);
      weightedViewRate += parseFloat(m.video_view_rate || '0');
      weightedCpv += parseFloat(m.average_cpv || '0');
      weightedCtr += parseFloat(m.ctr || '0');
      weightedQ25 += parseFloat(m.video_quartile_p25_rate || '0');
      weightedQ50 += parseFloat(m.video_quartile_p50_rate || '0');
      weightedQ75 += parseFloat(m.video_quartile_p75_rate || '0');
      weightedQ100 += parseFloat(m.video_quartile_p100_rate || '0');
      count++;
    }
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
  const budgetResult = await client.mutate('campaignBudgets', [
    {
      create: {
        name: `Budget - ${validated.name}`,
        amountMicros: validated.budgetAmountMicros.toString(),
        deliveryMethod: 'STANDARD',
        ...(validated.budgetType === 'TOTAL'
          ? { explicitlyShared: false }
          : {}),
      },
    },
  ]);

  const budgetResourceName = budgetResult.results[0].resourceName;
  console.log('[Google] Budget created:', budgetResourceName);

  // Build bidding strategy
  const biddingConfig: Record<string, unknown> = {};
  if (validated.biddingStrategy === 'MAXIMIZE_CLICKS') {
    biddingConfig.maximizeClicks = {};
  } else if (validated.biddingStrategy === 'MAXIMIZE_CONVERSIONS') {
    biddingConfig.maximizeConversions = {};
  } else if (validated.biddingStrategy === 'TARGET_CPA') {
    biddingConfig.targetCpa = {};
  }

  // Create the Demand Gen campaign
  const campaignResult = await client.mutate('campaigns', [
    {
      create: {
        name: validated.name,
        status: validated.status,
        advertisingChannelType: 'DEMAND_GEN',
        campaignBudget: budgetResourceName,
        startDate: validated.startDate,
        endDate: validated.endDate,
        ...biddingConfig,
      },
    },
  ]);

  const resourceName = campaignResult.results[0].resourceName;
  console.log('[Google] Demand Gen campaign created:', resourceName);

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
    type: 'DISPLAY_STANDARD',
  };

  if (validated.cpcBidMicros) {
    adGroupData.cpcBidMicros = validated.cpcBidMicros.toString();
  }

  const result = await client.mutate('adGroups', [
    { create: adGroupData },
  ]);

  const resourceName = result.results[0].resourceName;
  console.log('[Google] Demand Gen ad group created:', resourceName);

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
  console.log('[Google] Image asset uploaded:', resourceName);

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

  const marketingImages = validated.imageAssetResourceNames.map(resourceName => ({
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
        status: 'PAUSED',
        ad: {
          name: validated.name,
          finalUrls: [validated.finalUrl],
          demandGenMultiAssetAd: {
            marketingImages,
            headlines,
            descriptions,
            businessName: validated.businessName,
            callToActionText: validated.callToAction,
          },
        },
      },
    },
  ]);

  const resourceName = result.results[0].resourceName;
  console.log('[Google] Demand Gen image ad created:', resourceName);

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
    status: 'PAUSED',
    biddingStrategy: config.biddingStrategy as DemandGenCampaignCreate['biddingStrategy'],
  });

  // Step 2: Apply targeting criteria to campaign
  await applyTargetingToCampaign(client, campaign.resourceName, config.targeting);

  // Step 3: Create ad group
  const adGroup = await createDemandGenAdGroup(client, {
    name: `${config.name} - Ad Group`,
    campaignResourceName: campaign.resourceName,
    status: 'PAUSED',
  });

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

  const response = await client.query<{
    results?: Array<{
      metrics?: Record<string, string>;
      segments?: { date: string };
    }>;
  }>(query);

  // Aggregate results
  let totalImpressions = 0;
  let totalClicks = 0;
  let totalCostMicros = BigInt(0);
  let totalConversions = 0;
  let weightedCtr = 0;
  let weightedCpc = 0;
  let count = 0;

  if (response.results) {
    for (const row of response.results) {
      const m = row.metrics;
      if (!m) continue;

      totalImpressions += parseInt(m.impressions || '0', 10);
      totalClicks += parseInt(m.clicks || '0', 10);
      totalCostMicros += BigInt(m.cost_micros || '0');
      totalConversions += parseFloat(m.conversions || '0');
      weightedCtr += parseFloat(m.ctr || '0');
      weightedCpc += parseFloat(m.average_cpc || '0');
      count++;
    }
  }

  const avgDivisor = count || 1;

  return DisplayInsightsResponseSchema.parse({
    impressions: totalImpressions,
    clicks: totalClicks,
    ctr: weightedCtr / avgDivisor,
    averageCpc: weightedCpc / avgDivisor,
    costMicros: totalCostMicros,
    conversions: totalConversions,
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
  await client.mutate('campaigns', [
    {
      update: {
        resourceName: campaignResourceName,
        status,
      },
    },
  ]);

  console.log('[Google] Campaign status updated:', campaignResourceName, '->', status);
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

  console.log('[Google] Ad group status updated:', adGroupResourceName, '->', status);
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

  const response = await client.query<{
    results?: Array<{ campaign?: { status: string } }>;
  }>(query);

  if (!response.results || response.results.length === 0) {
    throw new GoogleAdsApiError('Campaign not found in Google Ads');
  }

  return response.results[0].campaign?.status || 'UNKNOWN';
}
