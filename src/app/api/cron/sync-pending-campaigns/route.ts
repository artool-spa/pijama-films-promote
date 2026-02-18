import { NextRequest, NextResponse } from 'next/server';
import { getCampaignsPendingAssets } from '@/models/campaign';
import { areMetaAssetsReady, areGoogleImageAssetsReady, syncCampaignToMeta, syncCampaignToGoogle } from '@/lib/campaigns/sync';

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
    console.error('[Cron] CRON_SECRET not configured');
    return NextResponse.json({ error: 'Cron not configured' }, { status: 500 });
  }

  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
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
      const metaReady = !hasMeta || areMetaAssetsReady(campaign.ads);
      const googleReady = !hasGoogle || areGoogleImageAssetsReady(campaign.ads);

      if (!metaReady || !googleReady) {
        stillPendingCount++;
        continue;
      }

      // Assets are ready — sync to platforms
      const partnerName = campaign.partner.name;
      let synced = false;

      if (hasMeta) {
        try {
          const result = await syncCampaignToMeta(campaign, partnerName);
          if (result.synced) {
            synced = true;
          } else if (result.syncError) {
            errors.push({ campaignId: campaign.id, error: `Meta: ${result.syncError}` });
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown Meta sync error';
          console.error(`[Cron] Meta sync failed for campaign ${campaign.id}:`, error);
          errors.push({ campaignId: campaign.id, error: `Meta: ${msg}` });
        }
      }

      if (hasGoogle) {
        try {
          const result = await syncCampaignToGoogle(campaign, partnerName);
          if (result.synced) {
            synced = true;
          } else if (result.syncError) {
            errors.push({ campaignId: campaign.id, error: `Google: ${result.syncError}` });
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown Google sync error';
          console.error(`[Cron] Google sync failed for campaign ${campaign.id}:`, error);
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
    console.error('[Cron] Error processing pending campaigns:', error);
    return NextResponse.json(
      { error: 'Error processing pending campaigns' },
      { status: 500 }
    );
  }
}
