/**
 * Campaign-by-id routes must act only on campaigns the session partner owns.
 * A foreign campaign answers 404 (never 403, so existence is not revealed) and
 * nothing is written, pushed to an ad platform, or deleted.
 *
 * `pijamafilms` is the internal-admin partner and may manage any campaign (that
 * is `canManageCampaign`'s deliberate bypass). An SSO partner, whose
 * `partnerId` is the Console one, must NOT inherit it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/logger', () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { default: l, createLogger: () => l };
});
vi.mock('@/lib/firebase/admin', () => ({ adminDb: () => ({}) }));

const OWNER = { id: 'docA', partnerId: 'ext-a', name: 'A' };
const OTHER = { id: 'docB', partnerId: 'ext-b', name: 'B' };
const ADMIN = { id: 'docAdmin', partnerId: 'pijamafilms', name: 'Pijama', sessionOrigin: 'internal' };
// An SSO session: `atlas:<id>` uid, Console partnerId, its own partner document.
// Console returning the reserved id must still not be admin.
const SSO_RESERVED = { id: 'docSsoAdmin', partnerId: 'pijamafilms', name: 'SSO', sessionOrigin: 'sso' };
const SSO = { id: 'docSso', partnerId: 'console-42', name: 'SSO' };

let session: { id: string; partnerId: string; name: string; sessionOrigin?: string } | null = OWNER;
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/access-control')>('@/lib/auth/access-control');
  return { canManageCampaign: actual.canManageCampaign, getPartnerFromRequest: async () => session };
});

const campaign = {
  id: 'camp1',
  partnerId: OWNER.id,
  name: 'Camp',
  status: 'DRAFT',
  platforms: ['GOOGLE', 'META'],
  partner: { name: 'A' },
  budget: 100,
  budgetType: 'LIFETIME',
  startDate: new Date('2026-11-01'),
  endDate: null,
  targetCountries: ['US'],
  targetAgeMin: 18,
  targetAgeMax: 65,
  targetGenders: [],
  filmGenres: [],
  includeBaseAudiences: true,
  googleCampaignId: null,
  metaCampaignId: 'm1',
};

const writes = {
  updateCampaign: vi.fn(),
  deleteCampaign: vi.fn(),
  updateCampaignBudgetAndEndDate: vi.fn(),
  markGoogleCampaignSynced: vi.fn(),
  markGoogleCampaignError: vi.fn(),
  platform: vi.fn(),
};
vi.mock('@/models/campaign', async () => {
  const actual = await vi.importActual<typeof import('@/models/campaign')>('@/models/campaign');
  return {
    ...actual,
    getCampaignById: async () => campaign,
    updateCampaign: (...a: unknown[]) => writes.updateCampaign(...a),
    deleteCampaign: (...a: unknown[]) => writes.deleteCampaign(...a),
    updateCampaignBudgetAndEndDate: (...a: unknown[]) => writes.updateCampaignBudgetAndEndDate(...a),
    markGoogleCampaignSynced: (...a: unknown[]) => writes.markGoogleCampaignSynced(...a),
    markGoogleCampaignError: (...a: unknown[]) => writes.markGoogleCampaignError(...a),
  };
});
vi.mock('#google', () => ({
  google: {},
  GoogleAdsApiError: class extends Error {},
  buildGoogleTargeting: async () => ({}),
  createYouTubeCampaignWithAdGroup: async (...a: unknown[]) => {
    writes.platform(...a);
    return { campaignResourceName: 'c', adGroupResourceName: 'g' };
  },
  updateCampaignBudget: (...a: unknown[]) => writes.platform(...a),
  updateCampaignEndDate: (...a: unknown[]) => writes.platform(...a),
}));
vi.mock('#meta', () => ({
  meta: {},
  updateCampaign: (...a: unknown[]) => writes.platform(...a),
  updateAdSet: (...a: unknown[]) => writes.platform(...a),
}));

const googleId = await import('../google/campaigns/[id]/route');
const googleSync = await import('../google/campaigns/[id]/sync/route');
const metaId = await import('../meta/campaigns/[id]/route');
const metaEdit = await import('../meta/campaigns/[id]/edit/route');
const genericId = await import('../campaigns/[id]/route');

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
interface Case {
  name: string;
  handler: Handler;
  method: string;
  body?: unknown;
  mutates: boolean;
}

const CASES: Case[] = [
  { name: 'google/campaigns/[id] GET', handler: googleId.GET, method: 'GET', mutates: false },
  { name: 'google/campaigns/[id] PATCH', handler: googleId.PATCH, method: 'PATCH', body: { name: 'x' }, mutates: true },
  { name: 'google/campaigns/[id] DELETE', handler: googleId.DELETE, method: 'DELETE', mutates: true },
  { name: 'google/campaigns/[id]/sync POST', handler: googleSync.POST, method: 'POST', mutates: true },
  { name: 'meta/campaigns/[id] GET', handler: metaId.GET, method: 'GET', mutates: false },
  { name: 'meta/campaigns/[id] PATCH', handler: metaId.PATCH, method: 'PATCH', body: { name: 'x' }, mutates: true },
  { name: 'meta/campaigns/[id] DELETE', handler: metaId.DELETE, method: 'DELETE', mutates: true },
  { name: 'meta/campaigns/[id]/edit PATCH', handler: metaEdit.PATCH, method: 'PATCH', body: { budget: 5 }, mutates: true },
  { name: 'campaigns/[id] DELETE', handler: genericId.DELETE, method: 'DELETE', mutates: true },
];

function call(c: Case): Promise<Response> {
  const req = new NextRequest('http://localhost/api/x', {
    method: c.method,
    body: c.body === undefined ? undefined : JSON.stringify(c.body),
  });
  return c.handler(req, { params: Promise.resolve({ id: 'camp1' }) });
}
function nothingWritten(): boolean {
  return Object.values(writes).every((w) => w.mock.calls.length === 0);
}

beforeEach(() => {
  vi.clearAllMocks();
  session = OWNER;
  writes.updateCampaign.mockResolvedValue(campaign);
  writes.deleteCampaign.mockResolvedValue(campaign);
  writes.updateCampaignBudgetAndEndDate.mockResolvedValue(campaign);
});

describe.each(CASES)('$name', (c) => {
  it('404s for another partner and writes/pushes nothing', async () => {
    session = OTHER;
    const res = await call(c);
    expect(res.status).toBe(404);
    expect(nothingWritten()).toBe(true);
  });

  it('404s for an SSO partner: the Console partnerId earns no admin bypass', async () => {
    session = SSO;
    const res = await call(c);
    expect(res.status).toBe(404);
    expect(nothingWritten()).toBe(true);
  });

  it('404s for a session of SSO origin even when its partnerId is pijamafilms', async () => {
    session = SSO_RESERVED;
    const res = await call(c);
    expect(res.status).toBe(404);
    expect(nothingWritten()).toBe(true);
  });

  it('401s without a session', async () => {
    session = null;
    const res = await call(c);
    expect(res.status).toBe(401);
    expect(nothingWritten()).toBe(true);
  });

  it('lets the owner through', async () => {
    const res = await call(c);
    expect(res.status).toBeLessThan(300);
    if (c.mutates) expect(nothingWritten()).toBe(false);
  });

  it('lets the pijamafilms admin through on a campaign it does not own', async () => {
    session = ADMIN;
    const res = await call(c);
    expect(res.status).toBeLessThan(300);
    if (c.mutates) expect(nothingWritten()).toBe(false);
  });
});

describe('PATCH bodies are validated before anything is written', () => {
  it('google/campaigns/[id] PATCH answers 400 for an invalid body', async () => {
    const res = await call({ ...CASES[1], body: { budget: -5 } });
    expect(res.status).toBe(400);
    expect(writes.updateCampaign).not.toHaveBeenCalled();
  });
});
