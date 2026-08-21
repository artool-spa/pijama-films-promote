/**
 * Meta placement asset customization.
 *
 * Meta dynamic-creative ads use automatic (Advantage+) placements by default, so a horizontal
 * (1.91:1 / 16:9) asset gets stretched into the 9:16 Stories/Reels slot. To fix that we route
 * each asset to the placements its aspect ratio suits, via `asset_feed_spec.asset_customization_rules`
 * (the same label + `is_default` mechanism used by `createMultiLanguageAd`, keyed on placement
 * instead of locale).
 *
 * When a Stories-suitable (vertical/portrait) asset exists, it is served in Story/Reels and the
 * horizontal asset in Feed. When no vertical asset exists, the caller instead excludes Story/Reels
 * at the ad-set level using `FEED_ONLY_PLACEMENTS` (we do not auto-crop horizontals into 9:16).
 */

// ============================================================================
// PLACEMENT SPECS
// ============================================================================

/** customization_spec that matches only Story and Reels placements. */
export const STORY_REELS_CUSTOMIZATION_SPEC = {
  publisher_platforms: ['facebook', 'instagram'],
  facebook_positions: ['story', 'facebook_reels'],
  instagram_positions: ['story', 'reels'],
} as const;

/**
 * customization_spec for the default rule.
 *
 * Meta requires *every* asset_customization_rule to carry a spec, including the
 * `is_default` one — `createMultiLanguageAd` gives each of its rules a
 * `{ locales }` spec for the same reason. Omitting it here made Meta reject the
 * whole creative with a bare `(#100) Invalid parameter`.
 *
 * No position filter, so this catches Feed and every placement the Story/Reels
 * rule above did not match.
 */
export const DEFAULT_PLACEMENT_CUSTOMIZATION_SPEC = {
  publisher_platforms: ['facebook', 'instagram'],
} as const;

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

// Adlabel names used to tie assets to their placement rule.
export const FEED_LABEL = 'placement_feed';
export const STORY_LABEL = 'placement_story';

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

// ============================================================================
// ASSET CUSTOMIZATION RULES
// ============================================================================

type LabeledEntry = Record<string, unknown> & { adlabels: Array<{ name: string }> };

export interface PlacementCustomizationResult {
  /** Labeled `images` entries (present when media is 'image'). */
  images?: LabeledEntry[];
  /** Labeled `videos` entries (present when media is 'video'). */
  videos?: LabeledEntry[];
  asset_customization_rules: Array<Record<string, unknown>>;
}

/**
 * Build the `asset_feed_spec` fragment that routes vertical assets to Story/Reels and horizontal
 * assets to Feed. Returns `null` when either bucket is empty (nothing to customize — the caller
 * should emit a plain asset feed and, for the feed-only case, exclude Story/Reels at the ad-set
 * level).
 *
 * @param media       'image' (values are URLs) or 'video' (values are Meta video IDs)
 * @param feedValues  URLs/video IDs of horizontal/square assets → Feed (default rule)
 * @param storyValues URLs/video IDs of vertical/portrait assets → Story/Reels rule
 */
export function buildPlacementCustomizationRules(
  media: PlacementMedia,
  feedValues: string[],
  storyValues: string[],
): PlacementCustomizationResult | null {
  if (feedValues.length === 0 || storyValues.length === 0) {
    return null;
  }

  const valueKey = media === 'image' ? 'url' : 'video_id';
  const labelKey = media === 'image' ? 'image_label' : 'video_label';

  const buildEntry = (value: string, label: string): LabeledEntry => ({
    [valueKey]: value,
    adlabels: [{ name: label }],
  });

  const entries: LabeledEntry[] = [
    ...feedValues.map((v) => buildEntry(v, FEED_LABEL)),
    ...storyValues.map((v) => buildEntry(v, STORY_LABEL)),
  ];

  const asset_customization_rules: Array<Record<string, unknown>> = [
    {
      customization_spec: STORY_REELS_CUSTOMIZATION_SPEC,
      [labelKey]: { name: STORY_LABEL },
    },
    {
      // Default rule: catches every placement not matched above (Feed, and any others).
      customization_spec: DEFAULT_PLACEMENT_CUSTOMIZATION_SPEC,
      [labelKey]: { name: FEED_LABEL },
      is_default: true,
    },
  ];

  return media === 'image'
    ? { images: entries, asset_customization_rules }
    : { videos: entries, asset_customization_rules };
}
