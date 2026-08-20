import { describe, it, expect } from 'vitest';

import { becameAssetReady } from '../should-enqueue';

describe('becameAssetReady', () => {
  it('fires when an ad gains its first image', () => {
    expect(becameAssetReady({ imageIds: [] }, { imageIds: ['img_1'] })).toBe(true);
  });

  it('fires when the field was absent before', () => {
    expect(becameAssetReady({}, { imageIds: ['img_1'] })).toBe(true);
  });

  it('fires on document creation with images', () => {
    expect(becameAssetReady(undefined, { imageIds: ['img_1'] })).toBe(true);
  });

  // The important negative: without it, every later edit to a synced campaign
  // would enqueue another sync.
  it('does not fire when the ad already had images', () => {
    expect(
      becameAssetReady({ imageIds: ['img_1'] }, { imageIds: ['img_1', 'img_2'] })
    ).toBe(false);
  });

  it('does not fire while the ad still has no images', () => {
    expect(becameAssetReady({ imageIds: [] }, { imageIds: [] })).toBe(false);
  });

  it('does not fire on deletion', () => {
    expect(becameAssetReady({ imageIds: ['img_1'] }, undefined)).toBe(false);
  });

  it('treats a non-array imageIds as no images', () => {
    expect(becameAssetReady({ imageIds: 'img_1' }, { imageIds: 'img_2' })).toBe(false);
  });
});
