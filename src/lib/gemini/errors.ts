/**
 * Base error class for Gemini API errors
 */
export class GeminiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiError';
  }
}

/**
 * Error thrown when Gemini configuration is invalid or missing
 */
export class GeminiConfigError extends GeminiError {
  public readonly missingVars: string[];

  constructor(message: string, missingVars: string[] = []) {
    super(message);
    this.name = 'GeminiConfigError';
    this.missingVars = missingVars;
  }
}

/**
 * Error thrown when a Gemini API request fails
 */
export class GeminiApiError extends GeminiError {
  public readonly statusCode?: number;
  public readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      context?: Record<string, unknown>;
    }
  ) {
    super(message);
    this.name = 'GeminiApiError';
    this.statusCode = options?.statusCode;
    this.context = options?.context;
  }
}

/**
 * Error thrown when response parsing/validation fails
 */
export class GeminiValidationError extends GeminiError {
  public readonly errors: unknown;

  constructor(message: string, errors?: unknown) {
    super(message);
    this.name = 'GeminiValidationError';
    this.errors = errors;
  }
}
