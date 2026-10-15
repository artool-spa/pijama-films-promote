import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { getAdById, updateAdApproval, type AdApprovalStatusValue } from '@/models/ad';
import { recomputeApprovalSummary } from '@/models/campaign';
import { getPartnerFromRequest, canManageCampaign } from '@/lib/auth';
import { meta, getAdApprovalStatus, type MetaAdApprovalRaw } from '#meta';
import { describeMetaPolicyIssue } from '@/lib/campaigns/error-messages';

type RouteParams = { params: Promise<{ id: string }> };

function metaStatusToApproval(raw: MetaAdApprovalRaw): AdApprovalStatusValue {
  const effective = raw.effective_status?.toUpperCase() ?? '';
  if (effective === 'DISAPPROVED') return 'DISAPPROVED';
  if (effective === 'PENDING_REVIEW' || effective === 'IN_PROCESS') return 'PENDING_REVIEW';
  if (effective === 'WITH_ISSUES') return 'APPROVED_LIMITED';
  if (effective === 'PREAPPROVED' || effective === 'ACTIVE') return 'APPROVED';
  if (raw.issues_info && raw.issues_info.length > 0) return 'APPROVED_LIMITED';
  return 'UNKNOWN';
}

/**
 * GET /api/meta/ads/[id]/approval
 * On-demand refresh of the ad's Meta review state.
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
    if (!ad || !canManageCampaign(partner, ad.campaign.partnerId).allowed || !ad.metaAdId) {
      return NextResponse.json({ error: 'Ad is not synced to Meta' }, { status: 404 });
    }

    const raw = await getAdApprovalStatus(meta, ad.metaAdId);
    const status = metaStatusToApproval(raw);
    const primaryIssue = raw.issues_info?.[0];
    const desc = primaryIssue ? describeMetaPolicyIssue(primaryIssue) : null;

    const updated = await updateAdApproval(id, {
      approvalStatus: status,
      rejectionReason:
        (status === 'DISAPPROVED' || status === 'APPROVED_LIMITED') && desc ? desc.reason : null,
      suggestedCorrection:
        (status === 'DISAPPROVED' || status === 'APPROVED_LIMITED') && desc
          ? desc.suggestions.join(' • ')
          : null,
      rejectionDetails: {
        platform: 'META',
        rawEffectiveStatus: raw.effective_status,
        policyTopics: (raw.issues_info ?? []).map((i) => describeMetaPolicyIssue(i)),
        receivedAt: new Date().toISOString(),
      },
    });

    await recomputeApprovalSummary(ad.campaignId).catch((err) =>
      logger.warn({ err, campaignId: ad.campaignId }, 'Failed to recompute approvalSummary')
    );

    return NextResponse.json({ ad: updated });
  } catch (error) {
    logger.error({ err: error }, 'Meta approval refresh failed');
    return NextResponse.json({ error: 'Approval refresh failed' }, { status: 500 });
  }
}
