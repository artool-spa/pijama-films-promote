/**
 * In-memory rate limiter for `POST /api/auth/atlas/session`.
 *
 * ## What this is for
 *
 * The endpoint is unauthenticated by necessity - its caller is the `/auth`
 * landing page, which has no session cookie yet - and every call makes one
 * outbound request to Atlas. That is a noise and cost vector, not a security
 * hole: the upstream URL comes from the environment, never from the request, so
 * there is nothing to point it at. Gating the endpoint behind another env var
 * would close it for JP's production test, which defeats the purpose, so it
 * gets a limiter instead.
 *
 * **This is a noise buffer, not an authorization control.** The real containment
 * for login is the fail-closed allowlist in `./config`. Sizing follows from
 * that: generous enough that a human retrying a probe never notices, tight
 * enough that a loop does.
 *
 * Follows the house pattern in `src/lib/meta/preview-cache.ts`: fixed window,
 * per-identity Map, `{ allowed, retryAfterSeconds }`, plus a reset seam.
 * Per-instance like that one - App Hosting may run several containers, so a
 * determined caller gets one budget per container. Fine for a buffer.
 */

/** Per-caller budget. A human probing by hand uses single digits. */
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;
/** Bounded so a long-lived instance cannot grow without limit under spoofed IPs. */
const MAX_TRACKED_CALLERS = 5_000;

type RateWindow = { count: number; resetsAt: number };

const windows = new Map<string, RateWindow>();

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

/**
 * Caller identity for the limiter: the client IP as the proxy reported it.
 *
 * `x-forwarded-for` is a chain; the first entry is the original client. It is
 * trivially spoofable by the client, which is exactly why this must never be
 * used for authorization - only to keep one misbehaving caller from being free.
 * Requests we cannot attribute share a single bucket on purpose: unattributable
 * traffic should not each get its own fresh budget.
 */
export function callerKey(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();

  if (first) return first;

  return headers.get('x-real-ip')?.trim() || 'unattributed';
}

export function consumeAtlasSessionQuota(
  caller: string,
  now: number = Date.now()
): RateLimitResult {
  const window = windows.get(caller);

  if (!window || window.resetsAt <= now) {
    windows.set(caller, { count: 1, resetsAt: now + RATE_LIMIT_WINDOW_MS });
    evictOldest();

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

function evictOldest(): void {
  while (windows.size > MAX_TRACKED_CALLERS) {
    // Map keeps insertion order, so the first key is the oldest window.
    const oldest = windows.keys().next();
    if (oldest.done) break;
    windows.delete(oldest.value);
  }
}

/** Test seam: drops every tracked window. */
export function resetAtlasSessionQuota(): void {
  windows.clear();
}
