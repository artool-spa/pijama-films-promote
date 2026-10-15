/**
 * Which catalogue a session sees.
 *
 * The external API key can read all 65 producers, so the isolation lives
 * entirely in WHICH partnerId reaches it. These tests drive the public
 * `getFilms` / `getFilmById` / `assertFilmPromotable` with a mocked session,
 * a mocked `fetch` (the external API) and a mocked MUVI.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeFirestore } from '@/test/firestore-fake';
import {
  PARTNER_A_ID,
  PARTNER_B_ID,
  catalogueFixture,
  movieFixture,
} from '@/lib/atlas/__tests__/external-fixtures';

const db = new FakeFirestore();
vi.mock('@/lib/firebase/admin', () => ({ adminDb: () => db }));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('firebase-admin/firestore', () => ({
  Timestamp: class Timestamp {},
  AggregateField: { sum: (f: string) => ({ kind: 'sum', field: f }), count: () => ({ kind: 'count' }) },
}));

const getMovies = vi.fn();
const getMovieDetails = vi.fn();

class MuviApiError extends Error {
  statusCode?: number;
  constructor(message: string, options?: { statusCode?: number }) {
    super(message);
    this.name = 'MuviApiError';
    this.statusCode = options?.statusCode;
  }
}

vi.mock('#muvi', () => ({
  muvi: {},
  MuviApiError,
  getMovies: (...a: unknown[]) => getMovies(...a),
  getMovieDetails: (...a: unknown[]) => getMovieDetails(...a),
}));

const getSession = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getSession: () => getSession() }));

const {
  getFilms,
  getFilmById,
  assertFilmPromotable,
  FilmNotAvailableError,
  FilmAvailabilityUnknownError,
} = await import('../film');

const fetchMock = vi.fn();

function atlasSession(partnerId: string) {
  return { uid: `atlas:${partnerId}`, email: 'p@example.com', name: 'P', partnerId, expiresAt: Date.now() + 1e6 };
}

const INTERNAL_SESSION = {
  uid: 'firebase-uid-123',
  email: 'staff@example.com',
  name: 'Staff',
  partnerId: 'pijamafilms',
  expiresAt: Date.now() + 1e6,
};

/** The external API, keyed by partnerId: A and B each own different films. */
const CATALOGUES: Record<string, unknown> = {
  [PARTNER_A_ID]: catalogueFixture(PARTNER_A_ID, [
    movieFixture({ muviContentUuid: 'uuid-a1', internationalTitle: 'Alpha One', originalTitle: 'Alpha One' }),
    movieFixture({ muviContentUuid: 'uuid-a2', internationalTitle: 'Alpha Two', originalTitle: 'Alpha Two' }),
  ]),
  [PARTNER_B_ID]: catalogueFixture(PARTNER_B_ID, [
    movieFixture({ muviContentUuid: 'uuid-b1', internationalTitle: 'Beta One', originalTitle: 'Beta One' }),
  ]),
};

function externalApi(url: string): Response {
  const partnerId = new URL(url).searchParams.get('partnerId') ?? '';
  const body = CATALOGUES[partnerId];

  return body
    ? new Response(JSON.stringify(body), { status: 200 })
    : new Response(JSON.stringify({ status: 'error', code: 'PARTNER_NOT_FOUND' }), { status: 404 });
}

