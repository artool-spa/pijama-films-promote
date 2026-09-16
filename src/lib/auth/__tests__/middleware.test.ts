/**
 * Partner resolution from request headers.
 *
 * These tests exist because of a measured privilege-escalation hole: the Edge
 * middleware clones the INCOMING request headers before setting its own
 * (`src/middleware.ts`), and `getPartnerFromRequest` used to read a caller
 * supplied `x-partner-id` in preference to the id the middleware derived from
 * the signed session cookie. Nothing in this repository, in the nginx proxy or
 * in the hosting configuration ever produced that header, so its only possible
 * source was the caller.
 *
 * The invariant: the partner is whatever the SESSION says, and a request header
 * can never change it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeFirestore } from '@/test/firestore-fake';

const db = new FakeFirestore();

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: () => db,
}));

import { getPartnerFromRequest, getPartnerByPijamaIdFromRequest } from '../middleware';

const VICTIM_DOC_ID = 'victim-partner-doc-id';
const CALLER_DOC_ID = 'caller-partner-doc-id';

function seed(): void {
  const now = new Date('2026-01-01T00:00:00.000Z');

  db.write(
    `partners/${VICTIM_DOC_ID}`,
    { partnerId: 'pijamafilms', name: 'Victim Partner', createdAt: now, updatedAt: now },
    false
  );
  db.write(
    `partners/${CALLER_DOC_ID}`,
    { partnerId: 'caller-external-id', name: 'Caller Partner', createdAt: now, updatedAt: now },
    false
  );
}

function request(headers: Record<string, string>): NextRequest {
  return new NextRequest('https://promote.pijamafilms.com/api/partners', { headers });
}

describe('getPartnerFromRequest', () => {
  beforeEach(() => {
    db.reset();
    seed();
  });

  it('resolves the partner from the session-derived x-pijama-partner-id header', async () => {
    const partner = await getPartnerFromRequest(
      request({ 'x-pijama-partner-id': 'caller-external-id' })
    );

    expect(partner?.id).toBe(CALLER_DOC_ID);
  });

  it('returns null when no session-derived header is present', async () => {
    expect(await getPartnerFromRequest(request({}))).toBeNull();
  });

  // The escalation itself. `x-partner-id` named the victim's INTERNAL document
  // id, which is exactly what GET /api/partners hands to any caller.
  it('ignores a caller-supplied x-partner-id header', async () => {
    const partner = await getPartnerFromRequest(
      request({
        'x-pijama-partner-id': 'caller-external-id',
        'x-partner-id': VICTIM_DOC_ID,
      })
    );

    expect(partner?.id).toBe(CALLER_DOC_ID);
    expect(partner?.partnerId).toBe('caller-external-id');
  });

  // Without this case the header could still be used to conjure a partner out
  // of nothing on any route the middleware lets through without a session.
  it('does not authenticate on x-partner-id alone', async () => {
    expect(await getPartnerFromRequest(request({ 'x-partner-id': VICTIM_DOC_ID }))).toBeNull();
  });

  // `pijamafilms` is SPECIAL_PARTNER_ID: becoming it bypasses every access
  // check in the codebase by design, so it gets its own case.
  it('cannot be used to become the special partner', async () => {
    const partner = await getPartnerFromRequest(
      request({
        'x-pijama-partner-id': 'caller-external-id',
        'x-partner-id': VICTIM_DOC_ID,
      })
    );

    expect(partner?.partnerId).not.toBe('pijamafilms');
  });
});

describe('getPartnerByPijamaIdFromRequest', () => {
  beforeEach(() => {
    db.reset();
    seed();
  });

  it('reads only the session-derived header', async () => {
    const partner = await getPartnerByPijamaIdFromRequest(
      request({
        'x-pijama-partner-id': 'caller-external-id',
        'x-partner-id': VICTIM_DOC_ID,
      })
    );

    expect(partner?.id).toBe(CALLER_DOC_ID);
  });
});
