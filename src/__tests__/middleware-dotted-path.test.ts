/**
 * Regression: the middleware used to let any path containing a '.' through with
 * NextResponse.next() — no session required, and the caller's headers left
 * intact. Dynamic API segments accept dots (/api/meta/campaigns/x.y), so an
 * unauthenticated request carrying a forged `x-pijama-partner-id: pijamafilms`
 * reached the handler as the internal admin. The public-route and static
 * early returns had the same flaw: they forwarded forged internal headers.
 *
 * Next encodes a request-header override as `x-middleware-request-*` headers
 * plus an `x-middleware-override-headers` manifest. A plain next() has no
 * manifest, i.e. the caller's headers go through verbatim.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.stubEnv('SESSION_SECRET', 'test-session-secret-at-least-32-characters-long');

import { middleware } from '../middleware';

const FORGED = {
  'x-pijama-partner-id': 'pijamafilms',
  'x-partner-id': 'victim-doc-id',
  'x-user-name': 'Forged',
};

function run(path: string): Promise<Response> {
  return middleware(new NextRequest(`https://promote.pijamafilms.com${path}`, { headers: FORGED }));
}

/** True when the forged internal headers can still reach the handler. */
function forgedHeadersSurvive(response: Response): boolean {
  const manifest = response.headers.get('x-middleware-override-headers');
  if (manifest === null) return response.headers.has('x-middleware-next'); // plain next(): headers untouched
  return Object.keys(FORGED).some((h) => manifest.split(',').includes(h));
}

describe('API paths with a dot in a segment still require a session', () => {
  it.each([
    ['/api/meta/campaigns/x.y'],
    ['/api/meta/campaigns/x.y/edit'],
    ['/api/films/a.b/images'],
    ['/api/google/campaigns/x.y/sync'],
    ['/api/partners/a.b'],
    ['/api/anything.json'],
    ['/api/meta/campaigns/logo.png'], // looks like a static asset, is a dynamic segment
  ])('%s without a cookie answers 401 and never reaches the handler', async (path) => {
    const response = await run(path);

    expect(response.status).toBe(401);
    expect(response.headers.has('x-middleware-next')).toBe(false);
  });
});

describe('forged internal headers never survive a pass-through', () => {
  it.each([
    ['/api/auth/login'],
    ['/api/auth/atlas/session'],
    ['/api/cron/sync-pending-campaigns'],
    ['/api/internal/sync-campaign'],
    ['/api/webhooks/stripe'],
    ['/login'],
    ['/privacy-policy'],
    ['/logo_pijama.png'],
    ['/_next/static/chunk.js'],
  ])('%s', async (path) => {
    const response = await run(path);

    expect(response.status, 'a pass-through is expected here').toBe(200);
    expect(forgedHeadersSurvive(response)).toBe(false);
  });
});
