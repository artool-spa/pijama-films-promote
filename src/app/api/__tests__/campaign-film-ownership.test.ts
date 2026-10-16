/**
 * Campaign-creating routes, draft saving and copy generation must act only on
 * films in the SESSION's catalogue. Partner B naming partner A's film gets 404
 * and nothing is written, no MUVI availability call is made and no Gemini quota
 * is spent. A catalogue that cannot be read is 503, never access. Internal
 * users keep the global catalogue.
 *
 * Real: film model, film-access, campaign model (over the Firestore fake) and
 * the routes. Faked: session, Console catalogue, MUVI, Gemini, ad/sync layers.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeFirestore } from '@/test/firestore-fake';

const db = new FakeFirestore();
vi.mock('@/lib/firebase/admin', () => ({ adminDb: () => db }));
vi.mock('@/lib/logger', () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { default: l, createLogger: () => l };
});

const assertFilmPromotable = vi.fn(async () => undefined);
vi.mock('@/lib/muvi/availability', async (orig) => ({
  ...(await orig<typeof import('@/lib/muvi/availability')>()),
  assertFilmPromotable: (...a: unknown[]) => assertFilmPromotable(...(a as [])),
}));
const getMovieDetails = vi.fn(async () => ({ content_uuid: 'x', content_name: 'T' }));
vi.mock('#muvi', () => ({ muvi: {}, getMovies: vi.fn(), getMovieDetails: (...a: unknown[]) => getMovieDetails(...(a as [])), MuviApiError: class extends Error {} }));
const generateCopiesForFilm = vi.fn(async () => ({ es: [] }));
vi.mock('#gemini', () => ({
  getGeminiClient: () => ({}),
  generateCopiesForFilm: (...a: unknown[]) => generateCopiesForFilm(...(a as [])),
  CopyGenerationRequestSchema: { safeParse: (b: { filmId: string }) => ({ success: true, data: { filmId: b.filmId, languages: ['es'] } }) },
  GeminiApiError: class extends Error {},
  GeminiValidationError: class extends Error {},
}));

type TestSession = { uid: string; partnerId: string } | null;
let session: TestSession = null;
vi.mock('@/lib/auth/session', () => ({ getSession: async () => session }));
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/access-control')>('@/lib/auth/access-control');
  return {
    canManageCampaign: actual.canManageCampaign,
    getPartnerFromRequest: async () =>
      session ? { id: `doc-${session.partnerId}`, partnerId: session.partnerId, name: 'P', sessionOrigin: session.uid.startsWith('atlas:') ? 'sso' : 'internal' } : null,
  };
});

const fetchPartnerCatalogue = vi.fn();
vi.mock('@/lib/atlas/external-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/atlas/external-api')>('@/lib/atlas/external-api');
  return { ...actual, fetchPartnerCatalogue: (...a: unknown[]) => fetchPartnerCatalogue(...a) };
});
vi.mock('@/models/partner', () => ({
  getPartnerById: async () => ({ id: 'x' }),
  getPartnerRecordByPartnerId: async () => null,
}));
vi.mock('@/models/ad', () => ({ createAdsForCampaign: vi.fn(async () => []), getAdsByCampaignId: vi.fn() }));
vi.mock('@/lib/events', () => ({ publish: vi.fn() }));
vi.mock('#meta', () => ({ MetaApiError: class extends Error {} }));
vi.mock('#google', () => ({ GoogleAdsApiError: class extends Error {} }));
vi.mock('@/lib/campaigns/sync', () => ({
  areMetaAssetsReady: vi.fn(), areGoogleImageAssetsReady: vi.fn(), syncCampaignToMeta: vi.fn(), syncCampaignToGoogle: vi.fn(),
}));
vi.mock('@/lib/campaigns/error-messages', () => ({ toFriendlyCampaignError: () => 'x' }));
vi.mock('@/lib/campaigns/budget-validation', () => ({ validateCampaignBudget: () => ({ valid: true }) }));

const getCampaignById = vi.fn();
const updateCampaign = vi.fn();
vi.mock('@/models/campaign', async () => {
  const actual = await vi.importActual<typeof import('@/models/campaign')>('@/models/campaign');
  return {
    ...actual,
    getCampaignById: (...a: unknown[]) => getCampaignById(...a),
    updateCampaign: (...a: unknown[]) => updateCampaign(...a),
    markCampaignPendingAssets: vi.fn(),
    getCampaignsByFilmMuviUuid: async () => [],
  };
});

const metaSimple = await import('../meta/campaigns/route');
const googleSimple = await import('../google/campaigns/route');
const metaSync = await import('../meta/campaigns/create-and-sync/route');
const googleSync = await import('../google/campaigns/create-and-sync/route');
const draft = await import('../campaigns/draft/route');
const copies = await import('../copies/generate/route');

const FILM_A = 'uuid-film-a';
const FILM_B = 'uuid-film-b';
const CATALOGUES: Record<string, string[]> = { 'partner-a': [FILM_A], 'partner-b': [FILM_B] };
const DRAFT_ID = 'a'.repeat(20);

const BODY = (film: string) => ({
  name: 'Spring push', objective: 'LANDING_PAGE_VIEW', budget: 500,
  startDate: '2026-11-01', endDate: '2026-12-01', filmMuviUuid: film,
});
const SYNC_BODY = (film: string) => ({
  ...BODY(film),
  ads: [{ name: 'Ad', headlines: ['h'], bodies: ['b'], linkUrl: 'https://example.com/watch', imageIds: ['img1'] }],
});
const DRAFT_BODY = (film: string) => ({
  campaignData: { name: 'D', budget: 10, startDate: '2026-11-01', filmMuviUuid: film },
  formState: {},
});
const req = (body: unknown) => new NextRequest('http://localhost/api/x', { method: 'POST', body: JSON.stringify(body) });

type Case = { name: string; run: (film: string) => Promise<Response> };
const CASES: Case[] = [
  { name: 'POST meta/campaigns', run: (f) => metaSimple.POST(req(BODY(f))) },
  { name: 'POST google/campaigns', run: (f) => googleSimple.POST(req(BODY(f))) },
  { name: 'POST meta create-and-sync (new)', run: (f) => metaSync.POST(req(SYNC_BODY(f))) },
  { name: 'POST google create-and-sync (new)', run: (f) => googleSync.POST(req(SYNC_BODY(f))) },
  { name: 'POST campaigns/draft (create)', run: (f) => draft.POST(req(DRAFT_BODY(f))) },
  { name: 'POST copies/generate', run: (f) => copies.POST(req({ filmId: f })) },
];
const campaignDocs = () => [...db.store.keys()].filter((k) => k.startsWith('campaigns/'));
const nothingHappened = () => {
  expect(campaignDocs()).toEqual([]);
  expect(assertFilmPromotable).not.toHaveBeenCalled();
  expect(getMovieDetails).not.toHaveBeenCalled();
  expect(generateCopiesForFilm).not.toHaveBeenCalled();
  expect(updateCampaign).not.toHaveBeenCalled();
};
const PASSED_GATE = (s: number) => ![401, 404, 503].includes(s);

beforeEach(() => {
  vi.clearAllMocks();
  db.reset();
  session = { uid: 'atlas:partner-a', partnerId: 'partner-a' };
  fetchPartnerCatalogue.mockImplementation(async (partnerId: string) => ({
    partner: { partnerId, name: partnerId },
    movies: (CATALOGUES[partnerId] ?? []).map((u) => ({
      _id: u, muviContentUuid: u, originalTitle: 'Same Title', genre: [], directors: [], cast: [], assets: [],
    })),
  }));
});

describe.each(CASES)('$name', ({ run }) => {
  it("answers 404 and does nothing when B names A's film", async () => {
    session = { uid: 'atlas:partner-b', partnerId: 'partner-b' };
    expect((await run(FILM_A)).status).toBe(404);
    nothingHappened();
  });

  it('lets the owner through', async () => {
    const res = await run(FILM_A);
    expect(PASSED_GATE(res.status)).toBe(true);
  });

  it('answers 401 without a session', async () => {
    session = null;
    expect((await run(FILM_A)).status).toBe(401);
    nothingHappened();
  });

  it('answers 503 (not access) when the catalogue API is down', async () => {
    const { AtlasCatalogError } = await import('@/lib/atlas/external-api');
    fetchPartnerCatalogue.mockRejectedValue(new AtlasCatalogError('unavailable', 'down'));
    expect((await run(FILM_A)).status).toBe(503);
    nothingHappened();
  });

  it('lets an internal user through without asking Console', async () => {
    session = { uid: 'firebase-uid-1', partnerId: 'pijamafilms' };
    expect(PASSED_GATE((await run(FILM_A)).status)).toBe(true);
    expect(fetchPartnerCatalogue).not.toHaveBeenCalled();
  });
});

describe('promoting or updating a draft uses the film STORED on the draft', () => {
  // B's own draft, but stored against a film that is not in B's catalogue.
  const FOREIGN_DRAFT = { id: DRAFT_ID, partnerId: 'doc-partner-b', filmMuviUuid: FILM_A };

  it.each([
    ['meta create-and-sync', metaSync.POST],
    ['google create-and-sync', googleSync.POST],
  ])('%s: 404, draft untouched, MUVI not asked', async (_n, POST) => {
    session = { uid: 'atlas:partner-b', partnerId: 'partner-b' };
    getCampaignById.mockResolvedValue(FOREIGN_DRAFT);
    // The body claims B's own film; the stored one is what counts.
    const res = await POST(req({ ...SYNC_BODY(FILM_B), draftId: DRAFT_ID }));
    expect(res.status).toBe(404);
    expect(updateCampaign).not.toHaveBeenCalled();
    expect(assertFilmPromotable).not.toHaveBeenCalled();
  });

  it('campaigns/draft update: 404 on a foreign film stored on the draft', async () => {
    session = { uid: 'atlas:partner-b', partnerId: 'partner-b' };
    getCampaignById.mockResolvedValue(FOREIGN_DRAFT);
    const res = await draft.POST(req({ ...DRAFT_BODY(FILM_B), draftId: DRAFT_ID }));
    expect(res.status).toBe(404);
    expect(updateCampaign).not.toHaveBeenCalled();
  });

  it('campaigns/draft update: 404 when the draft belongs to ANOTHER partner (campaign IDOR)', async () => {
    session = { uid: 'atlas:partner-b', partnerId: 'partner-b' };
    // The stored film IS in B's catalogue, so only the partner check can refuse this.
    getCampaignById.mockResolvedValue({ id: DRAFT_ID, partnerId: 'doc-partner-a', filmMuviUuid: FILM_B });
    const res = await draft.POST(req({ ...DRAFT_BODY(FILM_B), draftId: DRAFT_ID }));
    expect(res.status).toBe(404);
    expect(updateCampaign).not.toHaveBeenCalled();
  });

  it('campaigns/draft update: the owner can update their own draft', async () => {
    getCampaignById.mockResolvedValue({ id: DRAFT_ID, partnerId: 'doc-partner-a', filmMuviUuid: FILM_A });
    updateCampaign.mockResolvedValue({ id: DRAFT_ID });
    const res = await draft.POST(req({ ...DRAFT_BODY(FILM_A), draftId: DRAFT_ID }));
    expect(res.status).toBe(200);
    expect(updateCampaign).toHaveBeenCalledTimes(1);
  });
});
