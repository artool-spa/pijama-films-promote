import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { getCampaignsPendingAssets } from '@/models/campaign';
import { areGoogleImageAssetsReady, syncCampaignToMeta, syncCampaignToGoogle } from '@/lib/campaigns/sync';

/**
 * GET /api/cron/sync-pending-campaigns
 *
 * Cron endpoint that processes campaigns with PENDING_ASSETS status.
 * Checks if their video assets are now ready and completes the platform sync.
 *
 * Protected by CRON_SECRET header check.
 */
export async function GET(req: NextRequest) {
  // Authenticate with shared secret
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logger.error('CRON_SECRET not configured');
    return NextResponse.json({ error: 'Cron not configured' }, { status: 500 });
  }

  const authHeader = req.headers.get('authorization');
  
  if (authHeader !== `Bearer ${cronSecret}`) {
    logger.error({ authHeader }, 'Wrong sync token' );
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const pendingCampaigns = await getCampaignsPendingAssets();

    if (pendingCampaigns.length === 0) {
      return NextResponse.json({
        processed: 0,
        synced: 0,
        stillPending: 0,
        errors: [],
      });
    }

    let syncedCount = 0;
    let stillPendingCount = 0;
    const errors: Array<{ campaignId: string; error: string }> = [];

    for (const campaign of pendingCampaigns) {
      const hasMeta = campaign.platforms.includes('META');
      const hasGoogle = campaign.platforms.includes('GOOGLE');

      // Check if assets are ready for each platform
      // Meta: syncCampaignToMeta handles video uploads internally, no need to gate on metaVideoId
      const metaReady = true;
      const googleReady = !hasGoogle || areGoogleImageAssetsReady(campaign.ads);

      if (!metaReady || !googleReady) {
        stillPendingCount++;
        continue;
      }

      // Assets are ready — sync to platforms (skip already-synced platforms)
      const partnerName = campaign.partner.name;
      let synced = false;
      const metaAlreadySynced = !!campaign.metaCampaignId;
      const googleAlreadySynced = !!campaign.googleCampaignId;

      if (hasMeta && !metaAlreadySynced) {
        try {
          const result = await syncCampaignToMeta(campaign, partnerName);
          if (result.synced) {
            synced = true;
          } else if (result.syncError) {
            errors.push({ campaignId: campaign.id, error: `Meta: ${result.syncError}` });
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown Meta sync error';
          logger.error({ err: error, campaignId: campaign.id }, 'Meta sync failed for campaign');
          errors.push({ campaignId: campaign.id, error: `Meta: ${msg}` });
        }
      }

      if (hasGoogle && !googleAlreadySynced) {
        try {
          const result = await syncCampaignToGoogle(campaign, partnerName);
          if (result.synced) {
            synced = true;
          } else if (result.syncError) {
            errors.push({ campaignId: campaign.id, error: `Google: ${result.syncError}` });
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown Google sync error';
          logger.error({ err: error, campaignId: campaign.id }, 'Google sync failed for campaign');
          errors.push({ campaignId: campaign.id, error: `Google: ${msg}` });
        }
      }

      if (synced) {
        syncedCount++;
      }
    }

    return NextResponse.json({
      processed: pendingCampaigns.length,
      synced: syncedCount,
      stillPending: stillPendingCount,
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
