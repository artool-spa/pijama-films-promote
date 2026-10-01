import { NextRequest, NextResponse } from 'next/server';
import { authorizeInternalRequest } from '@/lib/auth';
import logger from '@/lib/logger';
import {
  getAdsNeedingApprovalRefresh,
  markApprovalCheckAttempted,
  updateAdApproval,
} from '@/models/ad';
import { recomputeApprovalSummary, getCampaignById } from '@/models/campaign';
import { meta, getAdApprovalStatus, type MetaAdApprovalRaw } from '#meta';
import { google, getAdApprovalStatuses, type GoogleAdApprovalRaw } from '#google';
import { describeMetaPolicyIssue, describeGooglePolicyTopic } from '@/lib/campaigns/error-messages';
import { publish } from '@/lib/events';
import type { AdApprovalStatusValue } from '@/models/ad';

// The scheduler fires every 15 minutes and this is the staleness threshold for
// picking ads, so the two have to match: leaving it at 30 would refresh each ad
// every ~30-45 minutes, not the 15 the UI promises the producer.
const REFRESH_INTERVAL_MINUTES = 15;
const META_BATCH_SIZE = 50;
const GOOGLE_BATCH_SIZE = 50;

function metaStatusToApproval(raw: MetaAdApprovalRaw): AdApprovalStatusValue {
  const effective = raw.effective_status?.toUpperCase() ?? '';
  if (effective === 'DISAPPROVED') return 'DISAPPROVED';
  if (effective === 'PENDING_REVIEW' || effective === 'IN_PROCESS') return 'PENDING_REVIEW';
  if (effective === 'WITH_ISSUES') return 'APPROVED_LIMITED';
  if (effective === 'PREAPPROVED' || effective === 'ACTIVE') return 'APPROVED';
  if (raw.issues_info && raw.issues_info.length > 0) return 'APPROVED_LIMITED';
  return 'UNKNOWN';
}

function googleStatusToApproval(raw: GoogleAdApprovalRaw): AdApprovalStatusValue {
  const approvalStatus = (raw.approvalStatus || '').toUpperCase();
  if (approvalStatus === 'DISAPPROVED') return 'DISAPPROVED';
  if (approvalStatus === 'AREA_OF_INTEREST_ONLY' || approvalStatus === 'APPROVED_LIMITED') return 'APPROVED_LIMITED';
  if (approvalStatus === 'APPROVED') return 'APPROVED';

  const reviewStatus = (raw.reviewStatus || '').toUpperCase();
  if (reviewStatus === 'REVIEW_IN_PROGRESS' || reviewStatus === 'UNDER_REVIEW') return 'PENDING_REVIEW';
  return 'UNKNOWN';
}

function summarizeMetaIssues(raw: MetaAdApprovalRaw): {
  reason: string | null;
  suggestion: string | null;
  details: Record<string, unknown>;
} {
  if (!raw.issues_info || raw.issues_info.length === 0) {
    return { reason: null, suggestion: null, details: { platform: 'META', receivedAt: new Date().toISOString() } };
  }
  const primary = raw.issues_info[0];
  const desc = describeMetaPolicyIssue(primary);
  return {
    reason: desc.reason,
    suggestion: desc.suggestions.length > 0 ? desc.suggestions.join(' • ') : null,
    details: {
      platform: 'META',
      code: primary.error_code,
      rawUserMsg: primary.error_message,
      policyTopics: raw.issues_info.map((i) => describeMetaPolicyIssue(i)),
      recommendations: raw.recommendations ?? [],
      receivedAt: new Date().toISOString(),
    },
  };
}

function summarizeGoogleIssues(raw: GoogleAdApprovalRaw): {
  reason: string | null;
  suggestion: string | null;
  details: Record<string, unknown>;
} {
  if (!raw.policyTopicEntries || raw.policyTopicEntries.length === 0) {
    return { reason: null, suggestion: null, details: { platform: 'GOOGLE', receivedAt: new Date().toISOString() } };
  }
  const primary = raw.policyTopicEntries[0];
  const desc = describeGooglePolicyTopic(primary);
  return {
    reason: desc.reason,
    suggestion: desc.suggestions.length > 0 ? desc.suggestions.join(' • ') : null,
    details: {
      platform: 'GOOGLE',
      policyTopics: raw.policyTopicEntries.map((entry) => describeGooglePolicyTopic(entry)),
      receivedAt: new Date().toISOString(),
    },
  };
}

/**
 * GET /api/cron/sync-ad-approvals
 *
 * Polls Meta/Google for each synced ad's review/approval status and persists
 * the result to Ad.approvalStatus, Ad.rejectionReason, etc. Then recomputes
 * Campaign.approvalSummary.
 *
 * Protected by CRON_SECRET header check.
 */
