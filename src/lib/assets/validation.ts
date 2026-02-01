/**
 * Asset Validation for Meta Platform Requirements
 *
 * Based on Meta's media requirements for Instagram and Facebook ads.
 * Reference: prompts/2026-01/extra/media_reference.md
 */

// ============================================================================
// META REQUIREMENTS CONSTANTS
// ============================================================================

export const META_IMAGE_REQUIREMENTS = {
  minWidth: 600,
  minHeight: 600,
  recommendedInstagramWidth: 640,
  recommendedFacebookSize: 1080,
  maxFileSizeMB: 30,
  validAspectRatios: ['1:1', '4:5', '1.91:1'] as const,
  // Aspect ratio range: between 4:5 (0.8) and 1.91:1 (1.91)
  minAspectRatio: 0.8, // 4:5
  maxAspectRatio: 1.91, // 1.91:1
} as const;

export const META_VIDEO_REQUIREMENTS = {
  minWidth: 600,
  minDurationSeconds: 3,
  maxDurationSeconds: 60,
  maxFileSizeGB: 2.3,
  maxFileSizeBytes: 2.3 * 1024 * 1024 * 1024,
  validAspectRatios: ['1:1', '4:5', '1.91:1', '9:16'] as const,
  // Aspect ratio range for stream: between 4:5 (0.8) and 1.91:1 (1.91)
  // Stories support 9:16 (0.5625)
  minAspectRatio: 0.5625, // 9:16
  maxAspectRatio: 1.91, // 1.91:1
} as const;

// ============================================================================
// TYPES
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  aspectRatio: string | null;
  facebookEligible: boolean;
  instagramEligible: boolean;
}

export interface ImageValidationInput {
  width: number;
  height: number;
  size: number; // bytes
}

export interface VideoValidationInput {
  width: number;
  height: number;
  duration: number; // seconds
  size: number; // bytes
}

// ============================================================================
// ASPECT RATIO UTILITIES
// ============================================================================

/**
 * Calculate aspect ratio from dimensions
 * Returns a simplified ratio string like "1:1", "4:5", "16:9"
 */
export function calculateAspectRatio(width: number, height: number): string {
  if (width <= 0 || height <= 0) {
    return 'unknown';
  }

  const ratio = width / height;

  // Check for common aspect ratios with tolerance
  const tolerance = 0.02;

  if (Math.abs(ratio - 1) < tolerance) return '1:1';
  if (Math.abs(ratio - 0.8) < tolerance) return '4:5';
  if (Math.abs(ratio - 1.91) < tolerance) return '1.91:1';
  if (Math.abs(ratio - 0.5625) < tolerance) return '9:16';
  if (Math.abs(ratio - 1.778) < tolerance) return '16:9';

  // Return decimal ratio for non-standard ratios
  return `${ratio.toFixed(2)}:1`;
}

/**
 * Get numeric aspect ratio value from dimensions
 */
export function getAspectRatioValue(width: number, height: number): number {
  if (height <= 0) return 0;
  return width / height;
}

/**
 * Check if aspect ratio is valid for Meta ads
 */
