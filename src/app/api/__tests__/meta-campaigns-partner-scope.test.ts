/**
 * POST /api/meta/campaigns must create the campaign for the SESSION partner,
 * never for a partnerId supplied in the body (IDOR).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/logger', () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { default: l, createLogger: () => l };
});

const getPartnerFromRequest = vi.fn();
vi.mock('@/lib/auth', () => ({ getPartnerFromRequest: (...a: unknown[]) => getPartnerFromRequest(...a) }));

const createCampaign = vi.fn();
vi.mock('@/models/campaign', async () => {
  const actual = await vi.importActual<typeof import('@/models/campaign')>('@/models/campaign');
  return { ...actual, createCampaign: (...a: unknown[]) => createCampaign(...a) };
});
vi.mock('@/lib/firebase/admin', () => ({ adminDb: () => ({}) }));

const { POST } = await import('../meta/campaigns/route');

const PARTNER_A = 'partnerA';
const PARTNER_B = 'partnerB';
const BODY = {
  name: 'Spring push',
  objective: 'LANDING_PAGE_VIEW',
  budget: 500,
  startDate: '2026-11-01',
  endDate: '2026-12-01',
  filmMuviUuid: 'uuid-film',
};

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/meta/campaigns', { method: 'POST', body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  getPartnerFromRequest.mockResolvedValue({ id: PARTNER_A });
  createCampaign.mockImplementation(async (data: { partnerId: string }) => ({ id: 'c1', partnerId: data.partnerId }));
});

describe('POST /api/meta/campaigns partner scoping', () => {
  it('ignores a partnerId in the body that belongs to another partner', async () => {
    const res = await POST(req({ ...BODY, partnerId: PARTNER_B }));
    expect(res.status).toBe(201);
    expect(createCampaign).toHaveBeenCalledTimes(1);
    expect(createCampaign.mock.calls[0][0].partnerId).toBe(PARTNER_A);
    expect((await res.json()).partnerId).toBe(PARTNER_A);
  });

  it('uses the session partner when the body has no partnerId', async () => {
    const res = await POST(req(BODY));
    expect(res.status).toBe(201);
    expect(createCampaign.mock.calls[0][0].partnerId).toBe(PARTNER_A);
  });

  it('answers the same whether or not the foreign partner exists (no oracle)', async () => {
    const real = await POST(req({ ...BODY, partnerId: PARTNER_B }));
    const ghost = await POST(req({ ...BODY, partnerId: 'doesNotExist' }));
    expect(ghost.status).toBe(real.status);
  });

  it('returns 401 without a session and creates nothing', async () => {
    getPartnerFromRequest.mockResolvedValue(null);
    const res = await POST(req({ ...BODY, partnerId: PARTNER_B }));
    expect(res.status).toBe(401);
    expect(createCampaign).not.toHaveBeenCalled();
  });
});
