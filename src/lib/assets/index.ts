import { randomUUID } from 'crypto';
import { broadcaster } from '@/lib/events';
import { uploadImage, uploadVideo } from '@/lib/storage';
import {
  createImage,
  getImageByOriginalUrl,
  type Image,
} from '@/models/image';
import {
  createVideo,
  getVideoByOriginalUrl,
  setMetaVideoId,
  type Video,
} from '@/models/video';
import { meta, uploadAdVideo } from '#meta';

/**
 * MIME type mappings for common file extensions
 */
const EXTENSION_MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.webm': 'video/webm',
  '.m3u8': 'application/x-mpegURL',
};

/**
 * Get MIME type from URL file extension
 */
function getMimeFromExtension(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.substring(pathname.lastIndexOf('.')).toLowerCase();
    return EXTENSION_MIME_MAP[ext] || 'application/octet-stream';
  } catch {
    return 'application/octet-stream';
  }
}

/**
 * Extract filename from URL
 */
function getFilenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    return pathname.split('/').pop() || 'file';
  } catch {
    return 'file';
  }
}

/**
 * Detect MIME type from file magic bytes (file signature)
 */
function detectMimeFromBuffer(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }

  // GIF: 47 49 46 38
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return 'image/gif';
  }

  // WebP: 52 49 46 46 ... 57 45 42 50
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  // MP4: ... 66 74 79 70 (ftyp at offset 4)
  if (
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    return 'video/mp4';
  }

  return null;
}

/**
 * Download a file from a URL and return it as a buffer with metadata
 * Used for uploading user-provided files to GCS
 */
async function downloadFile(url: string): Promise<{
  buffer: Buffer;
  mimeType: string;
  filename: string;
}> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download file from ${url}: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const buffer = Buffer.from(await response.arrayBuffer());

  // Extract filename
  const contentDisposition = response.headers.get('content-disposition');
  let filename = 'file';

  if (contentDisposition) {
    const match = contentDisposition.match(/filename="?([^";\n]+)"?/);
    if (match) {
      filename = match[1];
    }
  } else {
    filename = getFilenameFromUrl(url);
  }

  // Detect real MIME type if Content-Type is generic
  let mimeType = contentType;
  if (contentType === 'application/octet-stream' || contentType === 'binary/octet-stream') {
    const detectedFromBuffer = detectMimeFromBuffer(buffer);
    if (detectedFromBuffer) {
      mimeType = detectedFromBuffer;
    } else {
      mimeType = getMimeFromExtension(url);
    }
  }

  return { buffer, mimeType, filename };
}

// ============================================================================
// MUVI ASSET SYNC (Reference-only, no GCS upload)
// ============================================================================

/**
 * Media asset from MUVI API
 */
export interface MuviMediaAsset {
  id: string;
  type: 'image' | 'video';
  name: string;
  url: string;
  thumbnailUrl: string;
}

/**
 * Create or get an image reference from MUVI
 * Stores the original MUVI URL without downloading/re-uploading
 */
async function getOrCreateMuviImage(
  originalUrl: string,
  filmMuviUuid: string,
  name: string
): Promise<Image> {
  // Check if already exists
  const existing = await getImageByOriginalUrl(originalUrl, filmMuviUuid);
  if (existing) {
    return existing;
  }

  // Create DB record with external reference
  // Use unique storageKey to avoid constraint violations
  const mimeType = getMimeFromExtension(originalUrl);
  const image = await createImage({
    filmMuviUuid,
    name,
    originalUrl,
    storageKey: `external:image:${randomUUID()}`,
    url: originalUrl, // Use MUVI URL directly
    mimeType,
    size: 0, // Unknown for external
  });

  return image;
}

/**
 * Create or get a video reference from MUVI
 * Stores the original MUVI URL and uploads to Meta in background for previews
 */
async function getOrCreateMuviVideo(
  originalUrl: string,
  filmMuviUuid: string,
  name: string,
  thumbnailUrl?: string
): Promise<Video> {
  // Check if already exists
  const existing = await getVideoByOriginalUrl(originalUrl, filmMuviUuid);
  if (existing) {
    // If exists but no Meta video ID, trigger background upload
    if (!existing.metaVideoId) {
      uploadVideoToMetaBackground(existing.id, existing.url, existing.name, filmMuviUuid);
    }
    return existing;
  }

  // Create DB record with external reference
  // Use unique storageKey to avoid constraint violations
  const mimeType = getMimeFromExtension(originalUrl);
  const video = await createVideo({
    filmMuviUuid,
    name,
    originalUrl,
    storageKey: `external:video:${randomUUID()}`,
    url: originalUrl, // Use MUVI URL directly
    mimeType,
    size: 0, // Unknown for external
    thumbnailUrl,
  });

  // Upload to Meta in background (needed for ad previews)
  uploadVideoToMetaBackground(video.id, originalUrl, name, filmMuviUuid);

  return video;
}

/**
 * Upload video to Meta Ads in background (fire and forget)
 * Updates the video record with metaVideoId when complete
 * Broadcasts events to SSE subscribers when upload succeeds or fails
 */
