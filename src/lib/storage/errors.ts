/**
 * Base error class for storage operations
 */
export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

/**
 * Error thrown when storage configuration is invalid or missing
 */
export class StorageConfigError extends StorageError {
  public readonly missingVars: string[];

  constructor(message: string, missingVars: string[] = []) {
    super(message);
    this.name = 'StorageConfigError';
    this.missingVars = missingVars;
  }
}

/**
 * Error thrown when file validation fails (type, size, etc.)
 */
export class StorageValidationError extends StorageError {
  public readonly field?: string;
  public readonly constraint?: string;

  constructor(
    message: string,
    options?: { field?: string; constraint?: string }
  ) {
    super(message);
    this.name = 'StorageValidationError';
    this.field = options?.field;
    this.constraint = options?.constraint;
  }
}

/**
 * Error thrown when upload operation fails
 */
export class StorageUploadError extends StorageError {
  public readonly storageKey?: string;
  public readonly cause?: Error;

  constructor(message: string, options?: { storageKey?: string; cause?: Error }) {
    super(message);
    this.name = 'StorageUploadError';
    this.storageKey = options?.storageKey;
    this.cause = options?.cause;
  }
}

/**
 * Error thrown when delete operation fails
 */
export class StorageDeleteError extends StorageError {
  public readonly storageKey?: string;
  public readonly cause?: Error;

  constructor(message: string, options?: { storageKey?: string; cause?: Error }) {
    super(message);
    this.name = 'StorageDeleteError';
    this.storageKey = options?.storageKey;
    this.cause = options?.cause;
  }
}

/**
 * Error thrown when a file is not found
 */
export class StorageNotFoundError extends StorageError {
  public readonly storageKey: string;

  constructor(message: string, storageKey: string) {
    super(message);
    this.name = 'StorageNotFoundError';
    this.storageKey = storageKey;
  }
}
