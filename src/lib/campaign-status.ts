/**
 * Campaign Status Normalization
 *
 * Normalizes both MetaEntityStatus and GoogleEntityStatus to a common display format.
 */

export type NormalizedStatus = {
  label: string;
  color: 'success' | 'warning' | 'error' | 'info' | 'default';
};

/**
 * Normalize Meta campaign status to display format
 */
export function normalizeMetaStatus(status: string): NormalizedStatus {
  switch (status) {
    case 'ACTIVE':
      return { label: 'Active', color: 'success' };
    case 'PAUSED':
      return { label: 'Paused', color: 'warning' };
    case 'DRAFT':
      return { label: 'Draft', color: 'default' };
    case 'PENDING':
      return { label: 'Pending', color: 'info' };
    case 'PENDING_ASSETS':
      return { label: 'Preparing media', color: 'info' };
    case 'ERROR':
      return { label: 'Error', color: 'error' };
    case 'ARCHIVED':
      return { label: 'Archived', color: 'default' };
    default:
      return { label: status, color: 'default' };
  }
}

/**
 * Normalize Google campaign status to display format
 */
export function normalizeGoogleStatus(status: string | null): NormalizedStatus {
  switch (status) {
    case 'ENABLED':
      return { label: 'Active', color: 'success' };
    case 'PAUSED':
      return { label: 'Paused', color: 'warning' };
    case 'DRAFT':
      return { label: 'Draft', color: 'default' };
    case 'PENDING':
      return { label: 'Pending', color: 'info' };
    case 'ERROR':
      return { label: 'Error', color: 'error' };
    case 'REMOVED':
      return { label: 'Removed', color: 'default' };
    default:
      return { label: status || 'Unknown', color: 'default' };
  }
}

/**
 * Get the effective status for a campaign based on its platforms
 */
export function getCampaignDisplayStatus(
  platforms: string[],
  metaStatus: string,
  googleEntityStatus: string | null
): NormalizedStatus {
  // If only Google platform and has Google status, use it
  if (platforms.length === 1 && platforms[0] === 'GOOGLE' && googleEntityStatus) {
    return normalizeGoogleStatus(googleEntityStatus);
  }
  return normalizeMetaStatus(metaStatus);
}

/**
 * Get the platform display label
 */
export function getPlatformLabel(platform: string): string {
  switch (platform) {
    case 'META':
      return 'Meta';
    case 'GOOGLE':
      return 'YouTube';
    default:
      return platform;
  }
}

/**
 * Operational status = "is the campaign running on the platform?"
 * Approval status  = "have the ads been approved by the platform?"
 *
 * These are two independent axes. A campaign can be ENABLED (operationally
 * running) while individual ads inside are DISAPPROVED (not being shown).
 */
export function getOperationalStatus(
  platforms: string[],
  metaStatus: string,
  googleEntityStatus: string | null
): NormalizedStatus {
  return getCampaignDisplayStatus(platforms, metaStatus, googleEntityStatus);
}

export type DualStatus = {
  operational: NormalizedStatus;
  approval: NormalizedStatus | null;
};

/**
 * YouTube ad format display labels
 */
export function getYouTubeAdFormatLabel(format: string | null): string {
  switch (format) {
    case 'IN_STREAM_SKIPPABLE':
      return 'In-Stream (Skippable)';
    case 'IN_STREAM_NON_SKIPPABLE':
      return 'In-Stream (Non-skippable)';
    case 'IN_FEED':
      return 'In-Feed';
    case 'BUMPER':
      return 'Bumper (6s)';
    case 'SHORTS':
      return 'Shorts';
    default:
      return format || 'Not defined';
  }
}
