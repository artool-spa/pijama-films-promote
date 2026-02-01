/**
 * Meta Campaign Insights API Endpoint
 *
 * GET /api/meta/campaigns/[id]/insights
 *
 * Fetches real-time metrics from Meta Ads Insights API for a CBO campaign.
 * With CBO, we fetch insights at the campaign level which aggregates all AdSets.
 *
 * Caching:
 * - Active campaigns: 1-hour cache
 * - Completed campaigns: 24-hour cache
 */

import { NextRequest, NextResponse } from 'next/server';
import { meta, getInsights, MetaApiError } from '@/lib/meta';
import prisma from '#prisma';

// In-memory cache for insights
interface CachedInsights {
  data: InsightsResponse;
  timestamp: number;
  ttl: number;
}

const insightsCache = new Map<string, CachedInsights>();

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

function getCachedInsights(campaignId: string): InsightsResponse | null {
  const cached = insightsCache.get(campaignId);
  if (!cached) return null;

  const now = Date.now();
  if (now - cached.timestamp > cached.ttl) {
    insightsCache.delete(campaignId);
    return null;
  }

  return cached.data;
}

function setCachedInsights(
  campaignId: string,
  data: InsightsResponse,
  isActive: boolean
): void {
  insightsCache.set(campaignId, {
    data,
    timestamp: Date.now(),
    ttl: isActive ? ACTIVE_CAMPAIGN_TTL : COMPLETED_CAMPAIGN_TTL,
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // First, get the campaign from our database
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      select: {
        id: true,
        metaCampaignId: true, // CBO campaign ID
        imageAdSetId: true,
        videoAdSetId: true,
        status: true,
        startDate: true,
        endDate: true,
      },
    });

    if (!campaign) {
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

    // Check cache first
    const cached = getCachedInsights(id);
    if (cached) {
      return NextResponse.json({
        synced: true,
        cached: true,
        data: cached,
      });
    }

    // Fetch insights from Meta API at campaign level (aggregates all AdSets)
    const isActive = campaign.status === 'ACTIVE';
    const endDateStr = campaign.endDate?.toISOString().split('T')[0] || today;
    const dateRange = {
      since: startDateStr,
      // Don't request future dates - use today if end date is in the future
      until: endDateStr > today ? today : endDateStr,
    };

    const metaInsights = await getInsights(meta, campaign.metaCampaignId, {
      level: 'campaign',
      time_range: dateRange,
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
    setCachedInsights(id, response, isActive);

    return NextResponse.json({
      synced: true,
      cached: false,
      data: response,
    });
  } catch (error) {
    console.error('Error fetching campaign insights:', error);

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
