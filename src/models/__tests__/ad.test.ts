import { describe, it, expect } from 'vitest';
import { AdUpdateSchema } from '@/models/ad';

describe('AdUpdateSchema', () => {
  it('rejects an update that empties both media arrays', () => {
    // An ad with no creative cannot be rebuilt on Meta or Google.
    expect(AdUpdateSchema.safeParse({ imageIds: [], videoIds: [] }).success).toBe(false);
  });

  it('allows swapping images while videos are untouched', () => {
    expect(AdUpdateSchema.safeParse({ imageIds: ['image-1'] }).success).toBe(true);
  });

  it('allows emptying one array when the other is filled', () => {
    expect(AdUpdateSchema.safeParse({ imageIds: [], videoIds: ['video-1'] }).success).toBe(true);
  });

  it('rejects adSetType because it is immutable', () => {
    expect(AdUpdateSchema.safeParse({ adSetType: 'VIDEO' }).success).toBe(false);
  });

  it('caps the media arrays at ten entries', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `image-${i}`);
    expect(AdUpdateSchema.safeParse({ imageIds: eleven }).success).toBe(false);
  });
});
