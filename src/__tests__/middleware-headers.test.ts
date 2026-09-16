/**
 * The Edge middleware's request-header override set.
 *
 * `src/lib/auth/__tests__/middleware.test.ts` covers the read side: partner
 * resolution ignores `x-partner-id`. This file covers the other layer — the
 * header must not reach a handler at all, so that reintroducing the read
 * cannot on its own reopen the escalation.
 *
 * Next encodes the override set on the response as `x-middleware-request-*`
 * headers plus an `x-middleware-override-headers` manifest, which is what these
 * assertions read.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';

const SESSION_SECRET = 'test-session-secret-at-least-32-characters-long';

vi.stubEnv('SESSION_SECRET', SESSION_SECRET);

import { middleware } from '../middleware';

let cookie: string;

beforeAll(async () => {
  cookie = await new SignJWT({
    uid: 'uid-1',
    email: 'caller@example.com',
    name: 'Caller',
    partnerId: 'caller-external-id',
    expiresAt: Date.now() + 60_000,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SESSION_SECRET));
});

function overriddenHeader(response: Response, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name}`);
}

async function run(extraHeaders: Record<string, string>): Promise<Response> {
  const request = new NextRequest('https://promote.pijamafilms.com/api/partners', {
    headers: extraHeaders,
  });

  // Set through the cookie jar rather than as a `cookie:` header: NextRequest
  // does not parse an inbound cookie header into `request.cookies` here, so the
  // header form silently produces an unauthenticated request and every
  // assertion below would pass against a 401 that proves nothing.
  request.cookies.set('pijama-session', cookie);

  return middleware(request);
}

describe('middleware request-header overrides', () => {
  it('sets the partner id from the session cookie', async () => {
    const response = await run({});

    expect(overriddenHeader(response, 'x-pijama-partner-id')).toBe('caller-external-id');
  });

  // The escalation vector: the clone carries caller headers verbatim, and
  // `x-partner-id` had no session-derived counterpart to overwrite it.
  it('strips a caller-supplied x-partner-id', async () => {
    const response = await run({ 'x-partner-id': 'victim-partner-doc-id' });

    expect(overriddenHeader(response, 'x-partner-id')).toBeNull();
    expect(response.headers.get('x-middleware-override-headers')).not.toContain('x-partner-id');
  });

  it('overrides a caller-supplied x-pijama-partner-id with the session value', async () => {
    const response = await run({ 'x-pijama-partner-id': 'pijamafilms' });

    expect(overriddenHeader(response, 'x-pijama-partner-id')).toBe('caller-external-id');
  });

  it('overrides a caller-supplied x-user-name with the session value', async () => {
    const response = await run({ 'x-user-name': 'Someone Else' });

    expect(overriddenHeader(response, 'x-user-name')).toBe('Caller');
  });

  // The clone exists so that the cookie, user-agent and the rest survive.
  // Stripping must stay surgical.
  it('leaves unrelated caller headers intact', async () => {
    const response = await run({ 'user-agent': 'probe/1.0' });

    expect(overriddenHeader(response, 'user-agent')).toBe('probe/1.0');
  });
});
