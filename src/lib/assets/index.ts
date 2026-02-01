import { randomUUID } from 'crypto';
import { broadcaster } from '@/lib/events';
import { uploadImage, uploadVideo } from '@/lib/storage';
import {
  createImage,
  getImageByOriginalUrl,
  setImageValidating,
  updateImageValidation,
  updateImageEligibility,
  type Image,
} from '@/models/image';
import {
  createVideo,
  getVideoByOriginalUrl,
  setMetaVideoId,
  setVideoValidating,
  updateVideoValidation,
  updateVideoEligibility,
  type Video,
} from '@/models/video';
import { meta, uploadAdVideo } from '#meta';
import {
  validateImageForMeta,
  validateVideoForMeta,
  calculateAspectRatio,
} from './validation';

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
 * Triggers validation in background for new images
 */
async function getOrCreateMuviImage(
  originalUrl: string,
  filmMuviUuid: string,
  name: string
): Promise<Image> {
  // Check if already exists
  const existing = await getImageByOriginalUrl(originalUrl, filmMuviUuid);
  if (existing) {
    // If existing image is still PENDING, trigger validation
    if (existing.status === 'PENDING') {
      validateImageInBackground(existing.id, existing.url, filmMuviUuid);
    }
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

  // Trigger validation in background
  validateImageInBackground(image.id, image.url, filmMuviUuid);

  return image;
}

/**
 * Create or get a video reference from MUVI
 * Stores the original MUVI URL and uploads to Meta in background for previews
 * Triggers validation after Meta upload completes
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
    } else if (existing.status === 'PENDING') {
      // If has Meta ID but still PENDING, trigger validation
      validateVideoInBackground(
        existing.id,
        existing.url,
        filmMuviUuid,
        existing.width || undefined,
        existing.height || undefined,
        existing.duration || undefined,
        existing.size,
        existing.metaVideoId
      );
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
  // Validation will be triggered after Meta upload completes
  uploadVideoToMetaBackground(video.id, originalUrl, name, filmMuviUuid);

  return video;
}

/**
 * Upload video to Meta Ads in background (fire and forget)
 * Updates the video record with metaVideoId when complete
 * Triggers validation after upload completes
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

      // Trigger validation now that we have the Meta video ID
      validateVideoInBackground(
        videoId,
        videoUrl,
        filmMuviUuid,
        undefined, // width
        undefined, // height
        undefined, // duration
        undefined, // size
        video_id   // metaVideoId
      );
    } catch (error) {
      console.error(`[Assets] Failed to upload video ${videoId} to Meta:`, error);

      // Update status to ERROR
      await updateVideoValidation(videoId, {
        status: 'ERROR',
        validationError: `Meta upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });

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
 * Sync MUVI media assets to local database
 * - Creates asset records synchronously with PENDING status
 * - Triggers validation and Meta upload in background
 * - Returns created/existing assets immediately
 *
 * @returns Object with arrays of synced images and videos
 */
export async function syncMuviAssets(
  assets: MuviMediaAsset[],
  filmMuviUuid: string
): Promise<{ images: Image[]; videos: Video[] }> {
  console.log(`[Assets] Syncing ${assets.length} MUVI assets (film: ${filmMuviUuid})`);

  const images: Image[] = [];
  const videos: Video[] = [];

  for (const asset of assets) {
    try {
      if (asset.type === 'image') {
        const image = await getOrCreateMuviImage(asset.url, filmMuviUuid, asset.name);
        images.push(image);
        console.log(`[Assets] Synced image: ${asset.name} (status: ${image.status})`);
      } else if (asset.type === 'video') {
        const video = await getOrCreateMuviVideo(
          asset.url,
          filmMuviUuid,
          asset.name,
          asset.thumbnailUrl
        );
        videos.push(video);
        console.log(`[Assets] Synced video: ${asset.name} (status: ${video.status})`);
      }
    } catch (error) {
      console.error(`[Assets] Failed to sync ${asset.type} "${asset.name}":`, error);
      // Continue with other assets even if one fails
    }
  }

  console.log(`[Assets] Sync complete: ${images.length} images, ${videos.length} videos`);
  return { images, videos };
}

/**
 * Sync MUVI media assets to local database in background
 * - Stores references to MUVI URLs (no re-upload to GCS)
 * - Videos are uploaded to Meta Ads in background for preview support
 * - Broadcasts SSE events when assets are ready
 *
 * This is fire-and-forget - returns immediately while sync happens in background
 * @deprecated Use syncMuviAssets instead for synchronous asset creation
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

// ============================================================================
// ASSET VALIDATION WORKFLOW
// ============================================================================

/**
 * Fetch image dimensions from URL using HEAD request or by downloading
 */
async function fetchImageDimensions(url: string): Promise<{ width: number; height: number } | null> {
  try {
    // For now, we can't get dimensions without downloading
    // In a real implementation, you might use a service like sharp or image-size
    // For external URLs, we'd need to download and analyze
    const response = await fetch(url);
    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());

    // Check PNG dimensions (width at bytes 16-19, height at 20-23)
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }

    // Check JPEG dimensions (more complex, need to parse markers)
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2;
      while (offset < buffer.length) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1];
        if (marker === 0xc0 || marker === 0xc2) {
          // SOF0 or SOF2 marker
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          return { width, height };
        }
        const length = buffer.readUInt16BE(offset + 2);
        offset += 2 + length;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Validate an image in background and update its status
 * Broadcasts SSE events when validation completes
 */