function uploadVideoToMetaBackground(
  videoId: string,
  videoUrl: string,
  videoName: string,
  filmMuviUuid: string
): void {
  // Fire and forget - don't await
  (async () => {
    try {
      console.log(`[Assets] Starting Meta upload for video ${videoId}: ${videoName}`);
      const { video_id } = await uploadAdVideo(meta, videoUrl, videoName);
      await setMetaVideoId(videoId, video_id);
      console.log(`[Assets] Meta upload complete for video ${videoId}: metaVideoId=${video_id}`);

      // Broadcast success to SSE subscribers
      broadcaster.broadcast(`film:${filmMuviUuid}`, {
        type: 'video_ready',
        videoId,
        metaVideoId: video_id,
      });
    } catch (error) {
      console.error(`[Assets] Failed to upload video ${videoId} to Meta:`, error);

      // Broadcast error to SSE subscribers
      broadcaster.broadcast(`film:${filmMuviUuid}`, {
        type: 'video_error',
        videoId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  })();
}

/**
 * Sync MUVI media assets to local database in background
 * - Stores references to MUVI URLs (no re-upload to GCS)
 * - Videos are uploaded to Meta Ads in background for preview support
 * - Broadcasts SSE events when assets are ready
 *
 * This is fire-and-forget - returns immediately while sync happens in background
 */
export function syncMuviAssetsInBackground(
  assets: MuviMediaAsset[],
  filmMuviUuid: string
): void {
  // Fire and forget - don't await
  (async () => {
    console.log(`[Assets] Starting background sync for ${assets.length} MUVI assets (film: ${filmMuviUuid})`);

    let imagesCount = 0;
    let videosCount = 0;

    for (const asset of assets) {
      try {
        if (asset.type === 'image') {
          const image = await getOrCreateMuviImage(asset.url, filmMuviUuid, asset.name);
          imagesCount++;
          console.log(`[Assets] Synced image: ${asset.name}`);

          // Broadcast image ready event
          broadcaster.broadcast(`film:${filmMuviUuid}`, {
            type: 'image_ready',
            imageId: image.id,
            name: image.name,
            url: image.url,
          });
        } else if (asset.type === 'video') {
          const video = await getOrCreateMuviVideo(
            asset.url,
            filmMuviUuid,
            asset.name,
            asset.thumbnailUrl
          );
          videosCount++;
          console.log(`[Assets] Synced video: ${asset.name}`);

          // Broadcast video synced event (video_ready is broadcast when Meta upload completes)
          broadcaster.broadcast(`film:${filmMuviUuid}`, {
            type: 'video_synced',
            videoId: video.id,
            name: video.name,
            url: video.url,
            thumbnailUrl: asset.thumbnailUrl || video.url,
          });
        }
      } catch (error) {
        console.error(`[Assets] Failed to sync ${asset.type} "${asset.name}":`, error);
        // Continue with other assets even if one fails
      }
    }

    // Broadcast sync complete event
    broadcaster.broadcast(`film:${filmMuviUuid}`, {
      type: 'asset_sync_complete',
      imagesCount,
      videosCount,
    });

    console.log(`[Assets] Background sync complete for film: ${filmMuviUuid}`);
  })();
}

// ============================================================================
// USER UPLOAD FUNCTIONS (with GCS upload)
// These are used when users upload their own files
// ============================================================================

/**
 * Get or create an image from a user-provided URL
 * Downloads and uploads to GCS, creates DB record
 */
export async function getOrCreateImage(
  originalUrl: string,
  filmMuviUuid: string,
  name?: string
): Promise<Image> {
  // Check if already exists
  const existing = await getImageByOriginalUrl(originalUrl, filmMuviUuid);
  if (existing) {
    return existing;
  }

  // Download from URL
  const { buffer, mimeType, filename } = await downloadFile(originalUrl);

  // Upload to GCS
  const storageResult = await uploadImage({
    buffer,
    mimeType,
    originalName: filename,
  });

  // Create DB record
  const image = await createImage({
    filmMuviUuid,
    name: name || filename,
    originalUrl,
    storageKey: storageResult.storageKey,
    url: storageResult.publicUrl,
    mimeType: storageResult.mimeType,
    size: storageResult.size,
  });

  return image;
}

/**
 * Get or create a video from a user-provided URL
 * Downloads and uploads to GCS, creates DB record, uploads to Meta in background
 */
export async function getOrCreateVideo(
  originalUrl: string,
  filmMuviUuid: string,
  name?: string
): Promise<Video> {
  // Check if already exists
  const existing = await getVideoByOriginalUrl(originalUrl, filmMuviUuid);
  if (existing) {
    // If exists but no Meta video ID, trigger background upload
    if (!existing.metaVideoId) {
      uploadVideoToMetaBackground(existing.id, existing.url, existing.name, filmMuviUuid);
    }
    return existing;
  }

  // Download from URL
  const { buffer, mimeType, filename } = await downloadFile(originalUrl);

  // Upload to GCS
  const storageResult = await uploadVideo({
    buffer,
    mimeType,
    originalName: filename,
  });

  // Create DB record
  const video = await createVideo({
    filmMuviUuid,
    name: name || filename,
    originalUrl,
    storageKey: storageResult.storageKey,
    url: storageResult.publicUrl,
    mimeType: storageResult.mimeType,
    size: storageResult.size,
  });

  // Upload to Meta in background
  uploadVideoToMetaBackground(video.id, video.url, video.name, filmMuviUuid);

  return video;
}

/**
 * Process multiple image URLs, returning existing or creating new records
 */
export async function getOrCreateImages(
  urls: string[],
  filmMuviUuid: string
): Promise<Image[]> {
  return Promise.all(
    urls.map((url) => getOrCreateImage(url, filmMuviUuid))
  );
}

/**
 * Process multiple video URLs, returning existing or creating new records
 */
export async function getOrCreateVideos(
  urls: string[],
  filmMuviUuid: string
): Promise<Video[]> {
  return Promise.all(
    urls.map((url) => getOrCreateVideo(url, filmMuviUuid))
  );
}
