import { describe, it, expect } from 'vitest';
import {
  classifyPlacementBucket,
  computePlacementOverride,
  FEED_ONLY_PLACEMENTS,
  STORY_ONLY_PLACEMENTS,
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

describe('computePlacementOverride', () => {
  it('keeps horizontals out of Story/Reels', () => {
    expect(computePlacementOverride([{ aspectRatio: '1.91:1' }])).toEqual(FEED_ONLY_PLACEMENTS);
  });

  it('restricts an all-vertical ad set to Story/Reels', () => {
    expect(computePlacementOverride([{ aspectRatio: '9:16' }])).toEqual(STORY_ONLY_PLACEMENTS);
  });

  it('serves a mixed ad set in Feed', () => {
    // Meta rejects per-asset rules covering several assets, so the ad set picks
    // one placement group: a vertical fitted into Feed beats a horizontal
    // stretched into Stories.
    expect(computePlacementOverride([{ aspectRatio: '1.91:1' }, { aspectRatio: '9:16' }])).toEqual(
      FEED_ONLY_PLACEMENTS
    );
  });

  it('leaves placements automatic when there are no assets', () => {
    expect(computePlacementOverride([])).toBeUndefined();
  });
});
