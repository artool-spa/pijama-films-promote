/**
 * Pijama API Error Classes
 */

/**
 * Base error class for all Pijama-related errors
 */
export class PijamaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PijamaError';
  }
}

/**
 * Error for configuration issues (missing env vars, etc.)
 */
export class PijamaConfigError extends PijamaError {
  constructor(
    message: string,
    public readonly missingVars: string[] = []
  ) {
    super(message);
    this.name = 'PijamaConfigError';
  }
}

/**
 * Error for authentication failures
 */
export class PijamaAuthError extends PijamaError {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'PijamaAuthError';
  }
}

/**
 * Error for API request failures
 */
export class PijamaApiError extends PijamaError {
  constructor(
    message: string,
    public readonly options?: {
      statusCode?: number;
      endpoint?: string;
      errorCode?: string;
      response?: unknown;
    }
  ) {
    super(message);
    this.name = 'PijamaApiError';
  }

  get statusCode(): number | undefined {
    return this.options?.statusCode;
  }

  get endpoint(): string | undefined {
    return this.options?.endpoint;
  }

  get errorCode(): string | undefined {
    return this.options?.errorCode;
  }
}
