/**
 * Google Ad Insights API Endpoint
 *
 * GET /api/google/ads/[id]/insights
 *
 * Fetches per-ad metrics from Google Ads API using GAQL.
 *
 * Caching:
 * - Active campaigns: 1-hour cache
 * - Completed campaigns: 24-hour cache
 */

import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { google, getAdInsights, GoogleAdsApiError } from '#google';
import { getAdById } from '@/models/ad';
import { getPartnerFromRequest, canManageCampaign } from '@/lib/auth';

interface AdInsightsResponse {
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  costPerConversion: number;
  ctr: number;
  dateStart: string;
  dateEnd: string;
}

interface CachedAdInsights {
  data: AdInsightsResponse;
  timestamp: number;
  ttl: number;
}

const adInsightsCache = new Map<string, CachedAdInsights>();

const ACTIVE_TTL = 60 * 60 * 1000; // 1 hour
const COMPLETED_TTL = 24 * 60 * 60 * 1000; // 24 hours

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const partner = await getPartnerFromRequest(request);
  if (!partner) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const ad = await getAdById(id);

    // 404 (not 403) for someone else's ad: do not reveal that it exists.
    if (!ad || !canManageCampaign(partner, ad.campaign.partnerId).allowed) {
      return NextResponse.json({ error: 'Ad not found' }, { status: 404 });
    }

    if (!ad.googleAdId) {
      return NextResponse.json({
        synced: false,
        message: 'Ad has not been synced to Google Ads',
        data: null,
      });
    }

    // Check cache
    const cached = adInsightsCache.get(id);
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      return NextResponse.json({ synced: true, cached: true, data: cached.data });
    }

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const startDateStr = ad.campaign.startDate.toISOString().split('T')[0];
    const endDateStr = ad.campaign.endDate?.toISOString().split('T')[0] || today;
    const effectiveEndDate = endDateStr > today ? today : endDateStr;

    // Check if campaign hasn't started yet
    if (ad.campaign.startDate > now) {
      return NextResponse.json({
        synced: true,
        scheduled: true,
        data: {
          impressions: 0, clicks: 0, spend: 0, conversions: 0,
          costPerConversion: 0, ctr: 0,
          dateStart: startDateStr, dateEnd: endDateStr,
        } satisfies AdInsightsResponse,
      });
    }

    const insights = await getAdInsights(
      google,
      ad.googleAdId,
      startDateStr,
      effectiveEndDate
    );

    const response: AdInsightsResponse = {
      impressions: insights.impressions,
      clicks: insights.clicks,
      spend: Number(insights.costMicros) / 1_000_000,
      conversions: insights.conversions,
      costPerConversion: insights.costPerConversion,
      ctr: insights.ctr,
      dateStart: insights.dateStart,
      dateEnd: insights.dateEnd,
    };

    const isActive = ad.campaign.googleEntityStatus === 'ENABLED';
    adInsightsCache.set(id, {
      data: response,
      timestamp: Date.now(),
      ttl: isActive ? ACTIVE_TTL : COMPLETED_TTL,
    });

    return NextResponse.json({ synced: true, cached: false, data: response });
  } catch (error) {
    logger.error({ err: error }, 'Error fetching ad insights from Google');

    if (error instanceof GoogleAdsApiError) {
      return NextResponse.json(
        { error: 'Google Ads API Error', message: error.message, code: error.errorCode },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch ad insights' },
      { status: 500 }
    );
  }
}
