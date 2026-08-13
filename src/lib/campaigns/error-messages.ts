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
 * Structured error description used by the UI to render actionable messages.
 */
export type FriendlyErrorDescription = {
  title: string;
  body: string;
  suggestions: string[];
  retryable: boolean;
};

type CodeMessage = FriendlyErrorDescription;

const META_CODE_MESSAGES: Record<number, CodeMessage> = {
  190: {
    title: 'Meta connection expired',
    body:
      'The connection to Meta has expired. Please contact Pijama Films support to reconnect the ad account, then try again.',
    suggestions: ['Contact Pijama Films support'],
    retryable: false,
  },
  100: {
    title: 'Meta rejected campaign settings',
    body:
      'Meta rejected one of the campaign settings. Please check your targeting, budget, dates, and links, then try again.',
    suggestions: [
      'Verify that countries, ages, and genders are valid',
      "Confirm the budget is above Meta's minimum",
      'Check that destination URLs are reachable',
    ],
    retryable: true,
  },
  200: {
    title: 'Missing Meta permissions',
    body:
      'The Meta ad account does not have permission to create this campaign. Please contact Pijama Films support.',
    suggestions: ['Contact Pijama Films support'],
    retryable: false,
  },
  368: {
    title: 'Ad blocked for policy reasons',
    body:
      'Meta blocked this ad for policy reasons. Please review your images, text, and destination link, then try again.',
    suggestions: [
      "Review images and videos against Meta's content policies",
      'Reduce text overlay on images (max 20%)',
      'Remove exaggerated claims or sensitive words',
    ],
    retryable: true,
  },
  1487079: {
    title: 'Budget below minimum',
    body: "Your budget is below Meta's minimum for this campaign. Please increase the budget and try again.",
    suggestions: ['Increase the daily or lifetime budget'],
    retryable: true,
  },
  1487006: {
    title: 'Budget below minimum',
    body: "Your budget is below Meta's minimum for this campaign. Please increase the budget and try again.",
    suggestions: ['Increase the daily or lifetime budget'],
    retryable: true,
  },
  1487225: {
    title: 'Invalid schedule',
    body: 'The campaign schedule is invalid for Meta. Please check the start and end dates and try again.',
    suggestions: ['Ensure the start date is in the future', 'Confirm the end date is after the start date'],
    retryable: true,
  },
};

const GOOGLE_STATUS_MESSAGES: Record<string, CodeMessage> = {
  PERMISSION_DENIED: {
    title: 'Missing Google Ads permissions',
    body:
      'The Google Ads account is missing permissions for this campaign. Please contact Pijama Films support, then try again.',
    suggestions: ['Contact Pijama Films support'],
    retryable: false,
  },
  UNAUTHENTICATED: {
    title: 'Google Ads connection expired',
    body:
      'The connection to Google Ads has expired. Please contact Pijama Films support to reconnect, then try again.',
    suggestions: ['Contact Pijama Films support'],
    retryable: false,
  },
  RESOURCE_EXHAUSTED: {
    title: 'Google Ads is limiting requests',
    body: 'Google Ads is temporarily limiting requests. Please wait a few minutes and try again.',
    suggestions: ['Wait 5-10 minutes before retrying'],
    retryable: true,
  },
  INVALID_ARGUMENT: {
    title: 'Google rejected campaign settings',
    body:
      'Google rejected one of the campaign settings. Please check your targeting, budget, images, and links, then try again.',
    suggestions: [
      'Verify images meet required formats',
      'Confirm the budget is valid',
      'Check that destination URLs are reachable',
    ],
    retryable: true,
  },
};

/**
 * Extract Meta's user-facing message from the raw API response body.
 */
function metaUserMessage(err: MetaApiError): { title?: string; msg: string } | undefined {
  const body = err.response as
    | { error?: { error_user_msg?: string; error_user_title?: string } }
    | undefined;
  const msg = body?.error?.error_user_msg;
  const title = body?.error?.error_user_title;
  if (!msg) return undefined;
  return { title, msg };
}

/**
 * Structured description of an error thrown during campaign sync.
 */