export function validateImageInBackground(
  imageId: string,
  imageUrl: string,
  filmMuviUuid: string,
  knownWidth?: number,
  knownHeight?: number,
  knownSize?: number
): void {
  (async () => {
    try {
      console.log(`[Assets] Starting validation for image ${imageId}`);

      // Set status to VALIDATING
      await setImageValidating(imageId);

      // Get dimensions if not provided
      let width = knownWidth;
      let height = knownHeight;
      let size = knownSize || 0;

      if (!width || !height) {
        const dimensions = await fetchImageDimensions(imageUrl);
        if (dimensions) {
          width = dimensions.width;
          height = dimensions.height;
        }
      }

      // If we still don't have dimensions, mark as READY anyway
      // The actual validation will happen at ad creation time
      if (!width || !height) {
        console.log(`[Assets] Image ${imageId} dimensions unknown, marking as READY`);

        await updateImageValidation(imageId, {
          status: 'READY',
          validationError: null,
        });

        // Assume eligible since we can't verify
        await updateImageEligibility(imageId, {
          facebookEligible: true,
          instagramEligible: true,
          eligibilityError: null,
        });

        broadcaster.broadcast(`film:${filmMuviUuid}`, {
          type: 'image_validated',
          imageId,
          status: 'READY',
          errors: [],
          aspectRatio: null,
        });

        broadcaster.broadcast(`film:${filmMuviUuid}`, {
          type: 'image_eligibility_checked',
          imageId,
          facebookEligible: true,
          instagramEligible: true,
          error: null,
        });
        return;
      }

      // Validate against Meta requirements
      const result = validateImageForMeta({ width, height, size });
      const aspectRatio = calculateAspectRatio(width, height);

      if (result.valid) {
        await updateImageValidation(imageId, {
          status: 'READY',
          validationError: null,
          aspectRatio,
          width,
          height,
        });

        // Update eligibility
        await updateImageEligibility(imageId, {
          facebookEligible: result.facebookEligible,
          instagramEligible: result.instagramEligible,
          eligibilityError: null,
        });

        console.log(`[Assets] Image ${imageId} validated successfully: ${aspectRatio}`);
      } else {
        await updateImageValidation(imageId, {
          status: 'INVALID',
          validationError: result.errors.join('; '),
          aspectRatio,
          width,
          height,
        });

        // Update eligibility even for invalid
        await updateImageEligibility(imageId, {
          facebookEligible: result.facebookEligible,
          instagramEligible: result.instagramEligible,
          eligibilityError: result.errors.join('; '),
        });

        console.log(`[Assets] Image ${imageId} validation failed: ${result.errors.join('; ')}`);
      }

      // Broadcast validation result
      broadcaster.broadcast(`film:${filmMuviUuid}`, {
        type: 'image_validated',
        imageId,
        status: result.valid ? 'READY' : 'INVALID',
        errors: result.errors,
        aspectRatio,
      });

      // Broadcast eligibility result
      broadcaster.broadcast(`film:${filmMuviUuid}`, {
        type: 'image_eligibility_checked',
        imageId,
        facebookEligible: result.facebookEligible,
        instagramEligible: result.instagramEligible,
        error: result.errors.length > 0 ? result.errors.join('; ') : null,
      });
    } catch (error) {
      console.error(`[Assets] Failed to validate image ${imageId}:`, error);

      await updateImageValidation(imageId, {
        status: 'ERROR',
        validationError: error instanceof Error ? error.message : 'Unknown error',
      });

      broadcaster.broadcast(`film:${filmMuviUuid}`, {
        type: 'image_validated',
        imageId,
        status: 'ERROR',
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        aspectRatio: null,
      });
    }
  })();
}

