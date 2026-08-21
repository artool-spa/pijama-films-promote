/**
 * Produce a human, English explanation of the current campaign state.
 * Consumed by CampaignStatusCard to render an actionable Alert.
 */

import type { ApprovalSummary } from './approval-status';

export type CampaignStateInput = {
  status: 'DRAFT' | 'PENDING_ASSETS' | 'SYNCING' | 'PENDING' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'ERROR';
  googleEntityStatus: 'DRAFT' | 'PENDING' | 'ENABLED' | 'PAUSED' | 'REMOVED' | 'ERROR' | null;
  approvalSummary: ApprovalSummary | null;
  disapprovedAdCount: number;
  lastSyncError: string | null;
  lastSyncErrorAt: Date | null;
  syncedAt: Date | null;
  endDate: Date | null;
  platforms: string[];
};

export type CampaignStateExplanation = {
  title: string;
  description: string;
  tone: 'info' | 'success' | 'warning' | 'error';
  actions: Array<{ label: string; href?: string; onClickKey?: string }>;
};

export function explainCampaignState(input: CampaignStateInput): CampaignStateExplanation {
  if (input.status === 'ERROR') {
    return {
      title: 'Sync failed',
      description:
        input.lastSyncError ||
        "We couldn't sync this campaign to Meta/Google. Review the settings and retry.",
      tone: 'error',
      actions: [{ label: 'Retry sync', onClickKey: 'retry-sync' }],
    };
  }

  if (input.status === 'DRAFT') {
    return {
      title: 'Draft',
      description: 'This campaign has not been submitted yet.',
      tone: 'info',
      actions: [{ label: 'Continue editing', onClickKey: 'continue-draft' }],
    };
  }

  if (input.status === 'PENDING_ASSETS') {
    return {
      title: 'Preparing media',
      description: 'We are preparing the images and videos for your campaign. This usually takes 5-15 minutes.',
      tone: 'info',
      actions: [],
    };
  }

  if (input.status === 'SYNCING') {
    return {
      title: 'Publishing',
      description:
        'We are creating your ads on the platform. Nothing is under review yet — this usually takes under a minute.',
      tone: 'info',
      actions: [],
    };
  }

  if (input.status === 'PENDING') {
    return {
      title: 'Awaiting platform review',
      description:
        'Your campaign was submitted to Meta/Google. They are reviewing the ads — this usually takes less than 24 hours.',
      tone: 'info',
      actions: [],
    };
  }

  if (input.status === 'PAUSED') {
    return {
      title: 'Paused',
      description: 'This campaign is paused. Resume it to start delivering ads again.',
      tone: 'warning',
      actions: [{ label: 'Resume', onClickKey: 'resume-campaign' }],
    };
  }

  if (input.status === 'ARCHIVED') {
    return {
      title: 'Archived',
      description: 'This campaign is archived and no longer running.',
      tone: 'info',
      actions: [],
    };
  }

  // ACTIVE — refine by approval summary
  if (input.approvalSummary === 'ALL_DISAPPROVED') {
    return {
      title: 'All ads rejected',
      description:
        'Your campaign is operationally active, but every ad was rejected by the platform. No ads are being shown to real users right now. Fix the ads to resume delivery.',
      tone: 'error',
      actions: [{ label: 'Review rejected ads', onClickKey: 'review-ads' }],
    };
  }

  if (input.approvalSummary === 'SOME_DISAPPROVED') {
    return {
      title: 'Some ads rejected',
      description: `Your campaign is active, but ${input.disapprovedAdCount} ad(s) were rejected. Fix them to include them in delivery.`,
      tone: 'warning',
      actions: [{ label: 'Review rejected ads', onClickKey: 'review-ads' }],
    };
  }

  if (input.approvalSummary === 'SOME_PENDING') {
    return {
      title: 'Active — some ads still under review',
      description: 'Your campaign is delivering approved ads while the rest finish review.',
      tone: 'info',
      actions: [],
    };
  }

  return {
    title: 'Active',
    description: 'Your campaign is running and delivering ads.',
    tone: 'success',
    actions: [],
  };
}
