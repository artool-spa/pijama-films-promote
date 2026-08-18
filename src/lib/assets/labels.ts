/**
 * Labels for asset status and UI elements
 */

import type { AssetStatus } from '@/lib/assets/status';

// Asset status labels
export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  PENDING: 'Pending',
  VALIDATING: 'Validating...',
  READY: 'Ready',
  INVALID: 'Invalid',
  ERROR: 'Error',
};

// Status chip colors for MUI
export const ASSET_STATUS_COLORS: Record<AssetStatus, 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'> = {
  PENDING: 'default',
  VALIDATING: 'info',
  READY: 'success',
  INVALID: 'warning',
  ERROR: 'error',
};

// Platform eligibility labels
export const PLATFORM_LABELS = {
  facebook: 'Facebook',
  instagram: 'Instagram',
} as const;

// Filter options labels
export const FILTER_LABELS = {
  all: 'All',
  promotable: 'Promotable',
  ready: 'Ready',
  validating: 'Validating',
  invalid: 'Invalid',
} as const;

// Error messages
export const VALIDATION_ERROR_MESSAGES = {
  widthTooSmall: 'Width too small',
  heightTooSmall: 'Height too small',
  aspectRatioInvalid: 'Invalid aspect ratio',
  durationTooShort: 'Duration too short',
  durationTooLong: 'Duration too long',
  fileTooLarge: 'File too large',
  unknownError: 'Unknown error',
} as const;

// Helper function to get status label
export function getStatusLabel(status: AssetStatus): string {
  return ASSET_STATUS_LABELS[status] || status;
}

// Helper function to get status color
export function getStatusColor(status: AssetStatus): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' {
  return ASSET_STATUS_COLORS[status] || 'default';
}
