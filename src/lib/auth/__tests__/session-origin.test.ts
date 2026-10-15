/**
 * getPartnerFromRequest reports where the session came from, using only the
 * header the Edge middleware derives from the signed cookie. Anything other
 * than the exact value 'internal' is treated as SSO (fail closed).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeFirestore } from '@/test/firestore-fake';

const db = new FakeFirestore();
vi.mock('@/lib/firebase/admin', () => ({ adminDb: () => db }));

import { getPartnerFromRequest } from '../middleware';

function request(origin: string | null): NextRequest {
  const headers: Record<string, string> = { 'x-pijama-partner-id': 'pijamafilms' };
  if (origin !== null) headers['x-pijama-session-origin'] = origin;
  return new NextRequest('https://promote.pijamafilms.com/api/x', { headers });
}

describe('getPartnerFromRequest session origin', () => {
  beforeEach(() => {
    db.reset();
    const now = new Date('2026-01-01T00:00:00.000Z');
    db.write('partners/p1', { partnerId: 'pijamafilms', name: 'Pijama', createdAt: now, updatedAt: now }, false);
  });

  it('reports internal only for the exact value the middleware sets', async () => {
    expect((await getPartnerFromRequest(request('internal')))?.sessionOrigin).toBe('internal');
  });

  it.each([['sso'], ['Internal'], ['true'], [''], [null]])('reports sso for %o', async (value) => {
    expect((await getPartnerFromRequest(request(value)))?.sessionOrigin).toBe('sso');
  });
});
