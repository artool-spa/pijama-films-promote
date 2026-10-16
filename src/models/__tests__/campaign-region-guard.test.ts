/**
 * A campaign for a film MUVI will not serve must not be created.
 * Driven through the real `createCampaign` and the real availability check; only
 * Firestore (fake) and the MUVI client (mock) are replaced.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeFirestore } from '@/test/firestore-fake';

const db = new FakeFirestore();
// Film ownership has its own tests (film-assets-ownership / campaign-film-ownership);
// here it must not depend on a session.
vi.mock('@/lib/assets/film-access', async (orig) => ({
  ...(await orig<typeof import('@/lib/assets/film-access')>()),
  assertFilmAccessible: async () => undefined,
}));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: () => db }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

class MuviApiError extends Error {
  statusCode?: number;
  constructor(message: string, options?: { statusCode?: number }) {
    super(message);
    this.name = 'MuviApiError';
    this.statusCode = options?.statusCode;
  }
}
const getMovieDetails = vi.fn();
vi.mock('#muvi', () => ({
  muvi: {},
  MuviApiError,
  getMovieDetails: (...a: unknown[]) => getMovieDetails(...a),
}));

const { createCampaign } = await import('../campaign');
const {
  FilmNotAvailableError,
  FilmAvailabilityUnknownError,
  isRegionBlock,
  isContentGone,
  FILM_NOT_AVAILABLE_MESSAGE,
  FILM_CHECK_FAILED_MESSAGE,
} = await import('@/lib/muvi/availability');

// Bodies as MEASURED on 2026-10-02 (see docs/atlas-sso-integration.md).
const BLOCKED = () => new MuviApiError('Muvi API error: This content is not available in your region', { statusCode: 400 });
const GONE = () => new MuviApiError("Muvi API error: The content you're looking for is no longer available", { statusCode: 1317 });

const INPUT = {
  name: 'Spring push',
  objective: 'LANDING_PAGE_VIEW',
  budget: 100,
  startDate: new Date('2026-11-01'),
  filmMuviUuid: 'uuid-film',
  partnerId: 'doc-1',
} as never;

const campaignCount = () => [...db.store.keys()].filter((k) => k.startsWith('campaigns/')).length;

beforeEach(() => {
  db.reset();
  getMovieDetails.mockReset();
  const now = new Date('2026-01-01T00:00:00.000Z');
  db.write('partners/doc-1', { partnerId: 'p-1', name: 'P', createdAt: now, updatedAt: now }, false);
});

describe('createCampaign and MUVI availability', () => {
  it('creates the campaign when MUVI serves the film', async () => {
    getMovieDetails.mockResolvedValue({ content_uuid: 'uuid-film' });

    await createCampaign(INPUT);

    expect(getMovieDetails).toHaveBeenCalledWith(expect.anything(), 'uuid-film');
    expect(campaignCount()).toBe(1);
  });

  it('rejects a region-blocked film with the producer message and writes nothing', async () => {
    getMovieDetails.mockRejectedValue(BLOCKED());

    const error = await createCampaign(INPUT).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FilmNotAvailableError);
    expect((error as Error).message).toBe(FILM_NOT_AVAILABLE_MESSAGE);
    expect(campaignCount()).toBe(0);
  });

  it.each([
    ['code 1317', () => GONE()],
    ['an empty result', null],
  ])('rejects a film MUVI no longer has (%s)', async (_l, outcome) => {
    if (typeof outcome === 'function') getMovieDetails.mockRejectedValue(outcome());
    else getMovieDetails.mockResolvedValue(outcome);

    await expect(createCampaign(INPUT)).rejects.toBeInstanceOf(FilmNotAvailableError);
    expect(campaignCount()).toBe(0);
  });

  it.each([
    ['a 503', new MuviApiError('API request failed: 503 Service Unavailable', { statusCode: 503 })],
    ['a credential rejection', new MuviApiError('Muvi API error: Invalid app token', { statusCode: 401 })],
    ['a generic 400', new MuviApiError('Muvi API error: Bad request', { statusCode: 400 })],
    ['a network failure', new TypeError('fetch failed')],
  ])('MUVI unavailable (%s) is "could not check", not "blocked", and writes nothing', async (_l, failure) => {
    getMovieDetails.mockRejectedValue(failure);

    const error = await createCampaign(INPUT).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FilmAvailabilityUnknownError);
    expect(error).not.toBeInstanceOf(FilmNotAvailableError);
    expect((error as Error).message).toBe(FILM_CHECK_FAILED_MESSAGE);
    expect(campaignCount()).toBe(0);
  });

  it('reports a malformed payload as such, without asking MUVI', async () => {
    await expect(createCampaign({ ...(INPUT as object), budget: -1 } as never)).rejects.toThrow();
    expect(getMovieDetails).not.toHaveBeenCalled();
  });
});

describe('the detectors, on the measured bodies', () => {
  it('tells region from gone from everything else', () => {
    expect(isRegionBlock(BLOCKED())).toBe(true);
    expect(isContentGone(BLOCKED())).toBe(false);
    expect(isContentGone(GONE())).toBe(true);
    expect(isRegionBlock(GONE())).toBe(false);
    // The 400 alone is not enough: it can be generic.
    expect(isRegionBlock(new MuviApiError('Muvi API error: Bad request', { statusCode: 400 }))).toBe(false);
    expect(isRegionBlock(new Error('This content is not available in your region'))).toBe(false);
  });
});
