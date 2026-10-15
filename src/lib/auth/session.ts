/**
 * Session Management
 *
 * Identity is provided by Firebase Auth. Once a Firebase ID token has been
 * verified server-side (see `@/lib/firebase/admin`), we mint our own signed
 * cookie so that server components and the Edge middleware can authorize
 * requests without loading the Admin SDK.
 */

import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';

const SESSION_COOKIE_NAME = 'pijama-session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

/**
 * Signing key for session cookies. There is deliberately no fallback: a
 * predictable secret would let anyone forge a session for any partner.
 */
function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      'SESSION_SECRET is not configured (minimum 32 characters required)'
    );
  }

  return new TextEncoder().encode(secret);
}

/**
 * SECURITY CONTRACT - the `uid` prefix.
 *
 * A session minted by the Atlas SSO route (`/api/auth/atlas/session`) has
 * `uid === "atlas:<partnerId>"`; in-house Firebase users have a Firebase uid
 * (no colon). `resolveCatalogueSource()` in `src/models/film.ts` reads this
 * prefix to choose between the partner's OWN catalogue and the GLOBAL MUVI one.
 * Changing the format on either side without the other gives every Atlas
 * session the whole catalogue. It is pinned by
 * `src/lib/atlas/__tests__/session-route.test.ts` and
 * `src/models/__tests__/film-catalogue-source.test.ts`.
 */
export interface SessionPayload {
  uid: string;
  email: string;
  name: string;
  partnerId: string;
  expiresAt: number;
}

/**
 * Create a signed session token
 */
export async function createSessionToken(payload: Omit<SessionPayload, 'expiresAt'>): Promise<string> {
  const expiresAt = Date.now() + SESSION_MAX_AGE * 1000;

  return new SignJWT({ ...payload, expiresAt })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresAt / 1000)
    .sign(getSecretKey());
}

/**
 * Verify and decode a session token
 */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Get current session from cookies (server-side)
 */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

  if (!sessionCookie?.value) {
    return null;
  }

  return verifySessionToken(sessionCookie.value);
}

/**
 * Set session cookie (server action)
 */
export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });
}

/**
 * Clear session cookie (server action)
 */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export { SESSION_COOKIE_NAME };
