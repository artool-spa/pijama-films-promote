import {
  MetaApiError,
  MetaAuthError,
  MetaRateLimitError,
  MetaConfigError,
  MetaValidationError,
} from '@/lib/meta/errors';
import {
  GoogleAdsApiError,
  GoogleAdsAuthError,
  GoogleAdsQuotaError,
  GoogleAdsConfigError,
} from '@/lib/google/errors';

export type CampaignPlatform = 'Meta' | 'Google';

/**
 * Known Meta Ads API error codes mapped to friendly, actionable English guidance.
 * Meta's own error_user_msg is preferred when present; these cover the common cases
 * where Meta's raw text is cryptic or absent.
 */
const META_CODE_MESSAGES: Record<number, string> = {
  190: 'The connection to Meta has expired. Please contact Pijama Films support to reconnect the ad account, then try again.',
  100: 'Meta rejected one of the campaign settings. Please check your targeting, budget, dates, and links, then try again.',
  200: 'The Meta ad account does not have permission to create this campaign. Please contact Pijama Films support.',
  368: 'Meta blocked this ad for policy reasons. Please review your images, text, and destination link, then try again.',
  1487079: "Your budget is below Meta's minimum for this campaign. Please increase the budget and try again.",
  1487006: "Your budget is below Meta's minimum for this campaign. Please increase the budget and try again.",
  1487225: 'The campaign schedule is invalid for Meta. Please check the start and end dates and try again.',
};

/**
 * Known Google Ads gRPC status codes (GoogleAdsApiError.errorCode) mapped to
 * friendly English guidance.
 */
const GOOGLE_STATUS_MESSAGES: Record<string, string> = {
  PERMISSION_DENIED: 'The Google Ads account is missing permissions for this campaign. Please contact Pijama Films support, then try again.',
  UNAUTHENTICATED: 'The connection to Google Ads has expired. Please contact Pijama Films support to reconnect, then try again.',
  RESOURCE_EXHAUSTED: 'Google Ads is temporarily limiting requests. Please wait a few minutes and try again.',
  INVALID_ARGUMENT: 'Google rejected one of the campaign settings. Please check your targeting, budget, images, and links, then try again.',
};

/**
 * Extract Meta's user-facing message from the raw API response body, if present.
 * MetaApiError.response holds the raw body: { error: { error_user_msg, error_user_title, message } }
 */
function metaUserMessage(err: MetaApiError): string | undefined {
  const body = err.response as
    | { error?: { error_user_msg?: string; error_user_title?: string } }
    | undefined;
  const msg = body?.error?.error_user_msg;
  const title = body?.error?.error_user_title;
  if (!msg) return undefined;
  return title ? `${title}: ${msg}` : msg;
}

/**
 * Convert any error thrown during campaign sync into a friendly, actionable,
 * ENGLISH message. The message is returned WITHOUT a platform prefix — callers
 * add exactly one "Meta: " / "Google: " prefix at the display layer, which
 * prevents double-prefixing like "Meta: Meta: ...".
 */
export function toFriendlyCampaignError(error: unknown, platform: CampaignPlatform): string {
  // --- Meta ---
  if (error instanceof MetaConfigError) {
    return 'Meta advertising is not configured on this server yet. Your campaign was saved as a draft — please contact support.';
  }
  if (error instanceof MetaAuthError) {
    return META_CODE_MESSAGES[190];
  }
  if (error instanceof MetaRateLimitError) {
    return 'Meta is temporarily limiting requests. Please wait a few minutes and try again.';
  }
  if (error instanceof MetaApiError) {
    if (error.errorCode && META_CODE_MESSAGES[error.errorCode]) {
      return META_CODE_MESSAGES[error.errorCode];
    }
    return (
      metaUserMessage(error) ??
      "We couldn't create your campaign on Meta. Please review your settings and try again, or contact support if it keeps happening."
    );
  }
  if (error instanceof MetaValidationError) {
    return 'Meta returned an unexpected response while creating your campaign. Please try again, or contact support.';
  }

  // --- Google ---
  if (error instanceof GoogleAdsConfigError) {
    return 'Google Ads is not configured on this server yet. Your campaign was saved as a draft — please contact support.';
  }
  if (error instanceof GoogleAdsAuthError) {
    return GOOGLE_STATUS_MESSAGES.UNAUTHENTICATED;
  }
  if (error instanceof GoogleAdsQuotaError) {
    return GOOGLE_STATUS_MESSAGES.RESOURCE_EXHAUSTED;
  }
  if (error instanceof GoogleAdsApiError) {
    const raw = `${error.errorCode ?? ''} ${error.message}`.toUpperCase();
    if (raw.includes('BUDGET')) {
      return "Your budget is below Google Ads' minimum for this campaign, or the budget is invalid. Please adjust it and try again.";
    }
    if (raw.includes('BID')) {
      return 'The bidding settings were rejected by Google Ads. Please try again, or contact support.';
    }
    if (error.errorCode && GOOGLE_STATUS_MESSAGES[error.errorCode]) {
      return GOOGLE_STATUS_MESSAGES[error.errorCode];
    }
    return "We couldn't create your campaign on Google Ads. Please review your settings and try again, or contact support if it keeps happening.";
  }

  // --- Unknown ---
  const platformName = platform === 'Meta' ? 'Meta' : 'Google Ads';
  return `Something went wrong while creating your campaign on ${platformName}. Please try again, or contact support if it keeps happening.`;
}