/**
 * Validate a video in background and update its status
 * Also checks Instagram eligibility via Meta API
 * Broadcasts SSE events when validation completes
 */
export function validateVideoInBackground(
  videoId: string,
  videoUrl: string,
  filmMuviUuid: string,
  knownWidth?: number,
  knownHeight?: number,
  knownDuration?: number,
  knownSize?: number,
  metaVideoId?: string
): void {
  (async () => {
    try {
      console.log(`[Assets] Starting validation for video ${videoId}`);

      // Set status to VALIDATING
      await setVideoValidating(videoId);

      // For videos, we rely on known metadata or Meta API
      // In a real implementation, you might use ffprobe or similar
      const width = knownWidth || 0;
      const height = knownHeight || 0;
      const duration = knownDuration || 0;
      const size = knownSize || 0;

      // If we don't have dimensions, we can't validate properly
      // Mark as PENDING until we get more info (e.g., from Meta upload)
      if (!width || !height || !duration) {
        console.log(`[Assets] Video ${videoId} missing metadata, will validate after Meta upload`);

        // Check if we have metaVideoId to get info from Meta
        if (metaVideoId) {
          await validateVideoWithMetaApi(videoId, metaVideoId, filmMuviUuid);
        } else {
          // Keep as PENDING - will be validated when Meta upload completes
          await updateVideoValidation(videoId, {
            status: 'PENDING',
            validationError: 'Waiting for video metadata',
          });
        }
        return;
      }

      // Validate against Meta requirements
      const result = validateVideoForMeta({ width, height, duration, size });
      const aspectRatio = calculateAspectRatio(width, height);

      if (result.valid) {
        await updateVideoValidation(videoId, {
          status: 'READY',
          validationError: null,
          aspectRatio,
          width,
          height,
          duration,
        });

        // Update eligibility
        await updateVideoEligibility(videoId, {
          facebookEligible: result.facebookEligible,
          instagramEligible: result.instagramEligible,
          eligibilityError: null,
        });

        console.log(`[Assets] Video ${videoId} validated successfully: ${aspectRatio}, ${duration}s`);
      } else {
        await updateVideoValidation(videoId, {
          status: 'INVALID',
          validationError: result.errors.join('; '),
          aspectRatio,
          width,
          height,
          duration,
        });

        await updateVideoEligibility(videoId, {
          facebookEligible: result.facebookEligible,
          instagramEligible: result.instagramEligible,
          eligibilityError: result.errors.join('; '),
        });

        console.log(`[Assets] Video ${videoId} validation failed: ${result.errors.join('; ')}`);
      }

      // Broadcast validation result
      broadcaster.broadcast(`film:${filmMuviUuid}`, {
        type: 'video_validated',
        videoId,
        status: result.valid ? 'READY' : 'INVALID',
        errors: result.errors,
        aspectRatio,
        width,
        height,
        duration,
      });

      // Broadcast eligibility result
      broadcaster.broadcast(`film:${filmMuviUuid}`, {
        type: 'video_eligibility_checked',
        videoId,
        facebookEligible: result.facebookEligible,
        instagramEligible: result.instagramEligible,
        error: result.errors.length > 0 ? result.errors.join('; ') : null,
      });
    } catch (error) {
      console.error(`[Assets] Failed to validate video ${videoId}:`, error);

      await updateVideoValidation(videoId, {
        status: 'ERROR',
        validationError: error instanceof Error ? error.message : 'Unknown error',
      });

      broadcaster.broadcast(`film:${filmMuviUuid}`, {
        type: 'video_validated',
        videoId,
        status: 'ERROR',
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        aspectRatio: null,
        width: null,
        height: null,
        duration: null,
      });
    }
  })();
}