export async function GET(req: NextRequest) {
  if (!(await authorizeInternalRequest(req.headers.get('authorization')))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const errors: Array<{ adId: string; platform: 'META' | 'GOOGLE'; error: string }> = [];
  const affectedCampaigns = new Set<string>();
  let metaProcessed = 0;
  let googleProcessed = 0;

  try {
    const { metaAds, googleAds } = await getAdsNeedingApprovalRefresh({
      olderThanMinutes: REFRESH_INTERVAL_MINUTES,
      metaLimit: META_BATCH_SIZE,
      googleLimit: GOOGLE_BATCH_SIZE,
    });

    // --- Meta pass ---
    for (const ad of metaAds) {
      if (!ad.metaAdId) continue;
      try {
        const raw = await getAdApprovalStatus(meta, ad.metaAdId);
        const status = metaStatusToApproval(raw);
        const { reason, suggestion, details } = summarizeMetaIssues(raw);
        await updateAdApproval(ad.id, {
          approvalStatus: status,
          rejectionReason: status === 'DISAPPROVED' || status === 'APPROVED_LIMITED' ? reason : null,
          suggestedCorrection: status === 'DISAPPROVED' || status === 'APPROVED_LIMITED' ? suggestion : null,
          rejectionDetails: details,
        });
        affectedCampaigns.add(ad.campaignId);
        metaProcessed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown Meta error';
        logger.warn({ err, adId: ad.id }, 'Meta approval refresh failed');
        errors.push({ adId: ad.id, platform: 'META', error: msg });
        // Record the attempt so a permanently failing ad rotates to the back of
        // the queue instead of holding one of the 50 slots on every run. See
        // markApprovalCheckAttempted.
        await markApprovalCheckAttempted(ad.id).catch((bumpErr) => {
          logger.warn({ err: bumpErr, adId: ad.id }, 'Could not record the failed attempt');
        });
      }
    }

    // --- Google pass (batch query) ---
    if (googleAds.length > 0) {
      const resourceToAdId = new Map<string, { adId: string; campaignId: string; partnerId: string }>();
      const resourceNames: string[] = [];
      for (const ad of googleAds) {
        if (!ad.googleAdId) continue;
        resourceToAdId.set(ad.googleAdId, {
          adId: ad.id,
          campaignId: ad.campaignId,
          partnerId: ad.campaign.partnerId,
        });
        resourceNames.push(ad.googleAdId);
      }
      try {
        const results = await getAdApprovalStatuses(google, resourceNames);
        const answered = new Set<string>();
        for (const raw of results) {
          const info = resourceToAdId.get(raw.resourceName);
          if (!info) continue;
          answered.add(raw.resourceName);
          const status = googleStatusToApproval(raw);
          const { reason, suggestion, details } = summarizeGoogleIssues(raw);
          await updateAdApproval(info.adId, {
            approvalStatus: status,
            rejectionReason: status === 'DISAPPROVED' || status === 'APPROVED_LIMITED' ? reason : null,
            suggestedCorrection: status === 'DISAPPROVED' || status === 'APPROVED_LIMITED' ? suggestion : null,
            rejectionDetails: details,
          });
          affectedCampaigns.add(info.campaignId);
          googleProcessed++;
        }

        /**
         * Google answers this as ONE query, so an id it does not recognise is
         * not an error — it is simply a row that never comes back. The request
         * returns 200, `results` is short, and nothing in this route noticed.
         *
         * That silence is exactly what an ad account change produces: the query
         * goes to the new customer while the stored resource names still name
         * the old one, so EVERY row is missing and the run reports success
         * having done nothing. Warn, and record the attempt on each unanswered
         * ad so they do not hold the batch forever.
         */
        const unanswered = resourceNames.filter((name) => !answered.has(name));
        if (unanswered.length > 0) {
          logger.warn(
            { requested: resourceNames.length, answered: answered.size, missing: unanswered.length },
            'Google returned no status for some ads — check that the stored resource ' +
              'names belong to the customer the current credentials point at'
          );
          for (const name of unanswered) {
            const info = resourceToAdId.get(name);
            if (!info) continue;
            await markApprovalCheckAttempted(info.adId).catch((bumpErr) => {
              logger.warn({ err: bumpErr, adId: info.adId }, 'Could not record the failed attempt');
            });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown Google error';
        logger.warn({ err }, 'Google approval batch refresh failed');
        for (const ad of googleAds) {
          errors.push({ adId: ad.id, platform: 'GOOGLE', error: msg });
          await markApprovalCheckAttempted(ad.id).catch((bumpErr) => {
            logger.warn({ err: bumpErr, adId: ad.id }, 'Could not record the failed attempt');
          });
        }
      }
    }

    // Recompute campaign rollups + emit realtime events
    for (const campaignId of affectedCampaigns) {
      try {
        await recomputeApprovalSummary(campaignId);

        // Events are keyed by film, not by campaign - look up the owning film
        // so open UIs actually receive this.
        const campaign = await getCampaignById(campaignId);
        if (campaign) {
          await publish(campaign.filmMuviUuid, {
            type: 'ad_approval_changed',
            campaignId,
          });
        }
      } catch (err) {
        logger.warn({ err, campaignId }, 'Failed to recompute approvalSummary');
      }
    }

    return NextResponse.json({
      metaProcessed,
      googleProcessed,
      affectedCampaigns: affectedCampaigns.size,
      errors,
    });
  } catch (error) {
    logger.error({ err: error }, 'sync-ad-approvals cron failed');
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
