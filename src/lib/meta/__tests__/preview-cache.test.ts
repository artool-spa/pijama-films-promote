import { describe, it, expect, beforeEach } from 'vitest';
import {
  consumePreviewQuota,
  getCachedPreview,
  previewCacheKey,
  resetPreviewCache,
  setCachedPreview,
} from '@/lib/meta/preview-cache';

const NOW = new Date('2026-08-21T10:00:00Z').getTime();

describe('previewCacheKey', () => {
  it('ignores field order', () => {
    expect(previewCacheKey({ a: '1', b: '2' })).toBe(previewCacheKey({ b: '2', a: '1' }));
  });

  it('changes when any value changes', () => {
    const base = { headline: 'Watch the film', format: 'MOBILE_FEED_STANDARD' };

    expect(previewCacheKey({ ...base, headline: 'Watch it tonight' })).not.toBe(
      previewCacheKey(base)
    );
    expect(previewCacheKey({ ...base, format: 'INSTAGRAM_STORY' })).not.toBe(
      previewCacheKey(base)
    );
  });

  it('treats a missing field and an undefined one alike', () => {
    expect(previewCacheKey({ a: '1', description: undefined })).toBe(
      previewCacheKey({ a: '1', description: null })
    );
  });
});

describe('preview cache', () => {
  beforeEach(() => resetPreviewCache());

  it('returns a stored preview within the TTL', () => {
    setCachedPreview('k', '<iframe></iframe>', NOW);

    expect(getCachedPreview('k', NOW + 59_000)).toBe('<iframe></iframe>');
  });

  it('expires a preview after 60 seconds', () => {
    setCachedPreview('k', '<iframe></iframe>', NOW);

    expect(getCachedPreview('k', NOW + 60_001)).toBeNull();
  });

  it('misses on an unknown key', () => {
    expect(getCachedPreview('nope', NOW)).toBeNull();
  });

  it('evicts the least recently used entry past the cap', () => {
    for (let i = 0; i < 200; i++) {
      setCachedPreview(`k${i}`, `html-${i}`, NOW);
    }
    // Touch the oldest so it is no longer the eviction candidate.
    expect(getCachedPreview('k0', NOW)).toBe('html-0');

    setCachedPreview('overflow', 'html-new', NOW);

    expect(getCachedPreview('k0', NOW)).toBe('html-0');
    expect(getCachedPreview('k1', NOW)).toBeNull();
    expect(getCachedPreview('overflow', NOW)).toBe('html-new');
  });
});

describe('preview rate limit', () => {
  beforeEach(() => resetPreviewCache());

  it('allows a normal editing session', () => {
    for (let i = 0; i < 40; i++) {
      expect(consumePreviewQuota('partner-1', NOW).allowed).toBe(true);
    }
  });

  it('blocks past the budget and reports when to retry', () => {
    for (let i = 0; i < 40; i++) consumePreviewQuota('partner-1', NOW);

    const blocked = consumePreviewQuota('partner-1', NOW + 15_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(45);
  });

  it('counts each partner separately', () => {
    for (let i = 0; i < 40; i++) consumePreviewQuota('partner-1', NOW);

    expect(consumePreviewQuota('partner-2', NOW).allowed).toBe(true);
  });

  it('opens a fresh window once the old one lapses', () => {
    for (let i = 0; i < 40; i++) consumePreviewQuota('partner-1', NOW);

    expect(consumePreviewQuota('partner-1', NOW + 60_001).allowed).toBe(true);
  });
});
