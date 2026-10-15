/**
 * The Edge middleware derives x-pijama-session-origin from the SIGNED cookie's
 * uid (`atlas:<id>` = SSO). A caller can never set it.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';

const SESSION_SECRET = 'test-session-secret-at-least-32-characters-long';
vi.stubEnv('SESSION_SECRET', SESSION_SECRET);

import { middleware } from '../middleware';

async function cookieFor(uid: string): Promise<string> {
  return new SignJWT({
    uid,
    email: 'x@example.com',
    name: 'X',
    partnerId: 'pijamafilms',
    expiresAt: Date.now() + 60_000,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SESSION_SECRET));
}

async function origin(uid: string, callerHeader?: string): Promise<string | null> {
  const request = new NextRequest('https://promote.pijamafilms.com/api/partners', {
    headers: callerHeader ? { 'x-pijama-session-origin': callerHeader } : {},
  });
  request.cookies.set('pijama-session', await cookieFor(uid));
  const response = await middleware(request);
  return response.headers.get('x-middleware-request-x-pijama-session-origin');
}

describe('x-pijama-session-origin', () => {
  it('is internal for a Firebase-uid session', async () => {
    expect(await origin('firebase-uid-1')).toBe('internal');
  });

  it('is sso for an atlas: session, even with the reserved partnerId', async () => {
    expect(await origin('atlas:pijamafilms')).toBe('sso');
  });

  it('ignores a caller-supplied value', async () => {
    expect(await origin('atlas:pijamafilms', 'internal')).toBe('sso');
  });
});
