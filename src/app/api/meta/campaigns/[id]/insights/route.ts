/**
 * Meta Campaign Insights API Endpoint
 *
 * GET /api/meta/campaigns/[id]/insights
 * GET /api/meta/campaigns/[id]/insights?breakdown=platform
 *
 * Fetches real-time metrics from Meta Ads Insights API for a CBO campaign.
 * With CBO, we fetch insights at the campaign level which aggregates all AdSets.
 *
 * When breakdown=platform is specified, returns per-platform metrics alongside
 * aggregated totals computed from the breakdown rows.
 *
 * Caching:
 * - Active campaigns: 1-hour cache
 * - Completed campaigns: 24-hour cache
 */

import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { meta, getInsights, MetaApiError } from '@/lib/meta';
import type { MetaInsightData } from '@/lib/meta/types';
import { getCampaignById } from '@/models/campaign';
import { getPartnerFromRequest, canManageCampaign } from '@/lib/auth';

// In-memory cache for insights
interface CachedInsights {
  data: InsightsResponse;
  timestamp: number;
  ttl: number;
}

interface CachedPlatformInsights {
  data: PlatformBreakdownResponse;
  timestamp: number;
  ttl: number;
}

const insightsCache = new Map<string, CachedInsights>();
const platformCache = new Map<string, CachedPlatformInsights>();

// Cache TTLs in milliseconds
const ACTIVE_CAMPAIGN_TTL = 60 * 60 * 1000; // 1 hour
const COMPLETED_CAMPAIGN_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface InsightsResponse {
  impressions: number;
  clicks: number;
  spend: number;
  reach: number;
  frequency: number;
  conversions: number;
  costPerConversion: number;
  ctr: number;
  cpm: number;
  cpc: number;
  dateStart: string;
  dateEnd: string;
}

interface PlatformInsights {
  platform: string;
  platformLabel: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  costPerConversion: number;
  ctr: number;
}

interface PlatformBreakdownResponse {
  aggregate: InsightsResponse;
  platforms: PlatformInsights[];
}

const PLATFORM_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  audience_network: 'Audience Network',
  messenger: 'Messenger',
};

function getCachedInsights(cacheKey: string): InsightsResponse | null {
  const cached = insightsCache.get(cacheKey);
  if (!cached) return null;

  const now = Date.now();
  if (now - cached.timestamp > cached.ttl) {
    insightsCache.delete(cacheKey);
    return null;
  }

  return cached.data;
}

function setCachedInsights(
  cacheKey: string,
  data: InsightsResponse,
  isActive: boolean
): void {
  insightsCache.set(cacheKey, {
    data,
    timestamp: Date.now(),
    ttl: isActive ? ACTIVE_CAMPAIGN_TTL : COMPLETED_CAMPAIGN_TTL,
  });
}

function getCachedPlatformInsights(cacheKey: string): PlatformBreakdownResponse | null {
  const cached = platformCache.get(cacheKey);
  if (!cached) return null;

  const now = Date.now();
  if (now - cached.timestamp > cached.ttl) {
    platformCache.delete(cacheKey);
    return null;
  }

  return cached.data;
}

function setCachedPlatformInsights(
  cacheKey: string,
  data: PlatformBreakdownResponse,
  isActive: boolean
): void {
  platformCache.set(cacheKey, {
    data,
    timestamp: Date.now(),
    ttl: isActive ? ACTIVE_CAMPAIGN_TTL : COMPLETED_CAMPAIGN_TTL,
  });
}

