import { z } from 'zod';

// Storage folders
export const STORAGE_FOLDERS = {
  IMAGES: 'images',
  VIDEOS: 'videos',
} as const;

export type StorageFolder = (typeof STORAGE_FOLDERS)[keyof typeof STORAGE_FOLDERS];

// Allowed MIME types
export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

export const ALLOWED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
] as const;

export type ImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];
export type VideoMimeType = (typeof ALLOWED_VIDEO_MIME_TYPES)[number];

// File size limits (in bytes)
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500 MB

// MIME type to file extension mapping
export const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-msvideo': 'avi',
};

// Configuration schema
export const StorageConfigSchema = z.object({
  bucketName: z.string().min(1, 'GCS_BUCKET_NAME is required'),
  serviceAccountKeyPath: z.string().optional(),
  serviceAccountKeyJson: z.string().optional(),
  publicUrlBase: z.string().url().optional(),
});
// No credential field is required: with neither set, the client falls back to
// Application Default Credentials, which is how it authenticates on App
// Hosting (the runtime service account). An explicit key is only for local use.

export type StorageConfig = z.infer<typeof StorageConfigSchema>;

// File input for uploads
export interface FileInput {
  buffer: Buffer;
  mimeType: string;
  originalName?: string;
}

// Metadata returned after upload
export interface StorageMetadata {
  storageKey: string;
  publicUrl: string;
  bucket: string;
  size: number;
  mimeType: string;
  uploadedAt: Date;
}

// Upload options
export interface ImageUploadOptions {
  folder?: string;
  filename?: string;
}

export interface VideoUploadOptions {
  folder?: string;
  filename?: string;
}
