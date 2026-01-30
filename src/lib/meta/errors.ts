/**
 * Base error class for Meta Ads API errors
 */
export class MetaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaError';
  }
}

/**
 * Error thrown when Meta configuration is invalid or missing
 */
export class MetaConfigError extends MetaError {
  public readonly missingVars: string[];

  constructor(message: string, missingVars: string[] = []) {
    super(message);
    this.name = 'MetaConfigError';
    this.missingVars = missingVars;
  }
}

/**
 * Error thrown when authentication fails (e.g., invalid/expired token)
 */
export class MetaAuthError extends MetaError {
  public readonly statusCode?: number;
  public readonly errorCode?: number;

  constructor(message: string, statusCode?: number, errorCode?: number) {
    super(message);
    this.name = 'MetaAuthError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

/**
 * Error thrown when an API request fails
 */
export class MetaApiError extends MetaError {
  public readonly statusCode?: number;
  public readonly endpoint?: string;
  public readonly errorCode?: number;
  public readonly errorSubcode?: number;
  public readonly response?: unknown;

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      endpoint?: string;
      errorCode?: number;
      errorSubcode?: number;
      response?: unknown;
    }
  ) {
    super(message);
    this.name = 'MetaApiError';
    this.statusCode = options?.statusCode;
    this.endpoint = options?.endpoint;
    this.errorCode = options?.errorCode;
    this.errorSubcode = options?.errorSubcode;
    this.response = options?.response;
  }
}

/**
 * Error thrown when response validation fails
 */
export class MetaValidationError extends MetaError {
  public readonly errors: unknown;

  constructor(message: string, errors?: unknown) {
    super(message);
    this.name = 'MetaValidationError';
    this.errors = errors;
  }
}

/**
 * Error thrown when rate limit is exceeded
 */
export class MetaRateLimitError extends MetaError {
  public readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number) {
    super(message);
    this.name = 'MetaRateLimitError';
    this.retryAfter = retryAfter;
  }
}