export function describeCampaignError(
  error: unknown,
  platform: CampaignPlatform
): FriendlyErrorDescription {
  if (error instanceof MetaConfigError) {
    return {
      title: 'Meta not configured',
      body:
        'Meta advertising is not configured on this server yet. Your campaign was saved as a draft — please contact support.',
      suggestions: ['Contact Pijama Films support'],
      retryable: false,
    };
  }
  if (error instanceof MetaAuthError) return META_CODE_MESSAGES[190];
  if (error instanceof MetaRateLimitError) {
    return {
      title: 'Meta is limiting requests',
      body: 'Meta is temporarily limiting requests. Please wait a few minutes and try again.',
      suggestions: ['Wait 5-10 minutes before retrying'],
      retryable: true,
    };
  }
  if (error instanceof MetaApiError) {
    if (error.errorCode && META_CODE_MESSAGES[error.errorCode]) {
      return META_CODE_MESSAGES[error.errorCode];
    }
    const userMsg = metaUserMessage(error);
    if (userMsg) {
      return {
        title: userMsg.title ?? 'Meta rejected the campaign',
        body: userMsg.title ? `${userMsg.title}: ${userMsg.msg}` : userMsg.msg,
        suggestions: [],
        retryable: true,
      };
    }
    return {
      title: "We couldn't create your campaign on Meta",
      body:
        "We couldn't create your campaign on Meta. Please review your settings and try again, or contact support if it keeps happening.",
      suggestions: ['Review targeting and creatives', 'Contact support if it keeps happening'],
      retryable: true,
    };
  }
  if (error instanceof MetaValidationError) {
    return {
      title: 'Unexpected response from Meta',
      body: 'Meta returned an unexpected response while creating your campaign. Please try again, or contact support.',
      suggestions: [],
      retryable: true,
    };
  }

  if (error instanceof GoogleAdsConfigError) {
    return {
      title: 'Google Ads not configured',
      body:
        'Google Ads is not configured on this server yet. Your campaign was saved as a draft — please contact support.',
      suggestions: ['Contact Pijama Films support'],
      retryable: false,
    };
  }
  if (error instanceof GoogleAdsAuthError) return GOOGLE_STATUS_MESSAGES.UNAUTHENTICATED;
  if (error instanceof GoogleAdsQuotaError) return GOOGLE_STATUS_MESSAGES.RESOURCE_EXHAUSTED;
  if (error instanceof GoogleAdsApiError) {
    const raw = `${error.errorCode ?? ''} ${error.message}`.toUpperCase();
    if (raw.includes('BUDGET')) {
      return {
        title: 'Google budget rejected',
        body:
          "Your budget is below Google Ads' minimum for this campaign, or the budget is invalid. Please adjust it and try again.",
        suggestions: ['Increase the campaign budget'],
        retryable: true,
      };
    }
    if (raw.includes('BID')) {
      return {
        title: 'Bidding settings rejected',
        body: 'The bidding settings were rejected by Google Ads. Please try again, or contact support.',
        suggestions: ['Contact support if it keeps happening'],
        retryable: true,
      };
    }
    if (error.errorCode && GOOGLE_STATUS_MESSAGES[error.errorCode]) {
      return GOOGLE_STATUS_MESSAGES[error.errorCode];
    }
    return {
      title: "We couldn't create your campaign on Google Ads",
      body:
        "We couldn't create your campaign on Google Ads. Please review your settings and try again, or contact support if it keeps happening.",
      suggestions: ['Review targeting and creatives', 'Contact support if it keeps happening'],
      retryable: true,
    };
  }

  const platformName = platform === 'Meta' ? 'Meta' : 'Google Ads';
  return {
    title: `Unexpected error on ${platformName}`,
    body: `Something went wrong while creating your campaign on ${platformName}. Please try again, or contact support if it keeps happening.`,
    suggestions: ['Contact support if it keeps happening'],
    retryable: true,
  };
}

/**
 * Backwards-compatible string form. Returns the description body without
 * a platform prefix — callers add exactly one "Meta: " / "Google: " prefix
 * at the display layer.
 */
export function toFriendlyCampaignError(error: unknown, platform: CampaignPlatform): string {
  return describeCampaignError(error, platform).body;
}

// ============================================================================
// PLATFORM POLICY DESCRIPTIONS (used by the review-details dialog)
// ============================================================================

export type PolicyDescription = {
  title: string;
  reason: string;
  suggestions: string[];
  helpUrl?: string;
};

type MetaIssueInfo = {
  level?: string;
  error_code?: number;
  error_message?: string;
  error_summary?: string;
  error_type?: string;
};

/**
 * Convert a single Meta `issues_info` entry to an English human description.
 */
export function describeMetaPolicyIssue(issue: MetaIssueInfo): PolicyDescription {
  const code = issue.error_code;
  if (code && META_CODE_MESSAGES[code]) {
    const preset = META_CODE_MESSAGES[code];
    return {
      title: preset.title,
      reason: issue.error_summary || issue.error_message || preset.body,
      suggestions: preset.suggestions,
    };
  }
  return {
    title: issue.error_summary || 'Meta policy issue',
    reason:
      issue.error_message ||
      "Meta rejected the ad but didn't provide a detailed reason. Review Meta's advertising policies.",
    suggestions: [
      "Review images and videos against Meta's content policies",
      'Adjust text to avoid sensitive claims',
      'Confirm the destination link complies with policies',
    ],
  };
}

type GooglePolicyTopicEntry = {
  topic?: string;
  type?: string;
  evidences?: unknown[];
  constraints?: unknown[];
};

const GOOGLE_TOPIC_TRANSLATIONS: Record<string, { title: string; suggestions: string[] }> = {
  DESTINATION_NOT_WORKING: {
    title: 'Destination URL not working',
    suggestions: ['Verify the URL opens correctly', 'Remove excessive redirects'],
  },
  UNACCEPTABLE_CONTENT: {
    title: 'Unacceptable content',
    suggestions: ["Review Google Ads content policies", 'Adjust images or text'],
  },
  TRADEMARKS_IN_AD_TEXT: {
    title: 'Trademarks in ad text',
    suggestions: ['Remove trademarks from headlines and descriptions'],
  },
  ADULT_ORIENTED: {
    title: 'Adult content',
    suggestions: ['Adjust images/videos to avoid sensitive content'],
  },
  MISLEADING_CONTENT: {
    title: 'Misleading content',
    suggestions: ['Remove exaggerated claims', 'Be clear about what you offer'],
  },
};

export function describeGooglePolicyTopic(entry: GooglePolicyTopicEntry): PolicyDescription {
  const topic = entry.topic ?? 'POLICY_TOPIC_UNKNOWN';
  const preset = GOOGLE_TOPIC_TRANSLATIONS[topic];
  if (preset) {
    return {
      title: preset.title,
      reason: `Google flagged your ad for "${topic}".`,
      suggestions: preset.suggestions,
      helpUrl: 'https://support.google.com/adspolicy/answer/6008942',
    };
  }
  return {
    title: `Google policy: ${topic}`,
    reason: `Google flagged your ad for a policy issue ("${topic}").`,
    suggestions: [
      'Review Google Ads policies',
      'Adjust images, text, or destination as needed',
    ],
    helpUrl: 'https://support.google.com/adspolicy/answer/6008942',
  };
}
