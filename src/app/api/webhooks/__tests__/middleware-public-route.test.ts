import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

/**
 * The Stripe webhook route has to be reachable WITHOUT a session cookie, and
 * until this file existed nothing in the suite noticed when it stopped being.
 *
 * That gap is not theoretical - it is the incident. Stripe posts from its own
 * servers and carries no cookie, so while the middleware gated
 * `/api/webhooks/` every event got a 401 before the handler ran, and the 401
 * says "Unauthorized", never "middleware". Removing '/api/webhooks/' from
 * PUBLIC_ROUTES left the whole suite green.
 *
 * Pass-through here is only safe because the route authorizes itself: it
 * requires a `stripe-signature` header and verifies the HMAC against
 * STRIPE_WEBHOOK_SECRET (src/app/api/webhooks/stripe/route.ts). That pairing is
 * a two-layer contract - the middleware opens the door, the signature check is
 * the lock - and neither layer may be dropped on the assumption that the other
 * one holds.
 */

const SESSION_COOKIE = 'pijama-session';

/** Middleware logs every decision; silenced so a failure is readable. */
let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  consoleSpy.mockRestore();
});

function requestFor(pathname: string, cookie?: string): NextRequest {
  const req = new NextRequest(`https://promote.pijamafilms.com${pathname}`);

  if (cookie) req.cookies.set(SESSION_COOKIE, cookie);

  return req;
}

/** NextResponse.next() marks itself with this header; a redirect or a 401 does not. */
function isPassThrough(res: Awaited<ReturnType<typeof middleware>>): boolean {
  return res.status === 200 && res.headers.get('x-middleware-next') === '1';
}

describe('the route the Stripe webhook needs open', () => {
  it('lets /api/webhooks/stripe through without a session cookie', async () => {
    const res = await middleware(requestFor('/api/webhooks/stripe'));

    expect(
      isPassThrough(res),
      'Stripe posts from its own servers and has no session cookie, so this path must ' +
        'reach its handler ungated. Gating it answers 401 to every event before the ' +
        'signature check runs, and nothing in the response points at the middleware - ' +
        'which is exactly how it went unnoticed the first time'
    ).toBe(true);
  });

  it('does not answer 401 on the webhook path', async () => {
    // Stated separately from the pass-through assertion on purpose: 401 is the
    // specific symptom the incident produced, and it should be named.
    const res = await middleware(requestFor('/api/webhooks/stripe'));

    expect(res.status).not.toBe(401);
  });
});

describe('what the webhook entry must NOT open', () => {
  it('does not publish sibling paths that merely start with "/api/webhooks"', async () => {
    // The entry carries a trailing slash. Dropping it - '/api/webhooks' - would
    // turn this prefix match into a wildcard over every sibling name, and the
    // test above would stay green while the surface widened.
    const res = await middleware(requestFor('/api/webhooks-internal/replay'));

    expect(
      isPassThrough(res),
      'only paths under /api/webhooks/ are public; without the trailing slash the entry ' +
        'would also publish any future /api/webhooks<something> route to the internet'
    ).toBe(false);
  });

  it('still answers 401 on a protected API route with no session', async () => {
    // The control: proves the pass-through above is the entry doing its job, not
    // the middleware waving everything through.
    const res = await middleware(requestFor('/api/campaigns'));

    expect(res.status).toBe(401);
  });
});
