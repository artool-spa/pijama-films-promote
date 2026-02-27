/**
 * Ad format specifications and crop aspect ratios
 */

import type { Image } from '@/models/image';
import type { Video } from '@/models/video';

// Ad format type
export type AdFormat = {
  name: string;
  ratio: number;
  width: number;
  height: number;
  maxDuration: string;
  note: string | null;
  mediaTypes: readonly ('image' | 'video')[];
  placements: string;
  recommended: boolean;
};

// Standard ad formats with their specs
export const AD_FORMATS: readonly AdFormat[] = [
  {
    name: 'Vertical (9:16)',
    ratio: 9 / 16,
    width: 1080,
    height: 1920,
    maxDuration: '60 sec',
    note: null,
    mediaTypes: ['image', 'video'],
    placements: 'Instagram: Reels, Stories · Facebook: Reels, Stories · TikTok: Feed (For You), Stories · YouTube: Shorts',
    recommended: true,
  },
  {
    name: 'Landscape (16:9)',
    ratio: 16 / 9,
    width: 1920,
    height: 1080,
    maxDuration: '3 min+',
    note: 'Ideal for Trailers',
    mediaTypes: ['image', 'video'],
    placements: 'YouTube: In-Stream (Pre-roll ads), Home Feed · Facebook: Feed, In-Stream, Instant Articles · (Not compatible with Instagram or TikTok)',
    recommended: false,
  },
  {
    name: 'Portrait (4:5)',
    ratio: 4 / 5,
    width: 1080,
    height: 1350,
    maxDuration: 'N/A',
    note: 'Ideal for Poster',
    mediaTypes: ['image'],
    placements: 'Instagram: Feed · Facebook: Feed · (Not compatible with TikTok or YouTube)',
    recommended: false,
  },
  {
    name: 'Square (1:1)',
    ratio: 1,
    width: 1080,
    height: 1080,
    maxDuration: 'No limit',
    note: null,
    mediaTypes: ['image', 'video'],
    placements: 'Instagram: Feed, Explore · Facebook: Feed, Marketplace, Video Feeds · (Not recommended for TikTok or YouTube)',
    recommended: false,
  },
] as const;

// Crop aspect ratio options for the crop dialog
export const CROP_ASPECT_RATIOS = [
  { label: 'Vertical (9:16)', value: 9 / 16 },
  { label: 'Landscape (16:9)', value: 16 / 9 },
  { label: 'Portrait (4:5)', value: 4 / 5 },
  { label: 'Square (1:1)', value: 1 },
  { label: 'Custom', value: 0 },
] as const;

// Aspect ratio label map for display
const ASPECT_RATIO_LABELS: Record<string, string> = {
  '9:16': 'Vertical',
  '16:9': 'Landscape',
  '4:5': 'Portrait',
  '1:1': 'Square',
};

/**
 * Get a human-readable label for an aspect ratio string
 */
export function getAspectRatioLabel(ratio: string | null | undefined): string {
  if (!ratio) return 'Unknown';
  return ASPECT_RATIO_LABELS[ratio] || 'Custom';
}

/**
 * Check if a film has at least one READY vertical (9:16) asset
 */
export function hasVerticalAsset(
  images: Pick<Image, 'status' | 'aspectRatio'>[],
  videos: Pick<Video, 'status' | 'aspectRatio'>[]
): boolean {
  const allAssets = [...images, ...videos];
  return allAssets.some(
    (asset) => asset.status === 'READY' && asset.aspectRatio === '9:16'
  );
}

/**
 * Check if a film has a READY asset matching a specific aspect ratio
 */
export function hasAssetForRatio(
  images: Pick<Image, 'status' | 'aspectRatio'>[],
  videos: Pick<Video, 'status' | 'aspectRatio'>[],
  ratio: string
): boolean {
  const allAssets = [...images, ...videos];
  return allAssets.some(
    (asset) => asset.status === 'READY' && asset.aspectRatio === ratio
  );
}

/**
 * Check if a film has a READY image matching a specific aspect ratio
 */
export function hasImageForRatio(
  images: Pick<Image, 'status' | 'aspectRatio'>[],
  ratio: string
): boolean {
  return images.some(
    (image) => image.status === 'READY' && image.aspectRatio === ratio
  );
}

/**
 * Check if a film has a READY video matching a specific aspect ratio
 */
export function hasVideoForRatio(
  videos: Pick<Video, 'status' | 'aspectRatio'>[],
  ratio: string
): boolean {
  return videos.some(
    (video) => video.status === 'READY' && video.aspectRatio === ratio
  );
}
