/**
 * Base error class for Muvi API errors
 */
export class MuviError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MuviError';
  }
}

/**
 * Error thrown when Muvi configuration is invalid or missing
 */
export class MuviConfigError extends MuviError {
  public readonly missingVars: string[];

  constructor(message: string, missingVars: string[] = []) {
    super(message);
    this.name = 'MuviConfigError';
    this.missingVars = missingVars;
  }
}

/**
 * Error thrown when authentication fails
 */
export class MuviAuthError extends MuviError {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'MuviAuthError';
    this.statusCode = statusCode;
  }
}

/**
 * Error thrown when an API request fails
 */
export class MuviApiError extends MuviError {
  public readonly statusCode?: number;
  public readonly endpoint?: string;
  public readonly response?: unknown;

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      endpoint?: string;
      response?: unknown;
    }
  ) {
    super(message);
    this.name = 'MuviApiError';
    this.statusCode = options?.statusCode;
    this.endpoint = options?.endpoint;
    this.response = options?.response;
  }
}

/**
 * Error thrown when response validation fails
 */
export class MuviValidationError extends MuviError {
  public readonly errors: unknown;

  constructor(message: string, errors?: unknown) {
    super(message);
    this.name = 'MuviValidationError';
    this.errors = errors;
  }
}
