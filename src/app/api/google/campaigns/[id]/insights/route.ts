/**
 * Google Campaign Insights API Endpoint
 *
 * GET /api/google/campaigns/[id]/insights
 *
 * Fetches YouTube metrics from Google Ads API using GAQL.
 *
 * Caching:
 * - Active campaigns: 1-hour cache
 * - Completed campaigns: 24-hour cache
 */

import { NextRequest, NextResponse } from 'next/server';
import { google, getYouTubeInsights, GoogleAdsApiError } from '#google';
import prisma from '#prisma';

// In-memory cache for insights
interface CachedInsights {
  data: YouTubeInsightsResponse;
  timestamp: number;
  ttl: number;
}

const insightsCache = new Map<string, CachedInsights>();

const ACTIVE_CAMPAIGN_TTL = 60 * 60 * 1000; // 1 hour
const COMPLETED_CAMPAIGN_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface YouTubeInsightsResponse {
  impressions: number;
  videoViews: number;
  videoViewRate: number;
  averageCpv: number;
  spend: number;
  clicks: number;
  ctr: number;
  videoQuartile25Rate: number;
  videoQuartile50Rate: number;
  videoQuartile75Rate: number;
  videoQuartile100Rate: number;
  dateStart: string;
  dateEnd: string;
}

function getCachedInsights(campaignId: string): YouTubeInsightsResponse | null {
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
  data: YouTubeInsightsResponse,
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
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      select: {
        id: true,
        platforms: true,
        googleCampaignId: true,
        googleEntityStatus: true,
        status: true,
        startDate: true,
        endDate: true,
      },
    });

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    if (!campaign.platforms.includes('GOOGLE')) {
      return NextResponse.json({ error: 'Not a Google campaign' }, { status: 400 });
    }

    if (!campaign.googleCampaignId) {
      return NextResponse.json({
        synced: false,
        message: 'Campaign has not been synced to Google Ads',
        data: null,
      });
    }

    // Check if campaign start date is in the future
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const startDateStr = campaign.startDate.toISOString().split('T')[0];

    if (campaign.startDate > now) {
      const scheduledResponse: YouTubeInsightsResponse = {
        impressions: 0,
        videoViews: 0,
        videoViewRate: 0,
        averageCpv: 0,
        spend: 0,
        clicks: 0,
        ctr: 0,
        videoQuartile25Rate: 0,
        videoQuartile50Rate: 0,
        videoQuartile75Rate: 0,
        videoQuartile100Rate: 0,
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

    // Check cache
    const cached = getCachedInsights(id);
    if (cached) {
      return NextResponse.json({
        synced: true,
        cached: true,
        data: cached,
      });
    }

    // Fetch insights from Google Ads
    const isActive = campaign.googleEntityStatus === 'ENABLED';
    const endDateStr = campaign.endDate?.toISOString().split('T')[0] || today;
    const effectiveEndDate = endDateStr > today ? today : endDateStr;

    const googleInsights = await getYouTubeInsights(
      google,
      campaign.googleCampaignId,
      startDateStr,
      effectiveEndDate
    );

    const response: YouTubeInsightsResponse = {
      impressions: googleInsights.impressions,
      videoViews: googleInsights.videoViews,
      videoViewRate: googleInsights.videoViewRate,
      averageCpv: googleInsights.averageCpv,
      spend: Number(googleInsights.costMicros) / 1_000_000,
      clicks: googleInsights.clicks,
      ctr: googleInsights.ctr,
      videoQuartile25Rate: googleInsights.videoQuartile25Rate,
      videoQuartile50Rate: googleInsights.videoQuartile50Rate,
      videoQuartile75Rate: googleInsights.videoQuartile75Rate,
      videoQuartile100Rate: googleInsights.videoQuartile100Rate,
      dateStart: googleInsights.dateStart,
      dateEnd: googleInsights.dateEnd,
    };

    // Cache the results
    setCachedInsights(id, response, isActive);

    return NextResponse.json({
      synced: true,
      cached: false,
      data: response,
    });
  } catch (error) {
    console.error('Error fetching YouTube insights:', error);

    if (error instanceof GoogleAdsApiError) {
      return NextResponse.json(
        {
          error: 'Google Ads API Error',
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
