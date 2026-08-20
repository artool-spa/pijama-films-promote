import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { logger } from 'firebase-functions/v2';

import { callBackend } from './backend.js';
import { becameAssetReady } from './should-enqueue.js';

initializeApp();

const REGION = 'us-central1';
const SYNC_CAMPAIGN_QUEUE = 'syncCampaign';

/**
 * Poll Meta and Google for ad approval transitions.
 *
 * Neither platform exposes a webhook for approval changes in third-party ad
 * accounts (see docs/limitations.md), so polling is the only option here. The
 * cadence has to match REFRESH_INTERVAL_MINUTES in the route it calls.
 */
export const syncAdApprovals = onSchedule(
  { schedule: '*/15 * * * *', region: REGION, timeoutSeconds: 540 },
  async () => {
    const result = await callBackend('/api/cron/sync-ad-approvals');
    logger.info('Ad approvals synced', { result });
  }
);

/**
 * Safety net for campaigns whose enqueue never happened or ran out of retries.
 *
 * The main path is the queue below, which fires within seconds of the assets
 * landing. This sweep only exists to catch what that path dropped, so it runs
 * hourly rather than often.
 */
export const sweepPendingCampaigns = onSchedule(
  { schedule: '0 * * * *', region: REGION, timeoutSeconds: 540 },
  async () => {
    const result = await callBackend('/api/cron/sync-pending-campaigns');
    logger.info('Pending campaigns swept', { result });
  }
);

/**
 * Enqueue a campaign sync the moment an ad's images land.
 *
 * A campaign sits in PENDING_ASSETS until its ads carry at least one image
 * (areGoogleImageAssetsReady). That condition is written by our own asset
 * pipeline, so there is nothing to poll for: the write itself is the signal.
 *
 * Only the empty -> non-empty transition is interesting. Later edits to an
 * already-populated ad must not re-enqueue.
 */
export const onAdAssetsReady = onDocumentWritten(
  { document: 'ads/{adId}', region: REGION },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!becameAssetReady(before, after)) return;

    const campaignId = after?.campaignId as string | undefined;
    if (!campaignId) return;

    // Only campaigns still waiting on assets are worth dispatching; the queue
    // consumer re-checks this too, since the status can change in between.
    const campaign = await getFirestore().collection('campaigns').doc(campaignId).get();
    if (campaign.data()?.status !== 'PENDING_ASSETS') return;

    // No second argument: it is the queue's *scope*, not its region — passing a
    // region string silently selects the deprecated extension-id overload and
    // every enqueue 404s. The region comes from where syncCampaign is deployed.
    await getFunctions().taskQueue(SYNC_CAMPAIGN_QUEUE).enqueue({ campaignId });
    logger.info('Enqueued campaign sync', { campaignId, adId: event.params.adId });
  }
);

/**
 * Sync one campaign whose assets are ready.
 *
 * Retries are the point of routing this through a queue: a platform outage
 * backs off and comes back on its own instead of waiting for the next sweep,
 * and one failing campaign never blocks another.
 */
export const syncCampaign = onTaskDispatched(
  {
    region: REGION,
    retryConfig: { maxAttempts: 5, minBackoffSeconds: 30, maxDoublings: 3 },
    rateLimits: { maxConcurrentDispatches: 6 },
    timeoutSeconds: 540,
  },
  async (request) => {
    const { campaignId } = request.data as { campaignId?: string };
    if (!campaignId) {
      logger.error('Task dispatched without a campaignId');
      return;
    }

    const result = await callBackend('/api/internal/sync-campaign', {
      method: 'POST',
      body: { campaignId },
    });
    logger.info('Campaign sync dispatched', { campaignId, result });
  }
);