/**
 * Validate a video using Meta API (check is_instagram_eligible)
 * Note: Meta's Video node doesn't expose width/height, only is_instagram_eligible and length
 */
async function validateVideoWithMetaApi(
  videoId: string,
  metaVideoId: string,
  filmMuviUuid: string
): Promise<void> {
  try {
    // Build URL for Meta API video endpoint
    // Note: width/height are NOT available on Meta's Video node
    const fields = 'is_instagram_eligible,length';
    const url = `${meta.baseUrl}/${metaVideoId}?fields=${fields}&access_token=${meta.accessToken}`;

    const response = await fetch(url);
    const data = await response.json() as {
      is_instagram_eligible?: boolean;
      length?: number;
      error?: { message: string };
    };

    if (!response.ok || data.error) {
      throw new Error(data.error?.message || 'Failed to fetch video info from Meta');
    }

    const duration = data.length ? Math.round(data.length) : 0;
    const instagramEligible = data.is_instagram_eligible ?? true; // Default to true if not specified

    // For videos, Meta's is_instagram_eligible is the authoritative check
    // We can't get dimensions from Meta API, so we trust their eligibility check
    const isValid = instagramEligible;
    const validationError = isValid ? null : 'Video not eligible for Instagram (check dimensions and duration)';

    await updateVideoValidation(videoId, {
      status: isValid ? 'READY' : 'INVALID',
      validationError,
      duration: duration || undefined,
    });

    // Facebook is generally more permissive than Instagram
    await updateVideoEligibility(videoId, {
      facebookEligible: true, // If Meta accepted the upload, it's FB eligible
      instagramEligible,
      eligibilityError: instagramEligible ? null : 'Video not eligible for Instagram',
    });

    // Broadcast results
    broadcaster.broadcast(`film:${filmMuviUuid}`, {
      type: 'video_validated',
      videoId,
      status: isValid ? 'READY' : 'INVALID',
      errors: validationError ? [validationError] : [],
      aspectRatio: null,
      width: null,
      height: null,
      duration,
    });

    broadcaster.broadcast(`film:${filmMuviUuid}`, {
      type: 'video_eligibility_checked',
      videoId,
      facebookEligible: true,
      instagramEligible,
      error: instagramEligible ? null : 'Video not eligible for Instagram',
    });

    console.log(`[Assets] Video ${videoId} validated via Meta API: instagram=${instagramEligible}, duration=${duration}s`);
  } catch (error) {
    console.error(`[Assets] Failed to validate video ${videoId} via Meta API:`, error);

    // If Meta API fails, mark as READY anyway since video was uploaded successfully
    // The ad creation will fail later if there's actually a problem
    await updateVideoValidation(videoId, {
      status: 'READY',
      validationError: null,
    });

    await updateVideoEligibility(videoId, {
      facebookEligible: true,
      instagramEligible: true, // Assume eligible, will fail at ad creation if not
      eligibilityError: null,
    });

    broadcaster.broadcast(`film:${filmMuviUuid}`, {
      type: 'video_validated',
      videoId,
      status: 'READY',
      errors: [],
      aspectRatio: null,
      width: null,
      height: null,
      duration: null,
    });

    console.log(`[Assets] Video ${videoId} marked READY (Meta API check failed, assuming valid)`);
  }
}

/**
 * Re-validate an asset (image or video)
 * Used when user requests re-validation of a failed asset
 */
export async function revalidateAsset(
  assetId: string,
  assetType: 'image' | 'video',
  filmMuviUuid: string
): Promise<void> {
  if (assetType === 'image') {
    const { getImageById } = await import('@/models/image');
    const image = await getImageById(assetId);
    if (image) {
      validateImageInBackground(
        image.id,
        image.url,
        filmMuviUuid,
        image.width || undefined,
        image.height || undefined,
        image.size
      );
    }
  } else {
    const { getVideoById } = await import('@/models/video');
    const video = await getVideoById(assetId);
    if (video) {
      validateVideoInBackground(
        video.id,
        video.url,
        filmMuviUuid,
        video.width || undefined,
        video.height || undefined,
        video.duration || undefined,
        video.size,
        video.metaVideoId || undefined
      );
    }
  }
}
