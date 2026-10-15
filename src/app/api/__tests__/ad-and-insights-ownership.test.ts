/**
 * Ad approval and insights routes (Meta + Google) must act only on ads and
 * campaigns the session partner owns. A foreign id answers 404 (never 403) and
 * the ad platform is never queried, nothing is written.
 *
 * `pijamafilms` is the internal-admin partner (canManageCampaign's bypass); an
 * SSO partner, whose partnerId is the Console one, must NOT inherit it.
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
const ADMIN = { id: 'docAdmin', partnerId: 'pijamafilms', name: 'Pijama' };
const SSO = { id: 'docSso', partnerId: 'console-42', name: 'SSO' };

let session: typeof OWNER | null = OWNER;
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/access-control')>('@/lib/auth/access-control');
  return { canManageCampaign: actual.canManageCampaign, getPartnerFromRequest: async () => session };
});

// Entities are "unsynced" for the insights owner case (handler answers 200 with
// no platform call) and synced for the approval owner case.
let synced = false;
const calls = { platform: vi.fn(), updateAdApproval: vi.fn(), recompute: vi.fn() };

const ad = () => ({
  id: 'ad1',
  campaignId: 'camp1',
  metaAdId: synced ? 'm-ad' : null,
  googleAdId: synced ? 'g-ad' : null,
  campaign: { id: 'camp1', partnerId: OWNER.id, startDate: new Date('2026-11-01'), endDate: null },
});
const campaign = () => ({
  id: 'camp1',
  partnerId: OWNER.id,
  platforms: ['META', 'GOOGLE'],
  metaCampaignId: synced ? 'm1' : null,
  googleCampaignId: synced ? 'g1' : null,
  ads: [],
  startDate: new Date('2026-11-01'),
  endDate: null,
});

vi.mock('@/models/ad', () => ({
  getAdById: async () => ad(),
  updateAdApproval: (...a: unknown[]) => calls.updateAdApproval(...a),
}));
vi.mock('@/models/campaign', () => ({
  getCampaignById: async () => campaign(),
  recomputeApprovalSummary: (...a: unknown[]) => calls.recompute(...a),
}));

const { platformFn, metaMock } = vi.hoisted(() => {
  const platformFn = (result: unknown) => async (...a: unknown[]) => {
    (globalThis as { __platformCalls?: (...x: unknown[]) => void }).__platformCalls?.(...a);
    return result;
  };
  const metaMock = () => ({
    meta: {},
    MetaApiError: class extends Error {},
    getInsights: platformFn([]),
    getAdApprovalStatus: platformFn({ effective_status: 'ACTIVE' }),
  });
  return { platformFn, metaMock };
});
(globalThis as { __platformCalls?: (...x: unknown[]) => void }).__platformCalls = (...a) => calls.platform(...a);
vi.mock('#meta', metaMock);
vi.mock('@/lib/meta', metaMock);
vi.mock('#google', () => ({
  google: {},
  GoogleAdsApiError: class extends Error {},
  getAdInsights: platformFn({}),
  getYouTubeInsights: platformFn({}),
  getDisplayInsights: platformFn({}),
  getAdApprovalStatuses: platformFn([{ approvalStatus: 'APPROVED' }]),
}));

const metaAdApproval = await import('../meta/ads/[id]/approval/route');
const googleAdApproval = await import('../google/ads/[id]/approval/route');
const metaAdInsights = await import('../meta/ads/[id]/insights/route');
const googleAdInsights = await import('../google/ads/[id]/insights/route');
const metaCampInsights = await import('../meta/campaigns/[id]/insights/route');
const googleCampInsights = await import('../google/campaigns/[id]/insights/route');

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const CASES: Array<{ name: string; handler: Handler; writes: boolean }> = [
  { name: 'meta/ads/[id]/approval GET', handler: metaAdApproval.GET, writes: true },
  { name: 'google/ads/[id]/approval GET', handler: googleAdApproval.GET, writes: true },
  { name: 'meta/ads/[id]/insights GET', handler: metaAdInsights.GET, writes: false },
  { name: 'google/ads/[id]/insights GET', handler: googleAdInsights.GET, writes: false },
  { name: 'meta/campaigns/[id]/insights GET', handler: metaCampInsights.GET, writes: false },
  { name: 'google/campaigns/[id]/insights GET', handler: googleCampInsights.GET, writes: false },
];

function call(handler: Handler): Promise<Response> {
  return handler(new NextRequest('http://localhost/api/x'), { params: Promise.resolve({ id: 'x1' }) });
}
function untouched(): boolean {
  return Object.values(calls).every((c) => c.mock.calls.length === 0);
}

beforeEach(() => {
  vi.clearAllMocks();
  session = OWNER;
  synced = true;
  calls.updateAdApproval.mockResolvedValue({ id: 'ad1' });
  calls.recompute.mockResolvedValue(undefined);
});

describe.each(CASES)('$name', ({ handler, writes }) => {
  it('404s for another partner and never queries the platform or writes', async () => {
    session = OTHER;
    const res = await call(handler);
    expect(res.status).toBe(404);
    expect(untouched()).toBe(true);
  });

  it('404s for an SSO partner: the Console partnerId earns no admin bypass', async () => {
    session = SSO;
    const res = await call(handler);
    expect(res.status).toBe(404);
    expect(untouched()).toBe(true);
  });

  it('401s without a session', async () => {
    session = null;
    const res = await call(handler);
    expect(res.status).toBe(401);
    expect(untouched()).toBe(true);
  });

  it('lets the owner through', async () => {
    synced = writes; // insights: unsynced -> 200 without hitting the platform
    const res = await call(handler);
    expect(res.status).toBe(200);
    if (writes) expect(calls.updateAdApproval).toHaveBeenCalledTimes(1);
  });

  it('lets the pijamafilms admin through on an entity it does not own', async () => {
    session = ADMIN;
    synced = writes;
    const res = await call(handler);
    expect(res.status).toBe(200);
    if (writes) expect(calls.updateAdApproval).toHaveBeenCalledTimes(1);
  });
});
