import { NextRequest, NextResponse } from 'next/server';

import { authorizeInternalRequest } from '@/lib/auth';
import { syncPendingCampaign } from '@/lib/campaigns/pending';
import logger from '@/lib/logger';
import {
  getCampaignsPendingAssets,
  getCampaignsStuckSyncing,
  markCampaignError,
} from '@/models/campaign';

/** A publish runs inside one request; minutes of SYNCING means it died. */
const STUCK_SYNCING_AFTER_MS = 15 * 60 * 1000;

/**
 * GET /api/cron/sync-pending-campaigns
 *
 * Sweeps every campaign left in PENDING_ASSETS and completes the platform sync
 * for those whose assets have landed.
 *
 * This is the safety net, not the main path: `onAdAssetsReady` enqueues each
 * campaign the moment its images appear, so by the time this runs there is
 * usually nothing to do. It exists to catch enqueues that never happened or
 * exhausted their retries.
 *
 * Authorized by an OIDC token from the scheduler's service account.
 */
export async function GET(req: NextRequest) {
  if (!(await authorizeInternalRequest(req.headers.get('authorization')))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const pendingCampaigns = await getCampaignsPendingAssets();

    let syncedCount = 0;
    let stillPendingCount = 0;
    const errors: Array<{ campaignId: string; error: string }> = [];

    for (const campaign of pendingCampaigns) {
      const result = await syncPendingCampaign(campaign);

      if (result.synced) syncedCount++;
      if (result.stillPending) stillPendingCount++;
      errors.push(...result.errors);
    }

    // Campaigns whose publish request died after creating the platform objects
    // but before any ad. Nothing will ever move them on its own, so surface the
    // failure instead of leaving the producer on "Publishing" forever.
    const cutoff = new Date(Date.now() - STUCK_SYNCING_AFTER_MS);
    const stuck = await getCampaignsStuckSyncing(cutoff);

    for (const campaign of stuck) {
      logger.warn(
        { campaignId: campaign.id, metaCampaignId: campaign.metaCampaignId },
        'Campaign stuck mid-publish; marking as errored'
      );
      await markCampaignError(campaign.id, {
        message: 'Publishing was interrupted before your ads were created. Please try again.',
      }).catch((error) => {
        logger.error({ err: error, campaignId: campaign.id }, 'Could not mark stuck campaign');
      });
    }

    return NextResponse.json({
      processed: pendingCampaigns.length,
      synced: syncedCount,
      stillPending: stillPendingCount,
      stuckSyncing: stuck.length,
      errors,
    });
  } catch (error) {
    logger.error({ err: error }, 'Error processing pending campaigns');
    return NextResponse.json(
      { error: 'Error processing pending campaigns' },
      { status: 500 }
    );
  }
}
