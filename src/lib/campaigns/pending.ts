import { createLogger } from '@/lib/logger';
import type { CampaignWithPartnerAndAds } from '@/models/campaign';

import {
  areGoogleImageAssetsReady,
  syncCampaignToMeta,
  syncCampaignToGoogle,
} from './sync';

const log = createLogger('pending-campaigns');

export interface PendingSyncResult {
  /** Whether at least one platform accepted the campaign. */
  synced: boolean;
  /** Whether the campaign is still waiting on its assets. */
  stillPending: boolean;
  errors: Array<{ campaignId: string; error: string }>;
}

/**
 * Complete the platform sync for a single campaign stuck in PENDING_ASSETS.
 *
 * Shared by the Cloud Tasks entry point (one campaign, dispatched the moment
 * its assets land) and the scheduled sweep (every pending campaign, as a net
 * for enqueues that never happened). Keeping both on this function is what
 * stops the two paths from drifting apart.
 *
 * Never throws: platform failures are collected so one campaign cannot abort a
 * sweep, and so the queue can decide whether to retry from the result.
 */
export async function syncPendingCampaign(
  campaign: CampaignWithPartnerAndAds
): Promise<PendingSyncResult> {
  const hasMeta = campaign.platforms.includes('META');
  const hasGoogle = campaign.platforms.includes('GOOGLE');

  // Meta is never gated: syncCampaignToMeta uploads the videos itself. Only
  // Google needs an image already present on the ad.
  const googleReady = !hasGoogle || areGoogleImageAssetsReady(campaign.ads);
  if (!googleReady) {
    return { synced: false, stillPending: true, errors: [] };
  }

  const partnerName = campaign.partner.name;
  const errors: PendingSyncResult['errors'] = [];
  let synced = false;

  if (hasMeta && !campaign.metaCampaignId) {
    try {
      const result = await syncCampaignToMeta(campaign, partnerName);
      if (result.synced) {
        synced = true;
      } else if (result.syncError) {
        errors.push({ campaignId: campaign.id, error: `Meta: ${result.syncError}` });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown Meta sync error';
      log.error({ err: error, campaignId: campaign.id }, 'Meta sync failed for campaign');
      errors.push({ campaignId: campaign.id, error: `Meta: ${msg}` });
    }
  }

  if (hasGoogle && !campaign.googleCampaignId) {
    try {
      const result = await syncCampaignToGoogle(campaign, partnerName);
      if (result.synced) {
        synced = true;
      } else if (result.syncError) {
        errors.push({ campaignId: campaign.id, error: `Google: ${result.syncError}` });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown Google sync error';
      log.error({ err: error, campaignId: campaign.id }, 'Google sync failed for campaign');
      errors.push({ campaignId: campaign.id, error: `Google: ${msg}` });
    }
  }

  return { synced, stillPending: false, errors };
}
