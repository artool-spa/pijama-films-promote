import { Storage, Bucket } from '@google-cloud/storage';
import { randomUUID } from 'crypto';
import logger from '@/lib/logger';
import {
  StorageConfig,
  StorageConfigSchema,
  FileInput,
  StorageMetadata,
  ImageUploadOptions,
  VideoUploadOptions,
  STORAGE_FOLDERS,
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_VIDEO_MIME_TYPES,
  MAX_IMAGE_SIZE,
  MAX_VIDEO_SIZE,
  MIME_TO_EXTENSION,
} from './types';
import {
  StorageConfigError,
  StorageValidationError,
  StorageUploadError,
  StorageDeleteError,
  StorageNotFoundError,
} from './errors';

/**
 * StorageClient manages file uploads to Google Cloud Storage.
 */
export class StorageClient {
  private readonly config: StorageConfig;
  private readonly storage: Storage;
  private readonly bucket: Bucket;

  constructor(config: StorageConfig) {
    // Validate configuration
    const result = StorageConfigSchema.safeParse(config);
    if (!result.success) {
      const missingVars = result.error.issues.map((issue) => issue.path.join('.'));
      throw new StorageConfigError(
        `Invalid storage configuration: ${result.error.message}`,
        missingVars
      );
    }
    this.config = result.data;

    // Application Default Credentials: the runtime service account on App
    // Hosting, `gcloud auth application-default login` locally. No static key
    // is accepted, so there is none to leak or rotate.
    this.storage = new Storage();
    this.bucket = this.storage.bucket(this.config.bucketName);
  }

  /**
   * Upload an image file
   */
  async uploadImage(
    file: FileInput,
    options: ImageUploadOptions = {}
  ): Promise<StorageMetadata> {
    // Validate MIME type
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimeType as typeof ALLOWED_IMAGE_MIME_TYPES[number])) {
      throw new StorageValidationError(
        `Invalid image type: ${file.mimeType}. Allowed types: ${ALLOWED_IMAGE_MIME_TYPES.join(', ')}`,
        { field: 'mimeType', constraint: 'allowedTypes' }
      );
    }

    // Validate file size
    if (file.buffer.length > MAX_IMAGE_SIZE) {
      throw new StorageValidationError(
        `Image size exceeds maximum of ${MAX_IMAGE_SIZE / (1024 * 1024)}MB`,
        { field: 'size', constraint: 'maxSize' }
      );
    }

    const folder = options.folder || STORAGE_FOLDERS.IMAGES;
    return this.uploadFile(file, folder, options.filename);
  }

  /**
   * Upload a video file
   */
  async uploadVideo(
    file: FileInput,
    options: VideoUploadOptions = {}
  ): Promise<StorageMetadata> {
    // Validate MIME type
    if (!ALLOWED_VIDEO_MIME_TYPES.includes(file.mimeType as typeof ALLOWED_VIDEO_MIME_TYPES[number])) {
      throw new StorageValidationError(
        `Invalid video type: ${file.mimeType}. Allowed types: ${ALLOWED_VIDEO_MIME_TYPES.join(', ')}`,
        { field: 'mimeType', constraint: 'allowedTypes' }
      );
    }

    // Validate file size
    if (file.buffer.length > MAX_VIDEO_SIZE) {
      throw new StorageValidationError(
        `Video size exceeds maximum of ${MAX_VIDEO_SIZE / (1024 * 1024)}MB`,
        { field: 'size', constraint: 'maxSize' }
      );
    }

    const folder = options.folder || STORAGE_FOLDERS.VIDEOS;
    return this.uploadFile(file, folder, options.filename);
  }

  /**
   * Delete a file from storage
   */
  async deleteFile(storageKey: string): Promise<void> {
    try {
      const file = this.bucket.file(storageKey);
      const [exists] = await file.exists();

      if (!exists) {
        throw new StorageNotFoundError(
          `File not found: ${storageKey}`,
          storageKey
        );
      }

      await file.delete();
    } catch (error) {
      if (error instanceof StorageNotFoundError) {
        throw error;
      }
      throw new StorageDeleteError(
        `Failed to delete file: ${storageKey}`,
        { storageKey, cause: error instanceof Error ? error : undefined }
      );
    }
  }

  /**
   * Get the public URL for a file
   */
  getPublicUrl(storageKey: string): string {
    if (this.config.publicUrlBase) {
      return `${this.config.publicUrlBase}/${storageKey}`;
    }
    return `https://storage.googleapis.com/${this.config.bucketName}/${storageKey}`;
  }

  /**
   * Check if a file exists
   */
  async fileExists(storageKey: string): Promise<boolean> {
    const file = this.bucket.file(storageKey);
    const [exists] = await file.exists();
    return exists;
  }

  /**
   * Internal method to upload a file
   */
  private async uploadFile(
    file: FileInput,
    folder: string,
    customFilename?: string
  ): Promise<StorageMetadata> {
    const extension = MIME_TO_EXTENSION[file.mimeType] || 'bin';
    const filename = customFilename || `${randomUUID()}.${extension}`;
    const storageKey = `${folder}/${filename}`;

    try {
      const gcsFile = this.bucket.file(storageKey);

      // No per-object ACL: the bucket uses uniform bucket-level access and
      // grants allUsers read at the bucket level, which is what makes the
      // creatives fetchable by Meta and Google. Passing `public: true` here
      // would try to write an object ACL and be rejected.
      await gcsFile.save(file.buffer, {
        contentType: file.mimeType,
        metadata: {
          cacheControl: 'public, max-age=31536000',
        },
      });

      return {
        storageKey,
        publicUrl: this.getPublicUrl(storageKey),
        bucket: this.config.bucketName,
        size: file.buffer.length,
        mimeType: file.mimeType,
        uploadedAt: new Date(),
      };
    } catch (error) {
      // Log the full error for debugging
      logger.error({ err: error, storageKey }, 'Upload failed');

      // Handle both Error instances and other types
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);

      throw new StorageUploadError(
        `Failed to upload file: ${storageKey} - ${errorMessage}`,
        { storageKey, cause: error instanceof Error ? error : undefined }
      );
    }
  }
}
