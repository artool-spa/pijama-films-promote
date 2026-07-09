import { describe, it, expect } from 'vitest';
import {
  classifyPlacementBucket,
  buildPlacementCustomizationRules,
  STORY_REELS_CUSTOMIZATION_SPEC,
  FEED_LABEL,
  STORY_LABEL,
} from '../placements';

describe('classifyPlacementBucket', () => {
  it('classifies vertical/portrait aspect ratios as story', () => {
    expect(classifyPlacementBucket({ aspectRatio: '9:16' })).toBe('story');
    expect(classifyPlacementBucket({ aspectRatio: '4:5' })).toBe('story');
  });

  it('classifies square/landscape aspect ratios as feed', () => {
    expect(classifyPlacementBucket({ aspectRatio: '1:1' })).toBe('feed');
    expect(classifyPlacementBucket({ aspectRatio: '1.91:1' })).toBe('feed');
    expect(classifyPlacementBucket({ aspectRatio: '16:9' })).toBe('feed');
  });

  it('falls back to width/height when aspectRatio is missing', () => {
    expect(classifyPlacementBucket({ width: 1080, height: 1920 })).toBe('story'); // 9:16
    expect(classifyPlacementBucket({ width: 1920, height: 1080 })).toBe('feed'); // 16:9
    expect(classifyPlacementBucket({ width: 1080, height: 1080 })).toBe('feed'); // 1:1
  });

  it('parses non-standard decimal ratio strings', () => {
    expect(classifyPlacementBucket({ aspectRatio: '0.56:1' })).toBe('story');
    expect(classifyPlacementBucket({ aspectRatio: '1.50:1' })).toBe('feed');
  });

  it('defaults to feed when dimensions are unknown', () => {
    expect(classifyPlacementBucket({})).toBe('feed');
    expect(classifyPlacementBucket({ aspectRatio: 'unknown' })).toBe('feed');
    expect(classifyPlacementBucket({ aspectRatio: null, width: null, height: null })).toBe('feed');
  });
});

describe('buildPlacementCustomizationRules', () => {
  it('returns null when there is no story asset (feed-only)', () => {
    expect(buildPlacementCustomizationRules('image', ['a.jpg', 'b.jpg'], [])).toBeNull();
  });

  it('returns null when there is no feed asset (story-only)', () => {
    expect(buildPlacementCustomizationRules('image', [], ['v.jpg'])).toBeNull();
  });

  it('builds image rules routing story asset to Story/Reels and feed asset as default', () => {
    const result = buildPlacementCustomizationRules('image', ['feed.jpg'], ['story.jpg']);
    expect(result).not.toBeNull();

    // Labeled image entries
    expect(result!.images).toEqual([
      { url: 'feed.jpg', adlabels: [{ name: FEED_LABEL }] },
      { url: 'story.jpg', adlabels: [{ name: STORY_LABEL }] },
    ]);
    expect(result!.videos).toBeUndefined();

    // Exactly one default rule, and the story rule carries the Story/Reels spec
    const rules = result!.asset_customization_rules;
    expect(rules).toHaveLength(2);
    const defaults = rules.filter((r) => r.is_default === true);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].image_label).toEqual({ name: FEED_LABEL });

    const storyRule = rules.find((r) => r.is_default !== true)!;
    expect(storyRule.customization_spec).toEqual(STORY_REELS_CUSTOMIZATION_SPEC);
    expect(storyRule.image_label).toEqual({ name: STORY_LABEL });
  });

  it('builds video rules using video_id and video_label', () => {
    const result = buildPlacementCustomizationRules('video', ['100'], ['200']);
    expect(result).not.toBeNull();

    expect(result!.videos).toEqual([
      { video_id: '100', adlabels: [{ name: FEED_LABEL }] },
      { video_id: '200', adlabels: [{ name: STORY_LABEL }] },
    ]);
    expect(result!.images).toBeUndefined();

    const rules = result!.asset_customization_rules;
    expect(rules.filter((r) => r.is_default === true)).toHaveLength(1);
    const storyRule = rules.find((r) => r.is_default !== true)!;
    expect(storyRule.video_label).toEqual({ name: STORY_LABEL });
  });

  it('keeps multiple assets per bucket', () => {
    const result = buildPlacementCustomizationRules('image', ['f1.jpg', 'f2.jpg'], ['s1.jpg', 's2.jpg']);
    expect(result!.images).toHaveLength(4);
  });
});
