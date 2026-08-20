import { StorageClient } from './client';
import { StorageConfigError } from './errors';
import type { FileInput, ImageUploadOptions, VideoUploadOptions, StorageMetadata } from './types';

// Declare global type for singleton pattern (prevents multiple instances in dev)
const globalForStorage = global as unknown as { storage: StorageClient | undefined };

/**
 * Create and validate storage configuration from environment variables
 */
function createStorageConfig() {
  const bucketName = process.env.GCS_BUCKET_NAME;
  const publicUrlBase = process.env.GCS_PUBLIC_URL_BASE;

  // Credentials come from Application Default Credentials, so only the bucket
  // has to be configured.
  if (!bucketName) {
    throw new StorageConfigError(
      'Missing required GCS environment variable: GCS_BUCKET_NAME. ' +
        'Please configure it in your .env file.',
      ['GCS_BUCKET_NAME']
    );
  }

  return { bucketName, publicUrlBase };
}

/**
 * Get or create the storage singleton instance.
 * Throws StorageConfigError if required environment variables are missing.
 */
export function getStorageClient(): StorageClient {
  if (globalForStorage.storage) {
    return globalForStorage.storage;
  }

  const config = createStorageConfig();
  const client = new StorageClient(config);

  if (process.env.NODE_ENV !== 'production') {
    globalForStorage.storage = client;
  }

  return client;
}

/**
 * Lazy-initialized storage client getter.
 * Use this to avoid build-time errors when env vars are not set.
 */
export const storage = {
  get client(): StorageClient {
    return getStorageClient();
  },
};

// Convenience functions
export async function uploadImage(
  file: FileInput,
  options?: ImageUploadOptions
): Promise<StorageMetadata> {
  return getStorageClient().uploadImage(file, options);
}

export async function uploadVideo(
  file: FileInput,
  options?: VideoUploadOptions
): Promise<StorageMetadata> {
  return getStorageClient().uploadVideo(file, options);
}

export async function deleteFile(storageKey: string): Promise<void> {
  return getStorageClient().deleteFile(storageKey);
}

export function getPublicUrl(storageKey: string): string {
  return getStorageClient().getPublicUrl(storageKey);
}

export async function fileExists(storageKey: string): Promise<boolean> {
  return getStorageClient().fileExists(storageKey);
}

// Re-export types for consumers
export type {
  StorageConfig,
  FileInput,
  StorageMetadata,
  ImageUploadOptions,
  VideoUploadOptions,
  StorageFolder,
  ImageMimeType,
  VideoMimeType,
} from './types';

export {
  STORAGE_FOLDERS,
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_VIDEO_MIME_TYPES,
  MAX_IMAGE_SIZE,
  MAX_VIDEO_SIZE,
  MIME_TO_EXTENSION,
} from './types';

// Re-export error classes
export {
  StorageError,
  StorageConfigError,
  StorageValidationError,
  StorageUploadError,
  StorageDeleteError,
  StorageNotFoundError,
} from './errors';

// Re-export the client class for advanced usage
export { StorageClient } from './client';
