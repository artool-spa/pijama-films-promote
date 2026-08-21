/**
 * Meta placement bucketing.
 *
 * Meta dynamic-creative ads use automatic (Advantage+) placements by default, so a horizontal
 * (1.91:1 / 16:9) asset gets stretched into the 9:16 Stories/Reels slot. We avoid that by
 * choosing the ad set's placements from the aspect ratios of its assets.
 *
 * This used to be done per asset inside the creative, with
 * `asset_feed_spec.asset_customization_rules`. Meta rejects those rules whenever one rule covers
 * more than one asset (error_subcode 1885878, "Número de activos no válido en Target Rule"), which
 * is precisely the case they were built for, so no ad using them was ever created. Serving one
 * placement group per ad set is the coarser answer that works today; one ad set per bucket is the
 * finer one, and is tracked separately.
 */

// ============================================================================
// PLACEMENT SPECS
// ============================================================================

export interface PlacementTargeting {
  publisher_platforms: string[];
  facebook_positions: string[];
  instagram_positions: string[];
}

/**
 * Ad-set targeting that runs on Feed-type placements only (Story/Reels omitted).
 * Used as the fallback when an ad set has no Stories-suitable asset.
 */
export const FEED_ONLY_PLACEMENTS: PlacementTargeting = {
  publisher_platforms: ['facebook', 'instagram'],
  facebook_positions: ['feed', 'marketplace', 'search', 'instream_video', 'right_hand_column'],
  instagram_positions: ['stream', 'explore', 'explore_home', 'profile_feed', 'ig_search'],
};

/**
 * Ad-set targeting that runs on Story/Reels placements only.
 * Used for the (rare) edge case where an ad set has only vertical assets.
 */
export const STORY_ONLY_PLACEMENTS: PlacementTargeting = {
  publisher_platforms: ['facebook', 'instagram'],
  facebook_positions: ['story', 'facebook_reels'],
  instagram_positions: ['story', 'reels'],
};

// ============================================================================
// BUCKETING
// ============================================================================

export type PlacementBucket = 'feed' | 'story';
export type PlacementMedia = 'image' | 'video';

/** Aspect-ratio strings (from `calculateAspectRatio`) that belong in Story/Reels. */
const STORY_ASPECT_RATIOS = new Set(['9:16', '4:5']);
/** Aspect-ratio strings that belong in Feed. */
const FEED_ASPECT_RATIOS = new Set(['1:1', '1.91:1', '16:9']);
/** Ratio (width/height) at or below which an asset is treated as vertical/portrait. */
const STORY_RATIO_THRESHOLD = 0.85;

export interface AssetDimensions {
  aspectRatio?: string | null;
  width?: number | null;
  height?: number | null;
}

/**
 * Classify an asset into a placement bucket by aspect ratio.
 * Prefers the stored `aspectRatio` string, falling back to `width/height`.
 * Unknown dimensions default to 'feed' (safe: a feed asset is never forced into Stories).
 */
export function classifyPlacementBucket(asset: AssetDimensions): PlacementBucket {
  const { aspectRatio, width, height } = asset;

  if (aspectRatio && aspectRatio !== 'unknown') {
    if (STORY_ASPECT_RATIOS.has(aspectRatio)) return 'story';
    if (FEED_ASPECT_RATIOS.has(aspectRatio)) return 'feed';
    // Non-standard ratios are stored as "<decimal>:1" (see calculateAspectRatio).
    const parsed = parseFloat(aspectRatio);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed <= STORY_RATIO_THRESHOLD ? 'story' : 'feed';
    }
  }

  if (width && height && height > 0) {
    return width / height <= STORY_RATIO_THRESHOLD ? 'story' : 'feed';
  }

  return 'feed';
}

/**
 * Decide manual placement targeting for an ad set based on its assets' aspect ratios.
 * - feed only (no vertical asset uploaded) → exclude Story/Reels so horizontals never render there
 * - story only → restrict to Story/Reels
 * - both → Feed placements, and Meta rotates every asset within them
 *
 * The mixed case used to keep automatic placements and let the ad's
 * `asset_customization_rules` route each asset. Meta rejects those rules when a
 * rule covers more than one asset (error_subcode 1885878), which is the whole
 * point of having several, so the rules are gone. Until each bucket gets its own
 * ad set, Feed is the safe side of the trade: a vertical asset shown in Feed is
 * fitted, while a horizontal one in Stories is stretched to 9:16.
 */
export function computePlacementOverride(assets: AssetDimensions[]): PlacementTargeting | undefined {
  const hasFeed = assets.some((a) => classifyPlacementBucket(a) === 'feed');
  const hasStory = assets.some((a) => classifyPlacementBucket(a) === 'story');
  if (hasFeed) return FEED_ONLY_PLACEMENTS;
  if (hasStory) return STORY_ONLY_PLACEMENTS;
  return undefined;
}
