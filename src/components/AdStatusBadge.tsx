'use client';

import { Box, Chip, Tooltip } from '@mui/material';
import type { NormalizedStatus } from '@/lib/campaign-status';
import { normalizeMetaStatus } from '@/lib/campaign-status';
import { normalizeApprovalStatus, type AdApprovalStatus } from '@/lib/campaigns/approval-status';

export type AdStatusBadgeProps = {
  operationalStatus: string;
  approvalStatus: AdApprovalStatus;
  size?: 'small' | 'medium';
  onOpenDetails?: () => void;
};

/**
 * Dual-chip badge for ads. Left chip is operational state (Active/Paused/…),
 * right chip is platform approval state (Approved/Rejected/Under review/…).
 *
 * These are two independent axes — see docs/limitations.md.
 */
export default function AdStatusBadge({
  operationalStatus,
  approvalStatus,
  size = 'small',
  onOpenDetails,
}: AdStatusBadgeProps) {
  const op: NormalizedStatus = normalizeMetaStatus(operationalStatus);
  const approval = normalizeApprovalStatus(approvalStatus);

  const isClickable = Boolean(onOpenDetails);
  const approvalChipStyle = isClickable
    ? { cursor: 'pointer' }
    : undefined;

  return (
    <Box sx={{ display: 'inline-flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
      <Tooltip title="Operational status (is the ad set to run on the platform?)">
        <Chip label={op.label} color={op.color} size={size} variant="filled" />
      </Tooltip>
      <Tooltip
        title={
          isClickable
            ? 'Click for review details and correction suggestions'
            : 'Platform review status'
        }
      >
        <Chip
          label={approval.label}
          color={approval.color}
          size={size}
          variant="outlined"
          onClick={onOpenDetails}
          sx={approvalChipStyle}
        />
      </Tooltip>
    </Box>
  );
}
