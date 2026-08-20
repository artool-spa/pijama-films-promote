import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { authorizeInternalRequest } from '@/lib/auth';
import { syncPendingCampaign } from '@/lib/campaigns/pending';
import logger from '@/lib/logger';
import { getCampaignById } from '@/models/campaign';

const SyncCampaignSchema = z.object({
  campaignId: z.string().min(1),
});

/**
 * POST /api/internal/sync-campaign
 *
 * Syncs one campaign whose assets have just become ready. Dispatched by the
 * `syncCampaign` task queue, which is itself enqueued by the `onAdAssetsReady`
 * Firestore trigger.
 *
 * Authorized by an OIDC token from the queue's service account. Not reachable
 * from the dashboard: campaigns are synced through the platform routes.
 */
export async function POST(req: NextRequest) {
  if (!(await authorizeInternalRequest(req.headers.get('authorization')))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = SyncCampaignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { campaignId } = parsed.data;

  try {
    const campaign = await getCampaignById(campaignId);
    if (!campaign) {
      // The campaign was deleted between enqueue and dispatch. Nothing to do,
      // and a retry would never succeed.
      return NextResponse.json({ campaignId, status: 'not_found' });
    }

    if (campaign.status !== 'PENDING_ASSETS') {
      // Already synced, or moved on by another path. Same reasoning.
      return NextResponse.json({ campaignId, status: 'not_pending' });
    }

    const result = await syncPendingCampaign(campaign);

    if (result.errors.length > 0) {
      // 500 so Cloud Tasks retries with backoff. The detail stays in the logs.
      logger.error({ campaignId, errors: result.errors }, 'Campaign sync failed');
      return NextResponse.json({ error: 'Campaign sync failed' }, { status: 500 });
    }

    return NextResponse.json({
      campaignId,
      status: result.stillPending ? 'still_pending' : 'synced',
    });
  } catch (error) {
    logger.error({ err: error, campaignId }, 'Error syncing campaign');
    return NextResponse.json({ error: 'Error syncing campaign' }, { status: 500 });
  }
}
