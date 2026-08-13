'use client';

import { Alert, AlertTitle, Button } from '@mui/material';
import type { ApprovalSummary } from '@/lib/campaigns/approval-status';

export type ApprovalWarningBannerProps = {
  approvalSummary: ApprovalSummary | null;
  disapprovedCount: number;
  onReviewRejected?: () => void;
};

/**
 * Contextual banner that clarifies when a campaign is operationally active but
 * has ads that are rejected. Prevents the confusion where a user sees metrics
 * on a "not approved" campaign.
 */
export default function ApprovalWarningBanner({
  approvalSummary,
  disapprovedCount,
  onReviewRejected,
}: ApprovalWarningBannerProps) {
  if (approvalSummary === 'ALL_DISAPPROVED') {
    return (
      <Alert
        severity="error"
        sx={{ mb: 2 }}
        action={
          onReviewRejected ? (
            <Button color="inherit" size="small" onClick={onReviewRejected}>
              Review rejected ads
            </Button>
          ) : undefined
        }
      >
        <AlertTitle>All ads rejected</AlertTitle>
        The campaign is operationally active, but every ad was rejected by the platform and is not
        being shown to real users right now. Any metrics below reflect historical delivery, not
        current traffic. Fix the ads to resume delivery.
      </Alert>
    );
  }

  if (approvalSummary === 'SOME_DISAPPROVED') {
    return (
      <Alert
        severity="warning"
        sx={{ mb: 2 }}
        action={
          onReviewRejected ? (
            <Button color="inherit" size="small" onClick={onReviewRejected}>
              Review rejected ads
            </Button>
          ) : undefined
        }
      >
        <AlertTitle>{disapprovedCount} ad(s) rejected</AlertTitle>
        Your campaign is delivering approved ads, but {disapprovedCount} ad(s) were rejected and are
        not being shown. Fix them to include them in delivery.
      </Alert>
    );
  }

  return null;
}
