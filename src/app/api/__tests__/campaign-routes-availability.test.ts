/**
 * The four campaign-creating routes turn "MUVI will not serve this film" into a
 * clear answer for the producer, and the two create-and-sync routes also check
 * the film when a DRAFT is promoted (that path never goes through createCampaign).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Film ownership has its own tests (film-assets-ownership / campaign-film-ownership);
// here it must not depend on a session.
vi.mock('@/lib/assets/film-access', async (orig) => ({
  ...(await orig<typeof import('@/lib/assets/film-access')>()),
  assertFilmAccessible: async () => undefined,
}));
vi.mock('@/lib/logger', () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { default: l, createLogger: () => l };
});

class MuviApiError extends Error {
  statusCode?: number;
  constructor(message: string, options?: { statusCode?: number }) {
    super(message);
    this.name = 'MuviApiError';
    this.statusCode = options?.statusCode;
  }
}
const getMovieDetails = vi.fn();
vi.mock('#muvi', () => ({ muvi: {}, MuviApiError, getMovieDetails: (...a: unknown[]) => getMovieDetails(...a) }));

vi.mock('@/lib/auth', () => ({ getPartnerFromRequest: async () => ({ id: 'doc-1', partnerId: 'p-1' }) }));
vi.mock('@/models/partner', () => ({ getPartnerById: async () => ({ id: 'doc-1' }) }));
vi.mock('@/models/ad', () => ({ createAdsForCampaign: vi.fn(), getAdsByCampaignId: vi.fn() }));
vi.mock('@/lib/events', () => ({ publish: vi.fn() }));
vi.mock('#meta', () => ({ MetaApiError: class extends Error {} }));
vi.mock('#google', () => ({ GoogleAdsApiError: class extends Error {} }));
vi.mock('@/lib/campaigns/sync', () => ({
  areMetaAssetsReady: vi.fn(),
  areGoogleImageAssetsReady: vi.fn(),
  syncCampaignToMeta: vi.fn(),
  syncCampaignToGoogle: vi.fn(),
}));
vi.mock('@/lib/campaigns/error-messages', () => ({ toFriendlyCampaignError: () => 'x' }));
vi.mock('@/lib/campaigns/budget-validation', () => ({ validateCampaignBudget: () => ({ valid: true }) }));

const createCampaign = vi.fn();
const updateCampaign = vi.fn();
const getCampaignById = vi.fn();
vi.mock('@/models/campaign', async () => {
  const actual = await vi.importActual<typeof import('@/models/campaign')>('@/models/campaign');
  return {
    ...actual,
    createCampaign: (...a: unknown[]) => createCampaign(...a),
    updateCampaign: (...a: unknown[]) => updateCampaign(...a),
    getCampaignById: (...a: unknown[]) => getCampaignById(...a),
    markCampaignPendingAssets: vi.fn(),
  };
});
vi.mock('@/lib/firebase/admin', () => ({ adminDb: () => ({}) }));

const availability = await import('@/lib/muvi/availability');
const { FilmNotAvailableError, FilmAvailabilityUnknownError } = availability;

const metaSimple = await import('../meta/campaigns/route');
const googleSimple = await import('../google/campaigns/route');
const metaSync = await import('../meta/campaigns/create-and-sync/route');
const googleSync = await import('../google/campaigns/create-and-sync/route');

const BODY = {
  name: 'Spring push',
  objective: 'LANDING_PAGE_VIEW',
  budget: 500,
  startDate: '2026-11-01',
  endDate: '2026-12-01',
  filmMuviUuid: 'uuid-film',
};
const SYNC_BODY = {
  ...BODY,
  ads: [{ name: 'Ad', headlines: ['h'], bodies: ['b'], linkUrl: 'https://example.com/watch', imageIds: ['img1'] }],
};

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/x', { method: 'POST', body: JSON.stringify(body) });
}

beforeEach(() => {
  createCampaign.mockReset();
  updateCampaign.mockReset();
  getCampaignById.mockReset();
  getMovieDetails.mockReset();
});

const ROUTES = [
  ['meta/campaigns', metaSimple.POST, BODY],
  ['google/campaigns', googleSimple.POST, BODY],
  ['meta/campaigns/create-and-sync', metaSync.POST, SYNC_BODY],
  ['google/campaigns/create-and-sync', googleSync.POST, SYNC_BODY],
] as const;

describe.each(ROUTES)('%s', (_name, POST, body) => {
  it('answers 422 with the producer message when the film is not available', async () => {
    createCampaign.mockRejectedValue(new FilmNotAvailableError('region'));

    const res = await POST(req(body));
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.code).toBe('FILM_NOT_AVAILABLE');
    expect(json.error).toBe(availability.FILM_NOT_AVAILABLE_MESSAGE);
  });

  it('answers 503 with a retry message when MUVI could not be checked', async () => {
    createCampaign.mockRejectedValue(new FilmAvailabilityUnknownError());

    const res = await POST(req(body));
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.code).toBe('FILM_CHECK_FAILED');
    expect(json.error).toBe(availability.FILM_CHECK_FAILED_MESSAGE);
  });

  it('keeps answering 500 for any other failure', async () => {
    createCampaign.mockRejectedValue(new Error('db exploded: secret detail'));

    const res = await POST(req(body));

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret detail');
  });
});

describe.each([
  ['meta/campaigns/create-and-sync', metaSync.POST],
  ['google/campaigns/create-and-sync', googleSync.POST],
])('%s promoting a draft', (_name, POST) => {
  const DRAFT = { id: 'draft-1', partnerId: 'doc-1', filmMuviUuid: 'uuid-film' };

  it('is rejected, and the draft left untouched, when the film is region-blocked', async () => {
    getCampaignById.mockResolvedValue(DRAFT);
    getMovieDetails.mockRejectedValue(
      new MuviApiError('Muvi API error: This content is not available in your region', { statusCode: 400 })
    );

    const res = await POST(req({ ...SYNC_BODY, draftId: 'a'.repeat(20) }));

    expect(res.status).toBe(422);
    expect(updateCampaign).not.toHaveBeenCalled();
    // The film checked is the draft's own, not whatever the body claims.
    expect(getMovieDetails).toHaveBeenCalledWith(expect.anything(), 'uuid-film');
  });

  it('checks the DRAFT\'s film even when the body names another one', async () => {
    getCampaignById.mockResolvedValue(DRAFT);
    getMovieDetails.mockRejectedValue(new TypeError('fetch failed'));

    const res = await POST(req({ ...SYNC_BODY, filmMuviUuid: 'some-other-film', draftId: 'a'.repeat(20) }));

    expect(res.status).toBe(503);
    expect(getMovieDetails).toHaveBeenCalledWith(expect.anything(), 'uuid-film');
    expect(updateCampaign).not.toHaveBeenCalled();
  });
});
