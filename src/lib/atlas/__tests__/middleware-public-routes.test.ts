import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

/**
 * The Atlas SSO depends on three routes being reachable WITHOUT a session
 * cookie, and nothing else in the suite notices when they stop being reachable.
 *
 * That gap is not theoretical: removing '/api/auth/atlas/' from PUBLIC_ROUTES
 * leaves the whole suite green while the SSO answers 401 to every exchange -
 * and the 401 says "Unauthorized", never "middleware". This file is the guard.
 *
 * It lives under the Atlas tests because the Atlas domain is what these entries
 * exist for; it is a middleware test, not a lib test.
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

describe('routes the Atlas SSO needs open', () => {
  it.each([
    ['/api/auth/atlas/session', 'the session exchange: its caller is a page with no cookie yet'],
    ['/auth', 'the landing page Crazy Cake opens in a new window'],
    ['/dev/atlas-simulator', 'the simulator, whose whole scenario is "no session yet"'],
  ])('lets %s through without a session cookie', async (pathname, why) => {
    const res = await middleware(requestFor(pathname));

    expect(
      isPassThrough(res),
      `${pathname} must reach its handler with no session cookie - ${why}. The middleware ` +
        'gates every /api/* path on that cookie, so a missing entry answers 401 (or ' +
        'redirects to /login) before the handler ever runs, and nothing in the response ' +
        'points at the middleware'
    ).toBe(true);
  });

  it('is not satisfied by the /auth entry alone', async () => {
    // startsWith('/auth') does NOT cover '/api/auth/...'. This is the exact trap:
    // the list already had '/auth' when the SSO endpoint was still returning 401.
    const res = await middleware(requestFor('/api/auth/atlas/session'));

    expect(res.status).not.toBe(401);
  });
});

describe('what stays closed', () => {
  it('still answers 401 on a protected API route with no session', async () => {
    const res = await middleware(requestFor('/api/campaigns'));

    expect(res.status).toBe(401);
  });

  it('still redirects a protected page to /login with no session', async () => {
    const res = await middleware(requestFor('/films'));

    expect(res.headers.get('location')).toContain('/login');
  });

  it('does not publish sibling routes under /dev/', async () => {
    // The simulator is an exact-match entry, not a '/dev/' prefix: a prefix would
    // publish every future route under /dev/ the moment someone adds one.
    const res = await middleware(requestFor('/dev/something-else'));

    expect(
      isPassThrough(res),
      'only the simulator path itself is public; a /dev/ prefix would open every ' +
        'future dev route to the internet without anyone noticing'
    ).toBe(false);
  });

  it('does not publish a route that merely starts with the simulator path', async () => {
    const res = await middleware(requestFor('/dev/atlas-simulator-internal'));

    expect(isPassThrough(res)).toBe(false);
  });
});
