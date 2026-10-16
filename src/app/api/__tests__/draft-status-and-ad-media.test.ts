/**
 * 1. campaigns/draft (update) only edits DRAFTs: a synced campaign is changed
 *    through the platform-aware edit flow, not by a Firestore-only write.
 * 2. An ad's images/videos must exist AND carry the campaign's film. Foreign
 *    and unknown ids get the same 400, and nothing is written.
 * 3. google create-and-sync with `campaignId` must be the session's campaign.
 *
 * Real: ad/campaign/image/video models over the Firestore fake, and the routes.
 * Faked: session, platform sync, events.
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
// Film ownership has its own tests; here the film is always accessible.
vi.mock('@/lib/assets/film-access', async (orig) => ({
  ...(await orig<typeof import('@/lib/assets/film-access')>()),
  assertFilmAccessible: async () => undefined,
}));
vi.mock('@/lib/muvi/availability', async (orig) => ({
  ...(await orig<typeof import('@/lib/muvi/availability')>()),
  assertFilmPromotable: async () => undefined,
}));
vi.mock('#muvi', () => ({ muvi: {}, getMovieDetails: vi.fn() }));
vi.mock('@/lib/events', () => ({ publish: vi.fn() }));
vi.mock('#meta', () => ({ MetaApiError: class extends Error {} }));
vi.mock('#google', () => ({ GoogleAdsApiError: class extends Error {} }));
const syncCampaignToGoogle = vi.fn(async () => ({ googleCampaignId: 'g1' }));
vi.mock('@/lib/campaigns/sync', () => ({
  areMetaAssetsReady: () => false,
  areGoogleImageAssetsReady: () => false,
  syncCampaignToMeta: vi.fn(),
  syncCampaignToGoogle: (...a: unknown[]) => syncCampaignToGoogle(...(a as [])),
  resyncAdCreativeToMeta: vi.fn(),
  resyncAdCreativeToGoogle: vi.fn(),
}));
vi.mock('@/lib/campaigns/error-messages', () => ({ toFriendlyCampaignError: () => 'x' }));
vi.mock('@/lib/campaigns/budget-validation', () => ({ validateCampaignBudget: () => ({ valid: true }) }));
vi.mock('@/models/partner', () => ({ getPartnerById: async () => ({ id: 'x', name: 'P' }) }));

type S = 'a' | 'b' | null;
let who: S = 'b';
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/access-control')>('@/lib/auth/access-control');
  return {
    canManageCampaign: actual.canManageCampaign,
    getPartnerFromRequest: async () =>
      who ? { id: `doc-${who}`, partnerId: `ext-${who}`, name: who, sessionOrigin: 'sso' } : null,
  };
});

const { createCampaign } = await import('@/models/campaign');
const { createImage } = await import('@/models/image');
const { createVideo } = await import('@/models/video');
const draft = await import('../campaigns/draft/route');
const metaAds = await import('../meta/ads/route');
const googleAds = await import('../google/ads/route');
const metaAd = await import('../meta/ads/[id]/route');
const metaSync = await import('../meta/campaigns/create-and-sync/route');
const googleSync = await import('../google/campaigns/create-and-sync/route');

const FILM_A = 'uuid-film-a';
const FILM_B = 'uuid-film-b';
const req = (body: unknown, method = 'POST') => new NextRequest('http://localhost/api/x', { method, body: JSON.stringify(body) });
const adDocs = () => [...db.store.keys()].filter((k) => k.startsWith('ads/'));
const campaignDocs = () => [...db.store.keys()].filter((k) => k.startsWith('campaigns/'));

const asset = (film: string) => ({
  filmMuviUuid: film, name: 'n', originalUrl: `o-${Math.random()}`, storageKey: 'k', url: 'https://x/y', mimeType: 'image/png', size: 1,
});

let campaignB: string;
let campaignA: string;
let imgA: string; let imgB: string; let vidA: string; let vidB: string;

async function campaign(partnerDoc: string, film: string) {
  const c = await createCampaign({
    name: 'C', objective: 'LANDING_PAGE_VIEW', budget: 100, startDate: new Date('2026-11-01'),
    filmMuviUuid: film, partnerId: partnerDoc, platforms: ['META'],
    conversionEvent: 'VIEW_CONTENT',
  } as never);
  return c.id as string;
}

beforeEach(async () => {
  vi.clearAllMocks();
  db.reset();
  who = 'b';
  const now = new Date('2026-01-01T00:00:00.000Z');
  for (const p of ['a', 'b']) db.write(`partners/doc-${p}`, { partnerId: `ext-${p}`, name: p, createdAt: now, updatedAt: now }, false);
  campaignA = await campaign('doc-a', FILM_A);
  campaignB = await campaign('doc-b', FILM_B);
  imgA = (await createImage(asset(FILM_A))).id;
  imgB = (await createImage(asset(FILM_B))).id;
  vidA = (await createVideo({ ...asset(FILM_A), mimeType: 'video/mp4' } as never)).id;
  vidB = (await createVideo({ ...asset(FILM_B), mimeType: 'video/mp4' } as never)).id;
});

// ---------------------------------------------------------------- 1. status
describe('campaigns/draft update only edits DRAFTs', () => {
  const body = (id: string) => ({
    draftId: id,
    campaignData: { name: 'Renamed', budget: 999, startDate: '2026-11-01', filmMuviUuid: FILM_B },
    formState: {},
  });

  it.each(['PENDING_ASSETS', 'SYNCING', 'PENDING', 'ACTIVE', 'PAUSED', 'ARCHIVED', 'ERROR'])(
    'answers 409 and writes nothing for an own %s campaign',
    async (status) => {
      db.write(`campaigns/${campaignB}`, { status }, true);
      const before = JSON.stringify(db.store.get(`campaigns/${campaignB}`));

      const res = await draft.POST(req(body(campaignB)));

      expect(res.status).toBe(409);
      expect(JSON.stringify(db.store.get(`campaigns/${campaignB}`))).toBe(before);
    }
  );

  it('still updates an own DRAFT', async () => {
    const res = await draft.POST(req(body(campaignB)));
    expect(res.status).toBe(200);
    expect(db.store.get(`campaigns/${campaignB}`)?.name).toBe('Renamed');
  });

  it('keeps answering 404 for a foreign campaign, whatever its status', async () => {
    db.write(`campaigns/${campaignA}`, { status: 'ACTIVE' }, true);
    expect((await draft.POST(req(body(campaignA)))).status).toBe(404);
  });
});

// ------------------------------------------------------------------ 2. media
const AD = (campaignId: string, imageIds: string[], videoIds: string[] = []) => ({
  name: 'Ad', headlines: ['h'], bodies: ['b'], linkUrl: 'https://example.com/w', campaignId, imageIds, videoIds,
});
const SYNC = (film: string, imageIds: string[], videoIds: string[] = []) => ({
  name: 'C', objective: 'LANDING_PAGE_VIEW', budget: 500, startDate: '2026-11-01', endDate: '2026-12-01',
  filmMuviUuid: film, autoSync: false,
  ads: [{ name: 'Ad', headlines: ['h'], bodies: ['b'], linkUrl: 'https://example.com/w', imageIds, videoIds }],
});

type MediaCase = { name: string; run: (img: string[], vid: string[]) => Promise<Response>; creates: boolean };
const MEDIA_CASES: MediaCase[] = [
  { name: 'POST meta/ads', run: (i, v) => metaAds.POST(req(AD(campaignB, i, v))), creates: false },
  { name: 'POST google/ads', run: (i, v) => googleAds.POST(req(AD(campaignB, i, v))), creates: false },
  { name: 'POST meta create-and-sync (new)', run: (i, v) => metaSync.POST(req(SYNC(FILM_B, i, v))), creates: true },
  { name: 'POST google create-and-sync (new)', run: (i, v) => googleSync.POST(req(SYNC(FILM_B, i, v))), creates: true },
  {
    name: 'POST meta create-and-sync (draft)',
    run: (i, v) => metaSync.POST(req({ ...SYNC(FILM_B, i, v), draftId: campaignB })),
    creates: false,
  },
  {
    name: 'POST google create-and-sync (draft)',
    run: (i, v) => googleSync.POST(req({ ...SYNC(FILM_B, i, v), draftId: campaignB })),
    creates: false,
  },
];

describe.each(MEDIA_CASES)('$name', ({ run, creates }) => {
  it("answers 400 and writes nothing when B attaches A's image", async () => {
    const campaignsBefore = campaignDocs().length;
    const res = await run([imgA], []);
    expect(res.status).toBe(400);
    expect(adDocs()).toEqual([]);
    expect(campaignDocs().length).toBe(campaignsBefore);
    void creates;
  });

  it("leaves B's draft campaign untouched when the media is foreign", async () => {
    const before = JSON.stringify(db.store.get(`campaigns/${campaignB}`));
    await run([imgA], []);
    expect(JSON.stringify(db.store.get(`campaigns/${campaignB}`))).toBe(before);
  });

  it("answers 400 when B attaches A's video", async () => {
    expect((await run([], [vidA])).status).toBe(400);
    expect(adDocs()).toEqual([]);
  });

  it('answers 400 when one of several images is foreign', async () => {
    expect((await run([imgB, imgA], [])).status).toBe(400);
    expect(adDocs()).toEqual([]);
  });

  it('gives the SAME answer for an unknown id as for a foreign one', async () => {
    const foreign = await (await run([imgA], [])).json();
    const unknown = await (await run(['does-not-exist'], [])).json();
    expect(unknown).toEqual(foreign);
  });

  it('lets B attach its own media', async () => {
    const res = await run([imgB], [vidB]);
    expect(res.status).toBeLessThan(400);
    expect(adDocs().length).toBe(1);
  });
});

describe('meta/ads POST and google/ads POST need the session\'s campaign', () => {
  it.each([
    ['meta/ads', metaAds.POST],
    ['google/ads', googleAds.POST],
  ])('%s: 404 and nothing written when the campaign is A\'s', async (_n, POST) => {
    const res = await POST(req(AD(campaignA, [imgA])));
    expect(res.status).toBe(404);
    expect(adDocs()).toEqual([]);
  });
});

describe('PATCH meta/ads/[id]', () => {
  let adId: string;
  beforeEach(async () => {
    const res = await metaAds.POST(req(AD(campaignB, [imgB])));
    adId = (await res.json()).id;
  });
  const patch = (body: unknown) =>
    metaAd.PATCH(req(body, 'PATCH'), { params: Promise.resolve({ id: adId }) });

  it("answers 400 for A's image and leaves the ad as it was", async () => {
    const res = await patch({ imageIds: [imgA] });
    expect(res.status).toBe(400);
    expect(db.store.get(`ads/${adId}`)?.imageIds).toEqual([imgB]);
  });

  it('answers the same for an unknown image as for a foreign one', async () => {
    const foreign = await (await patch({ imageIds: [imgA] })).json();
    const unknown = await (await patch({ imageIds: ['nope'] })).json();
    expect(unknown).toEqual(foreign);
  });
});

// -------------------------------------------------- 3. google existingCampaignId
describe('google create-and-sync with campaignId', () => {
  const body = (campaignId: string) => ({ ...SYNC(FILM_B, [imgB]), campaignId, autoSync: true });

  it("answers 404 and does not sync when the campaign is A's", async () => {
    const res = await googleSync.POST(req(body(campaignA)));
    expect(res.status).toBe(404);
    expect(syncCampaignToGoogle).not.toHaveBeenCalled();
  });

  it('lets B reuse its own campaign', async () => {
    const res = await googleSync.POST(req(body(campaignB)));
    expect(res.status).not.toBe(404);
  });
});

// The model is the last line: callers other than the routes above get it too.
describe('the ad model refuses foreign media on its own', () => {
  it('createAdsForCampaign: AdMediaError and no ad written', async () => {
    const { createAdsForCampaign, AdMediaError } = await import('@/models/ad');
    await expect(
      createAdsForCampaign(campaignB, [
        { name: 'Ad', headlines: ['h'], bodies: ['b'], linkUrl: 'https://example.com/w', imageIds: [imgA], videoIds: [] } as never,
      ])
    ).rejects.toBeInstanceOf(AdMediaError);
    expect(adDocs()).toEqual([]);
  });

  it('updateAd: AdMediaError and the ad is unchanged', async () => {
    const { createAd, updateAd, AdMediaError } = await import('@/models/ad');
    const ad = await createAd(AD(campaignB, [imgB]) as never);
    await expect(updateAd(ad.id, { imageIds: [imgA] } as never)).rejects.toBeInstanceOf(AdMediaError);
    expect(db.store.get(`ads/${ad.id}`)?.imageIds).toEqual([imgB]);
  });
});
