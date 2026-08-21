/**
 * In-memory cache and rate limiter for `POST /api/meta/preview`.
 *
 * Every preview request is one uncached call to Meta's Graph API, and the ad
 * editors refetch on a 500ms debounce while a producer types, so an editing
 * session can easily spend dozens of calls against the app's rate budget. The
 * same creative usually renders identically, so a short TTL collapses the
 * repeats (typing a headline, deleting it, typing it again) into one call.
 *
 * Both structures are per-instance: App Hosting may run several containers, so
 * treat this as a cost reducer, not a guarantee. The limiter is a safety net
 * against a runaway client, not an authorization control.
 */

import { createHash } from 'crypto';

/** How long a rendered preview stays fresh. */
const TTL_MS = 60_000;
/** Bounded so a long-lived instance cannot grow without limit. */
const MAX_ENTRIES = 200;
/** Per-partner budget, generous enough for normal editing. */
const RATE_LIMIT_MAX = 40;
const RATE_LIMIT_WINDOW_MS = 60_000;

type CacheEntry = { html: string; expiresAt: number };
type RateWindow = { count: number; resetsAt: number };

const previews = new Map<string, CacheEntry>();
const rateWindows = new Map<string, RateWindow>();

/** Stable key for a preview request payload. */
export function previewCacheKey(payload: Record<string, unknown>): string {
  // Sort the keys so field order in the request body cannot split the cache.
  const canonical = JSON.stringify(
    Object.keys(payload)
      .sort()
      .map((key) => [key, payload[key] ?? null])
  );
  return createHash('sha256').update(canonical).digest('hex');
}

export function getCachedPreview(key: string, now: number = Date.now()): string | null {
  const entry = previews.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= now) {
    previews.delete(key);
    return null;
  }

  // Refresh insertion order so the hot entries survive eviction.
  previews.delete(key);
  previews.set(key, entry);
  return entry.html;
}

export function setCachedPreview(key: string, html: string, now: number = Date.now()): void {
  previews.delete(key);
  previews.set(key, { html, expiresAt: now + TTL_MS });

  while (previews.size > MAX_ENTRIES) {
    // Map keeps insertion order, so the first key is the least recently used.
    const oldest = previews.keys().next();
    if (oldest.done) break;
    previews.delete(oldest.value);
  }
}

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export function consumePreviewQuota(
  partnerId: string,
  now: number = Date.now()
): RateLimitResult {
  const window = rateWindows.get(partnerId);

  if (!window || window.resetsAt <= now) {
    rateWindows.set(partnerId, { count: 1, resetsAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (window.count >= RATE_LIMIT_MAX) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((window.resetsAt - now) / 1000)),
    };
  }

  window.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test seam: drops all cached previews and rate limit windows. */
export function resetPreviewCache(): void {
  previews.clear();
  rateWindows.clear();
}
