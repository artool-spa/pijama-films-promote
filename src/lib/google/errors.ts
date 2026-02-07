/**
 * Base error class for Google Ads API errors
 */
export class GoogleAdsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleAdsError';
  }
}

/**
 * Error thrown when Google Ads configuration is invalid or missing
 */
export class GoogleAdsConfigError extends GoogleAdsError {
  public readonly missingVars: string[];

  constructor(message: string, missingVars: string[] = []) {
    super(message);
    this.name = 'GoogleAdsConfigError';
    this.missingVars = missingVars;
  }
}

/**
 * Error thrown when authentication fails (e.g., invalid/expired token)
 */
export class GoogleAdsAuthError extends GoogleAdsError {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'GoogleAdsAuthError';
    this.statusCode = statusCode;
  }
}

/**
 * Error thrown when an API request fails
 */
export class GoogleAdsApiError extends GoogleAdsError {
  public readonly statusCode?: number;
  public readonly endpoint?: string;
  public readonly errorCode?: string;
  public readonly response?: unknown;

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      endpoint?: string;
      errorCode?: string;
      response?: unknown;
    }
  ) {
    super(message);
    this.name = 'GoogleAdsApiError';
    this.statusCode = options?.statusCode;
    this.endpoint = options?.endpoint;
    this.errorCode = options?.errorCode;
    this.response = options?.response;
  }
}

/**
 * Error thrown when quota is exceeded
 */
export class GoogleAdsQuotaError extends GoogleAdsError {
  public readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number) {
    super(message);
    this.name = 'GoogleAdsQuotaError';
    this.retryAfter = retryAfter;
  }
}
