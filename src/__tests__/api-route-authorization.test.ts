/**
 * Structural guard: no route handler may MUTATE state without referring to an
 * authorization mechanism.
 *
 * This is a lint in test form, in the genre of `apphosting-config.test.ts`. It
 * exists because `DELETE /api/upload/[key]` sat in the tree deleting arbitrary
 * objects out of Cloud Storage by key, with no auth import of any kind, and
 * nothing read the file closely enough to notice. A per-route review finds that
 * once; a test finds it every time someone adds the next one.
 *
 * What it does NOT check: that the authorization is correct, or that it covers
 * every branch. A file merely has to show that it thought about the question.
 * Ownership checks are a separate and much harder problem — several routes name
 * one of these helpers and still fail to verify that the resource belongs to
 * the caller. This catches only the zero-controls case, which is the one that
 * needs no attacker sophistication at all.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const API_ROOT = path.resolve(__dirname, '../app/api');

const MUTATING_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'] as const;

/**
 * Any of these being mentioned counts as "this file authorizes somehow". The
 * list spans the four legitimate callers of this backend: a browser session, a
 * Google-signed OIDC token, a Firebase ID token, and Stripe's webhook
 * signature.
 */
const AUTHORIZATION_MARKERS = [
  'getPartnerFromRequest',
  'getPartnerByPijamaIdFromRequest',
  'getSession',
  'authorizeInternalRequest',
  'verifyOidcCaller',
  'verifyIdToken',
  'constructEvent',
  'isPartnerAllowed',
];

/**
 * Routes that mutate without authorizing, and may.
 *
 * Every entry needs a reason. An entry without one is a gap someone decided not
 * to look at, and this list must not become the place those go to be forgotten.
 */
const ALLOWED_WITHOUT_AUTHORIZATION: Record<string, string> = {
  'auth/logout/route.ts':
    'Clears the session cookie. Requiring a valid session to log out would ' +
    'strand a user holding a broken one, and the only effect is on the ' +
    'caller’s own browser.',

  'copies/generate/route.ts':
    'KNOWN GAP, not an exemption. Any caller can generate ad copy for any ' +
    'film id, which reaches Muvi and Gemini and spends quota. It is listed ' +
    'here so this guard can protect the rest of the tree rather than being ' +
    'deleted wholesale; remove the entry when the route is fixed.',
};

function routeFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);

    if (statSync(full).isDirectory()) {
      routeFiles(full, found);
    } else if (entry === 'route.ts') {
      found.push(full);
    }
  }

  return found;
}

function mutatingMethods(source: string): string[] {
  return MUTATING_METHODS.filter((method) =>
    new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`).test(source)
  );
}

describe('API route authorization', () => {
  const files = routeFiles(API_ROOT);

  it('finds the route files', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it('has no mutating handler without an authorization mechanism', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const relative = path.relative(API_ROOT, file);
      const source = readFileSync(file, 'utf8');
      const methods = mutatingMethods(source);

      if (methods.length === 0) continue;
      if (relative in ALLOWED_WITHOUT_AUTHORIZATION) continue;
      if (AUTHORIZATION_MARKERS.some((marker) => source.includes(marker))) continue;

      offenders.push(`${relative} exports ${methods.join(', ')}`);
    }

    expect(offenders).toEqual([]);
  });

  // Keeps the exemption list honest in the other direction: an entry whose
  // route has since been fixed or removed should be deleted, not left behind
  // quietly widening the guard.
  it('has no stale entries in the exemption list', () => {
    const stale = Object.keys(ALLOWED_WITHOUT_AUTHORIZATION).filter((relative) => {
      const full = path.join(API_ROOT, relative);

      try {
        const source = readFileSync(full, 'utf8');
        const stillNeedsIt =
          mutatingMethods(source).length > 0 &&
          !AUTHORIZATION_MARKERS.some((marker) => source.includes(marker));

        return !stillNeedsIt;
      } catch {
        return true; // the route is gone
      }
    });

    expect(stale).toEqual([]);
  });
});
