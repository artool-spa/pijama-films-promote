/**
 * Normalize approval status (platform review state) for display.
 * Approval status is orthogonal to operational status:
 *   - Operational: is the entity RUNNING? (ACTIVE, PAUSED, ...)
 *   - Approval: is the entity APPROVED by the platform? (APPROVED, DISAPPROVED, ...)
 */

import type { NormalizedStatus } from '@/lib/campaign-status';

export type AdApprovalStatus =
  | 'UNKNOWN'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'APPROVED_LIMITED'
  | 'DISAPPROVED'
  | 'APPEALED';

export type ApprovalSummary =
  | 'ALL_APPROVED'
  | 'SOME_PENDING'
  | 'SOME_DISAPPROVED'
  | 'ALL_DISAPPROVED'
  | 'UNKNOWN';

export function normalizeApprovalStatus(status: AdApprovalStatus): NormalizedStatus {
  switch (status) {
    case 'APPROVED':
      return { label: 'Approved', color: 'success' };
    case 'APPROVED_LIMITED':
      return { label: 'Approved (limited)', color: 'warning' };
    case 'PENDING_REVIEW':
      return { label: 'Under review', color: 'info' };
    case 'DISAPPROVED':
      return { label: 'Rejected', color: 'error' };
    case 'APPEALED':
      return { label: 'Appeal submitted', color: 'info' };
    case 'UNKNOWN':
    default:
      return { label: 'Not reviewed yet', color: 'default' };
  }
}

export function normalizeApprovalSummary(summary: ApprovalSummary | null): NormalizedStatus {
  switch (summary) {
    case 'ALL_APPROVED':
      return { label: 'All ads approved', color: 'success' };
    case 'SOME_PENDING':
      return { label: 'Some ads under review', color: 'info' };
    case 'SOME_DISAPPROVED':
      return { label: 'Some ads rejected', color: 'warning' };
    case 'ALL_DISAPPROVED':
      return { label: 'All ads rejected', color: 'error' };
    case 'UNKNOWN':
    case null:
    default:
      return { label: 'Ads not reviewed yet', color: 'default' };
  }
}

/**
 * Aggregate an array of ad approval statuses into a single summary value.
 * Pure — no I/O.
 */
export function computeCampaignApprovalSummary(statuses: AdApprovalStatus[]): ApprovalSummary {
  if (statuses.length === 0) return 'UNKNOWN';
  if (statuses.every((s) => s === 'UNKNOWN')) return 'UNKNOWN';
  if (statuses.every((s) => s === 'DISAPPROVED')) return 'ALL_DISAPPROVED';
  if (statuses.some((s) => s === 'DISAPPROVED')) return 'SOME_DISAPPROVED';
  if (statuses.some((s) => s === 'PENDING_REVIEW' || s === 'UNKNOWN')) return 'SOME_PENDING';
  return 'ALL_APPROVED';
}

export function countByApproval(statuses: AdApprovalStatus[]) {
  const counts = {
    approved: 0,
    approvedLimited: 0,
    pending: 0,
    disapproved: 0,
    appealed: 0,
    unknown: 0,
    total: statuses.length,
  };
  for (const s of statuses) {
    switch (s) {
      case 'APPROVED':
        counts.approved++;
        break;
      case 'APPROVED_LIMITED':
        counts.approvedLimited++;
        break;
      case 'PENDING_REVIEW':
        counts.pending++;
        break;
      case 'DISAPPROVED':
        counts.disapproved++;
        break;
      case 'APPEALED':
        counts.appealed++;
        break;
      default:
        counts.unknown++;
    }
  }
  return counts;
}