function parseInsightRow(row: MetaInsightData): {
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
} {
  const purchaseAction = row.actions?.find(
    (a) => a.action_type === 'purchase' || a.action_type === 'omni_purchase'
  );

  return {
    impressions: parseInt(row.impressions || '0', 10),
    clicks: parseInt(row.clicks || '0', 10),
    spend: parseFloat(row.spend || '0'),
    conversions: purchaseAction ? parseInt(purchaseAction.value, 10) : 0,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const partner = await getPartnerFromRequest(request);
  if (!partner) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const wantsPlatformBreakdown = request.nextUrl.searchParams.get('breakdown') === 'platform';
  // Optional user-selected reporting period (clamped to the campaign's own range below)
  const sinceParam = request.nextUrl.searchParams.get('since');
  const untilParam = request.nextUrl.searchParams.get('until');

  try {
    // First, get the campaign from our database
    const campaign = await getCampaignById(id);

    // 404 (not 403) for someone else's campaign: do not reveal that it exists.
    if (!campaign || !canManageCampaign(partner, campaign.partnerId).allowed) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // If campaign hasn't been synced to Meta, return empty metrics
    if (!campaign.metaCampaignId) {
      return NextResponse.json({
        synced: false,
        message: 'Campaign has not been synced to Meta Ads',
        data: null,
      });
    }

    // Check if campaign start date is in the future
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const startDateStr = campaign.startDate.toISOString().split('T')[0];

    if (campaign.startDate > now) {
      // Campaign hasn't started yet - no insights available
      const scheduledResponse: InsightsResponse = {
        impressions: 0,
        clicks: 0,
        spend: 0,
        reach: 0,
        frequency: 0,
        conversions: 0,
        costPerConversion: 0,
        ctr: 0,
        cpm: 0,
        cpc: 0,
        dateStart: startDateStr,
        dateEnd: campaign.endDate?.toISOString().split('T')[0] || startDateStr,
      };

      return NextResponse.json({
        synced: true,
        scheduled: true,
        message: 'Campaign has not started yet',
        data: scheduledResponse,
      });
    }

    const isActive = campaign.status === 'ACTIVE';
    const endDateStr = campaign.endDate?.toISOString().split('T')[0] || today;
    // The campaign's own reportable window: [startDate, min(endDate, today)]
    const campaignEnd = endDateStr > today ? today : endDateStr;

    // Apply an optional user-selected period, clamped inside the campaign window.
    // ISO YYYY-MM-DD strings compare lexicographically, so string min/max is safe.
    const isIsoDate = (s: string | null): s is string =>
      !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
    const since = isIsoDate(sinceParam) && sinceParam > startDateStr ? sinceParam : startDateStr;
    let until = isIsoDate(untilParam) && untilParam < campaignEnd ? untilParam : campaignEnd;
    // Guard against an inverted range (selected period entirely before the campaign)
    if (until < since) until = since;

    const dateRange = {
      since,
      until,
    };

    const insightsFields = [
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
    ];

    // Platform breakdown path
    if (wantsPlatformBreakdown) {
      const platformCacheKey = `${id}:platform:${dateRange.since}:${dateRange.until}`;
      const cachedPlatform = getCachedPlatformInsights(platformCacheKey);
      if (cachedPlatform) {
        return NextResponse.json({
          synced: true,
          cached: true,
          data: cachedPlatform.aggregate,
          platforms: cachedPlatform.platforms,
        });
      }

      const metaInsights = await getInsights(meta, campaign.metaCampaignId, {
        level: 'campaign',
        time_range: dateRange,
        fields: insightsFields,
        breakdowns: ['publisher_platform'],
      });

      if (metaInsights.data.length === 0) {
        const emptyResponse: InsightsResponse = {
          impressions: 0,
          clicks: 0,
          spend: 0,
          reach: 0,
          frequency: 0,
          conversions: 0,
          costPerConversion: 0,
          ctr: 0,
          cpm: 0,
          cpc: 0,
          dateStart: dateRange.since,
          dateEnd: dateRange.until,
        };

        return NextResponse.json({
          synced: true,
          cached: false,
          message: 'No metrics data available yet',
          data: emptyResponse,
          platforms: [],
        });
      }

      // Build per-platform metrics
      const platforms: PlatformInsights[] = metaInsights.data.map((row) => {
        const parsed = parseInsightRow(row);
        const platform = row.publisher_platform || 'unknown';
        return {
          platform,
          platformLabel: PLATFORM_LABELS[platform] || platform,
          impressions: parsed.impressions,
          clicks: parsed.clicks,
          spend: parsed.spend,
          conversions: parsed.conversions,
          costPerConversion: parsed.conversions > 0
            ? parsed.spend / parsed.conversions
            : 0,
          ctr: parsed.impressions > 0
            ? (parsed.clicks / parsed.impressions) * 100
            : 0,
        };
      });

      // Compute aggregate by summing additive metrics
      const totals = platforms.reduce(
        (acc, p) => ({
          impressions: acc.impressions + p.impressions,
          clicks: acc.clicks + p.clicks,
          spend: acc.spend + p.spend,
          conversions: acc.conversions + p.conversions,
        }),
        { impressions: 0, clicks: 0, spend: 0, conversions: 0 }
      );

      const aggregate: InsightsResponse = {
        impressions: totals.impressions,
        clicks: totals.clicks,
        spend: totals.spend,
        reach: 0, // Not available in breakdown
        frequency: 0,
        conversions: totals.conversions,
        costPerConversion: totals.conversions > 0
          ? totals.spend / totals.conversions
          : 0,
        ctr: totals.impressions > 0
          ? (totals.clicks / totals.impressions) * 100
          : 0,
        cpm: totals.impressions > 0
          ? (totals.spend / totals.impressions) * 1000
          : 0,
        cpc: totals.clicks > 0 ? totals.spend / totals.clicks : 0,
        dateStart: metaInsights.data[0].date_start || dateRange.since,
        dateEnd: metaInsights.data[0].date_stop || dateRange.until,
      };

      const breakdownResponse: PlatformBreakdownResponse = { aggregate, platforms };
      setCachedPlatformInsights(platformCacheKey, breakdownResponse, isActive);

      return NextResponse.json({
        synced: true,
        cached: false,
        data: aggregate,
        platforms,
      });
    }

    // Standard (non-breakdown) path
    const cacheKey = `${id}:${dateRange.since}:${dateRange.until}`;
    const cached = getCachedInsights(cacheKey);
    if (cached) {
      return NextResponse.json({
        synced: true,
        cached: true,
        data: cached,
      });
    }

    // Fetch insights from Meta API at campaign level (aggregates all AdSets)
    const metaInsights = await getInsights(meta, campaign.metaCampaignId, {
      level: 'campaign',
      time_range: dateRange,
      fields: insightsFields,
    });

    // Parse the insights data
    const insightData = metaInsights.data[0];
    if (!insightData) {
      // No data yet (campaign might be too new)
      const emptyResponse: InsightsResponse = {
        impressions: 0,
        clicks: 0,
        spend: 0,
        reach: 0,
        frequency: 0,
        conversions: 0,
        costPerConversion: 0,
        ctr: 0,
        cpm: 0,
        cpc: 0,
        dateStart: dateRange.since,
        dateEnd: dateRange.until,
      };

      return NextResponse.json({
        synced: true,
        cached: false,
        message: 'No metrics data available yet',
        data: emptyResponse,
      });
    }

    // Extract conversions from actions array
    const purchaseAction = insightData.actions?.find(
      (a) => a.action_type === 'purchase' || a.action_type === 'omni_purchase'
    );
    const conversions = purchaseAction ? parseInt(purchaseAction.value, 10) : 0;

    // Extract cost per conversion
    const costPerConversionAction = insightData.cost_per_action_type?.find(
      (a) => a.action_type === 'purchase' || a.action_type === 'omni_purchase'
    );
    const costPerConversion = costPerConversionAction
      ? parseFloat(costPerConversionAction.value)
      : 0;

    const response: InsightsResponse = {
      impressions: parseInt(insightData.impressions || '0', 10),
      clicks: parseInt(insightData.clicks || '0', 10),
      spend: parseFloat(insightData.spend || '0'),
      reach: parseInt(insightData.reach || '0', 10),
      frequency: parseFloat(insightData.frequency || '0'),
      conversions,
      costPerConversion,
      ctr: parseFloat(insightData.ctr || '0'),
      cpm: parseFloat(insightData.cpm || '0'),
      cpc: parseFloat(insightData.cpc || '0'),
      dateStart: insightData.date_start || dateRange.since,
      dateEnd: insightData.date_stop || dateRange.until,
    };

    // Cache the results
    setCachedInsights(cacheKey, response, isActive);

    return NextResponse.json({
      synced: true,
      cached: false,
      data: response,
    });
  } catch (error) {
    logger.error({ err: error }, 'Error fetching campaign insights');

    if (error instanceof MetaApiError) {
      return NextResponse.json(
        {
          error: 'Meta API Error',
          message: error.message,
          code: error.errorCode,
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch campaign insights' },
      { status: 500 }
    );
  }
}