export function isAspectRatioValidForMeta(
  width: number,
  height: number,
  allowStories: boolean = true
): boolean {
  const ratio = getAspectRatioValue(width, height);
  const minRatio = allowStories
    ? META_VIDEO_REQUIREMENTS.minAspectRatio
    : META_IMAGE_REQUIREMENTS.minAspectRatio;

  return ratio >= minRatio && ratio <= META_IMAGE_REQUIREMENTS.maxAspectRatio;
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate an image against Meta platform requirements
 */
export function validateImageForMeta(input: ImageValidationInput): ValidationResult {
  const { width, height, size } = input;
  const errors: string[] = [];
  const warnings: string[] = [];
  let facebookEligible = true;
  let instagramEligible = true;

  // Calculate aspect ratio
  const aspectRatio = calculateAspectRatio(width, height);
  const ratioValue = getAspectRatioValue(width, height);

  // Check minimum width
  if (width < META_IMAGE_REQUIREMENTS.minWidth) {
    errors.push(`Width must be at least ${META_IMAGE_REQUIREMENTS.minWidth}px (current: ${width}px)`);
    facebookEligible = false;
    instagramEligible = false;
  }

  // Check minimum height
  if (height < META_IMAGE_REQUIREMENTS.minHeight) {
    errors.push(`Height must be at least ${META_IMAGE_REQUIREMENTS.minHeight}px (current: ${height}px)`);
    facebookEligible = false;
    instagramEligible = false;
  }

  // Check aspect ratio
  if (ratioValue < META_IMAGE_REQUIREMENTS.minAspectRatio) {
    errors.push(`Aspect ratio too tall. Must be between 4:5 and 1.91:1 (current: ${aspectRatio})`);
    instagramEligible = false;
  }
  if (ratioValue > META_IMAGE_REQUIREMENTS.maxAspectRatio) {
    errors.push(`Aspect ratio too wide. Must be between 4:5 and 1.91:1 (current: ${aspectRatio})`);
    instagramEligible = false;
  }

  // Check file size
  const sizeMB = size / (1024 * 1024);
  if (sizeMB > META_IMAGE_REQUIREMENTS.maxFileSizeMB) {
    errors.push(`File size exceeds ${META_IMAGE_REQUIREMENTS.maxFileSizeMB}MB limit (current: ${sizeMB.toFixed(1)}MB)`);
    facebookEligible = false;
    instagramEligible = false;
  }

  // Warnings for recommendations
  if (width < META_IMAGE_REQUIREMENTS.recommendedInstagramWidth) {
    warnings.push(`For best quality on Instagram, use images at least ${META_IMAGE_REQUIREMENTS.recommendedInstagramWidth}px wide`);
  }
  if (width < META_IMAGE_REQUIREMENTS.recommendedFacebookSize || height < META_IMAGE_REQUIREMENTS.recommendedFacebookSize) {
    warnings.push(`For best quality on Facebook, use images at least ${META_IMAGE_REQUIREMENTS.recommendedFacebookSize}x${META_IMAGE_REQUIREMENTS.recommendedFacebookSize}px`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    aspectRatio,
    facebookEligible,
    instagramEligible,
  };
}

/**
 * Validate a video against Meta platform requirements
 */
export function validateVideoForMeta(input: VideoValidationInput): ValidationResult {
  const { width, height, duration, size } = input;
  const errors: string[] = [];
  const warnings: string[] = [];
  let facebookEligible = true;
  let instagramEligible = true;

  // Calculate aspect ratio
  const aspectRatio = calculateAspectRatio(width, height);
  const ratioValue = getAspectRatioValue(width, height);

  // Check minimum width
  if (width < META_VIDEO_REQUIREMENTS.minWidth) {
    errors.push(`Width must be at least ${META_VIDEO_REQUIREMENTS.minWidth}px (current: ${width}px)`);
    facebookEligible = false;
    instagramEligible = false;
  }

  // Check duration
  if (duration < META_VIDEO_REQUIREMENTS.minDurationSeconds) {
    errors.push(`Duration must be at least ${META_VIDEO_REQUIREMENTS.minDurationSeconds} seconds (current: ${duration}s)`);
    facebookEligible = false;
    instagramEligible = false;
  }
  if (duration > META_VIDEO_REQUIREMENTS.maxDurationSeconds) {
    errors.push(`Duration must not exceed ${META_VIDEO_REQUIREMENTS.maxDurationSeconds} seconds (current: ${duration}s)`);
    instagramEligible = false;
    // Facebook allows longer videos, but Instagram doesn't
  }

  // Check aspect ratio for stream ads (not stories)
  const isStoryRatio = ratioValue < META_IMAGE_REQUIREMENTS.minAspectRatio;
  if (ratioValue < META_VIDEO_REQUIREMENTS.minAspectRatio) {
    errors.push(`Aspect ratio too tall. Must be at least 9:16 (current: ${aspectRatio})`);
    facebookEligible = false;
    instagramEligible = false;
  }
  if (ratioValue > META_VIDEO_REQUIREMENTS.maxAspectRatio) {
    errors.push(`Aspect ratio too wide. Must not exceed 1.91:1 (current: ${aspectRatio})`);
    instagramEligible = false;
  }

  // Check file size
  if (size > META_VIDEO_REQUIREMENTS.maxFileSizeBytes) {
    const sizeGB = size / (1024 * 1024 * 1024);
    errors.push(`File size exceeds ${META_VIDEO_REQUIREMENTS.maxFileSizeGB}GB limit (current: ${sizeGB.toFixed(2)}GB)`);
    facebookEligible = false;
    instagramEligible = false;
  }

  // Warning for story-only aspect ratios
  if (isStoryRatio) {
    warnings.push('This aspect ratio is only suitable for Stories placement');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    aspectRatio,
    facebookEligible,
    instagramEligible,
  };
}

/**
 * Check if dimensions meet minimum requirements for Meta
 */
export function meetsMinimumRequirements(width: number, height: number): boolean {
  return width >= META_IMAGE_REQUIREMENTS.minWidth && height >= META_IMAGE_REQUIREMENTS.minHeight;
}
