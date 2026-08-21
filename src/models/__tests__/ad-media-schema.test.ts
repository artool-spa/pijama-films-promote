import { describe, it, expect } from 'vitest';
import { ImageSchema, VideoSchema } from '@/models/ad';
import { classifyPlacementBucket } from '@/lib/meta/placements';

/**
 * The Meta sync buckets each asset by aspect ratio to route verticals into
 * Story/Reels. It reads those fields off the *hydrated ad*, so if these schemas
 * drop them the routing silently sends everything to Feed.
 */
describe('hydrated ad media schemas', () => {
  const baseVideo = {
    id: 'video-1',
    filmMuviUuid: 'film-1',
    name: 'GLORIA_VIDEO_VERTICAL.mp4',
    originalUrl: 'https://cdn.test/v.mp4',
    storageKey: 'v.mp4',
    url: 'https://cdn.test/v.mp4',
    mimeType: 'video/mp4',
    size: 1024,
    duration: 30,
    thumbnailUrl: null,
    metaVideoId: 'meta-1',
    youtubeVideoId: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
  };

  it('keeps the dimensions of a video', () => {
    const video = VideoSchema.parse({
      ...baseVideo,
      width: 1080,
      height: 1920,
      aspectRatio: '9:16',
    });

    expect(video.width).toBe(1080);
    expect(video.height).toBe(1920);
    expect(video.aspectRatio).toBe('9:16');
    expect(classifyPlacementBucket(video)).toBe('story');
  });

  it('keeps the dimensions of an image', () => {
    const image = ImageSchema.parse({
      id: 'image-1',
      filmMuviUuid: 'film-1',
      name: 'poster.jpg',
      originalUrl: 'https://cdn.test/p.jpg',
      storageKey: 'p.jpg',
      url: 'https://cdn.test/p.jpg',
      mimeType: 'image/jpeg',
      size: 1024,
      width: 1200,
      height: 628,
      aspectRatio: '1.91:1',
      createdAt: new Date('2026-08-01T00:00:00Z'),
    });

    expect(classifyPlacementBucket(image)).toBe('feed');
  });

  it('defaults a video with no stored dimensions to null rather than failing', () => {
    // Videos created before dimensions were captured still have to parse.
    const video = VideoSchema.parse(baseVideo);

    expect(video.aspectRatio).toBeNull();
    expect(classifyPlacementBucket(video)).toBe('feed');
  });
});
