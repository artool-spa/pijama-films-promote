import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { getAdById, updateAdApproval, type AdApprovalStatusValue } from '@/models/ad';
import { recomputeApprovalSummary } from '@/models/campaign';
import { getPartnerFromRequest, canManageCampaign } from '@/lib/auth';
import { google, getAdApprovalStatuses, type GoogleAdApprovalRaw } from '#google';
import { describeGooglePolicyTopic } from '@/lib/campaigns/error-messages';

type RouteParams = { params: Promise<{ id: string }> };

function googleStatusToApproval(raw: GoogleAdApprovalRaw): AdApprovalStatusValue {
  const approvalStatus = (raw.approvalStatus || '').toUpperCase();
  if (approvalStatus === 'DISAPPROVED') return 'DISAPPROVED';
  if (approvalStatus === 'AREA_OF_INTEREST_ONLY' || approvalStatus === 'APPROVED_LIMITED') return 'APPROVED_LIMITED';
  if (approvalStatus === 'APPROVED') return 'APPROVED';
  const reviewStatus = (raw.reviewStatus || '').toUpperCase();
  if (reviewStatus === 'REVIEW_IN_PROGRESS' || reviewStatus === 'UNDER_REVIEW') return 'PENDING_REVIEW';
  return 'UNKNOWN';
}

/**
 * GET /api/google/ads/[id]/approval
 * On-demand refresh of the ad's Google Ads review state.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const ad = await getAdById(id);
    // 404 (not 403) for someone else's ad: do not reveal that it exists.
    if (!ad || !canManageCampaign(partner, ad.campaign.partnerId).allowed || !ad.googleAdId) {
      return NextResponse.json({ error: 'Ad is not synced to Google' }, { status: 404 });
    }

    const [raw] = await getAdApprovalStatuses(google, [ad.googleAdId]);
    if (!raw) {
      return NextResponse.json({ error: 'No approval data returned by Google' }, { status: 502 });
    }

    const status = googleStatusToApproval(raw);
    const primaryTopic = raw.policyTopicEntries?.[0];
    const desc = primaryTopic ? describeGooglePolicyTopic(primaryTopic) : null;

    const updated = await updateAdApproval(id, {
      approvalStatus: status,
      rejectionReason:
        (status === 'DISAPPROVED' || status === 'APPROVED_LIMITED') && desc ? desc.reason : null,
      suggestedCorrection:
        (status === 'DISAPPROVED' || status === 'APPROVED_LIMITED') && desc
          ? desc.suggestions.join(' • ')
          : null,
      rejectionDetails: {
        platform: 'GOOGLE',
        rawApprovalStatus: raw.approvalStatus,
        rawReviewStatus: raw.reviewStatus,
        policyTopics: (raw.policyTopicEntries ?? []).map((t) => describeGooglePolicyTopic(t)),
        receivedAt: new Date().toISOString(),
      },
    });

    await recomputeApprovalSummary(ad.campaignId).catch((err) =>
      logger.warn({ err, campaignId: ad.campaignId }, 'Failed to recompute approvalSummary')
    );

    return NextResponse.json({ ad: updated });
  } catch (error) {
    logger.error({ err: error }, 'Google approval refresh failed');
    return NextResponse.json({ error: 'Approval refresh failed' }, { status: 500 });
  }
}