beforeEach(() => {
  db.reset();
  getSession.mockReset();
  getMovies.mockReset();
  getMovieDetails.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => externalApi(url));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('ATLAS_SERVER_API_KEY', 'sk-synthetic');
  vi.stubEnv('ATLAS_SERVER_API_BASE_URL', 'https://console.example');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const idsOf = (films: Array<{ id: string }>) => films.map((f) => f.id).sort();

describe('an Atlas session sees only its own partner catalogue', () => {
  it('isolates two partners: each sees only its own films', async () => {
    getSession.mockResolvedValue(atlasSession(PARTNER_A_ID));
    const a = await getFilms(1, 12, {}, false);

    getSession.mockResolvedValue(atlasSession(PARTNER_B_ID));
    const b = await getFilms(1, 12, {}, false);

    expect(idsOf(a.films)).toEqual(['uuid-a1', 'uuid-a2']);
    expect(idsOf(b.films)).toEqual(['uuid-b1']);
    expect(a.total).toBe(2);
    expect(b.total).toBe(1);
  });

  it("asks the API for the SESSION's partner and never touches MUVI", async () => {
    getSession.mockResolvedValue(atlasSession(PARTNER_A_ID));

    await getFilms(1, 12, {}, false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('partnerId')).toBe(PARTNER_A_ID);
    expect(getMovies).not.toHaveBeenCalled();
  });

  it('ignores a partnerId smuggled in by the caller', async () => {
    getSession.mockResolvedValue(atlasSession(PARTNER_A_ID));

    // Nothing in the signature accepts one; this is what a careless caller
    // forwarding request params into `options` would do.
    const smuggled = { search: undefined, partnerId: PARTNER_B_ID } as never;
    const result = await getFilms(1, 12, smuggled, false);

    expect(idsOf(result.films)).toEqual(['uuid-a1', 'uuid-a2']);
    expect(fetchMock.mock.calls.every((c) => new URL(c[0] as string).searchParams.get('partnerId') === PARTNER_A_ID)).toBe(true);
  });

  it("does not open another partner's film by id", async () => {
    getSession.mockResolvedValue(atlasSession(PARTNER_A_ID));

    expect(await getFilmById('uuid-b1', false)).toBeUndefined();
    expect((await getFilmById('uuid-a1', false))?.id).toBe('uuid-a1');
    expect(getMovieDetails).not.toHaveBeenCalled();
  });

  it('an unknown partner (404) gets an EMPTY list, never the whole catalogue', async () => {
    getSession.mockResolvedValue(atlasSession('cccccccccccccccccccccccc'));

    const result = await getFilms(1, 12, {}, false);

    expect(result.films).toEqual([]);
    expect(result.total).toBe(0);
    expect(getMovies).not.toHaveBeenCalled();
  });

  it('without the API key the session gets a clear error, not the global catalogue', async () => {
    vi.stubEnv('ATLAS_SERVER_API_KEY', '');
    getSession.mockResolvedValue(atlasSession(PARTNER_A_ID));

    await expect(getFilms(1, 12, {}, false)).rejects.toThrow(/not configured/);
    expect(getMovies).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an upstream outage is an error, not the global catalogue', async () => {
    fetchMock.mockResolvedValue(new Response('down', { status: 503 }));
    getSession.mockResolvedValue(atlasSession(PARTNER_A_ID));

    await expect(getFilms(1, 12, {}, false)).rejects.toThrow();
    expect(getMovies).not.toHaveBeenCalled();
  });

  it('refuses a session whose uid and partnerId disagree', async () => {
    getSession.mockResolvedValue({ ...atlasSession(PARTNER_A_ID), partnerId: PARTNER_B_ID });

    await expect(getFilms(1, 12, {}, false)).rejects.toThrow(/inconsistent/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to read the catalogue without a session', async () => {
    getSession.mockResolvedValue(null);

    await expect(getFilms(1, 12, {}, false)).rejects.toThrow(/session is required/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getMovies).not.toHaveBeenCalled();
  });

  it('shows only the partner\'s own campaigns on a film', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    db.write('partners/doc-a', { partnerId: PARTNER_A_ID, name: 'A', createdAt: now, updatedAt: now }, false);
    db.write('partners/doc-b', { partnerId: PARTNER_B_ID, name: 'B', createdAt: now, updatedAt: now }, false);
    // Built through the real model so the documents are shaped exactly as production writes them.
    const { createCampaign } = await import('../campaign');
    const base = { objective: 'LANDING_PAGE_VIEW', budget: 10, filmMuviUuid: 'uuid-a1', startDate: now, endDate: new Date('2026-12-31') };
    const mine = await createCampaign({ ...base, name: 'mine', partnerId: 'doc-a' } as never);
    const theirs = await createCampaign({ ...base, name: 'theirs', partnerId: 'doc-b' } as never);
    // Drafts are filtered out by the model, so publish BOTH: otherwise the other
    // partner's campaign would be hidden by that filter and not by the one under test.
    db.write(`campaigns/${mine.id}`, { status: 'ACTIVE' }, true);
    db.write(`campaigns/${theirs.id}`, { status: 'ACTIVE' }, true);
    getSession.mockResolvedValue(atlasSession(PARTNER_A_ID));

    const film = await getFilmById('uuid-a1', true);

    expect(film?.campaigns?.map((c) => c.name)).toEqual(['mine']);
  });

  it('maps the film for the existing views: trailer from assets, short never promoted', async () => {
    getSession.mockResolvedValue(atlasSession(PARTNER_A_ID));

    const film = await getFilmById('uuid-a1', false);

    expect(film).toMatchObject({
      id: 'uuid-a1',
      title: 'Alpha One',
      duration: 94,
      genre: ['Drama'],
      director: 'Dana Director',
      posterUrl: 'https://cdn.example/a1/poster.jpg',
      trailerUrl: 'https://cdn.example/a1/trailer.mp4',
    });
    expect(film?.mediaAssets?.map((a) => a.name)).toEqual(['Poster Oficial', 'Banner', 'Trailer']);
    expect(JSON.stringify(film)).not.toContain('short.mp4');
  });

  it('searches, sorts and paginates in memory', async () => {
    getSession.mockResolvedValue(atlasSession(PARTNER_A_ID));

    expect(idsOf((await getFilms(1, 12, { search: 'two' }, false)).films)).toEqual(['uuid-a2']);
    const sorted = await getFilms(1, 1, { sort: 'ztoa' }, false);
    expect(sorted.films.map((f) => f.id)).toEqual(['uuid-a2']);
    expect(sorted.pages).toBe(2);
  });
});

describe('an internal (Firebase) session keeps the global MUVI catalogue', () => {
  it('lists from MUVI and never calls the external API', async () => {
    getSession.mockResolvedValue(INTERNAL_SESSION);
    getMovies.mockResolvedValue({ movies: [], totalCount: 0, page: 1, perPage: 12 });

    await getFilms(1, 12, {}, false);

    expect(getMovies).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens a film by id from MUVI', async () => {
    getSession.mockResolvedValue(INTERNAL_SESSION);
    getMovieDetails.mockResolvedValue(null);

    await getFilmById('uuid-x', false);

    expect(getMovieDetails).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('assertFilmPromotable', () => {
  it('passes when MUVI serves the film', async () => {
    getMovieDetails.mockResolvedValue({ content_uuid: 'u' });

    await expect(assertFilmPromotable('u')).resolves.toBeUndefined();
  });

  it('rejects a film blocked in our region', async () => {
    getMovieDetails.mockRejectedValue(
      new MuviApiError('Muvi API error: This content is not available in your region')
    );

    const error = await assertFilmPromotable('u').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FilmNotAvailableError);
    expect((error as Error).message).toMatch(/isn't available to viewers yet/);
  });

  it('rejects a film MUVI no longer has', async () => {
    getMovieDetails.mockResolvedValue(null);

    await expect(assertFilmPromotable('u')).rejects.toBeInstanceOf(FilmNotAvailableError);
  });

  it.each([
    ['a 503', new MuviApiError('API request failed: 503 Service Unavailable', { statusCode: 503 })],
    ['a credential rejection', new MuviApiError('Muvi API error: Invalid token')],
    ['a network error', new TypeError('fetch failed')],
  ])('MUVI down (%s) is "could not check", NOT "blocked"', async (_label, failure) => {
    getMovieDetails.mockRejectedValue(failure);

    const error = await assertFilmPromotable('u').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FilmAvailabilityUnknownError);
    expect(error).not.toBeInstanceOf(FilmNotAvailableError);
  });
});
