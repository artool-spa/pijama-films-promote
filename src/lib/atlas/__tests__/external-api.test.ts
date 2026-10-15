import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PARTNER_A_ID, catalogueFixture, movieFixture } from './external-fixtures';

const logged: unknown[] = [];

vi.mock('@/lib/logger', () => {
  const record = (payload: unknown, message?: unknown) => logged.push({ payload, message });
  return {
    createLogger: () => ({ info: record, warn: record, error: record, debug: record }),
    default: { info: record, warn: record, error: record },
  };
});

const {
  fetchPartnerCatalogue,
  ExternalMovieSchema,
  AtlasCatalogError,
} = await import('../external-api');

const KEY = 'sk-synthetic-key-that-must-never-leak';
const BASE = 'https://console.example';

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const fetchMock = vi.fn();

beforeEach(() => {
  logged.length = 0;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('ATLAS_SERVER_API_KEY', KEY);
  vi.stubEnv('ATLAS_SERVER_API_BASE_URL', `${BASE}/`);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AtlasCatalogError) return error.code;
    throw error;
  }
  return 'resolved';
}

describe('ExternalMovieSchema accepts what the API really sends', () => {
  it('takes genre as a string and as an array, normalised to string[]', () => {
    expect(ExternalMovieSchema.parse(movieFixture({ genre: 'Drama' })).genre).toEqual(['Drama']);
    expect(ExternalMovieSchema.parse(movieFixture({ genre: 'Drama, Comedy' })).genre).toEqual(['Drama', 'Comedy']);
    expect(ExternalMovieSchema.parse(movieFixture({ genre: ['Drama', 'Comedy'] })).genre).toEqual(['Drama', 'Comedy']);
    expect(ExternalMovieSchema.parse(movieFixture({ genre: '' })).genre).toEqual([]);
  });

  it('takes asset duration as "HH:MM:SS", a number or null, and key/width/height as null', () => {
    const movie = ExternalMovieSchema.parse(
      movieFixture({
        assets: [
          { type: 'trailer', key: null, url: 'https://x.example/t.mp4', width: null, height: null, duration: '00:01:00' },
          { type: 'short', key: null, url: 'https://x.example/s.mp4', width: null, height: null, duration: 42 },
          { type: 'poster', key: null, url: 'https://x.example/p.jpg', width: null, height: null, duration: null },
        ],
      })
    );

    expect(movie.assets.map((a) => a.duration)).toEqual(['00:01:00', 42, null]);
  });

  it('takes an empty language, an empty cast and an empty trailerUrl', () => {
    const movie = ExternalMovieSchema.parse(movieFixture());

    expect(movie.language).toBe('');
    expect(movie.cast).toEqual([]);
    expect(movie.trailerUrl).toBe('');
  });

  it('still rejects a movie without a muviContentUuid', () => {
    expect(() => ExternalMovieSchema.parse(movieFixture({ muviContentUuid: undefined }))).toThrow();
  });
});

describe('fetchPartnerCatalogue', () => {
  it('calls partner-movies with the bearer key and the given partnerId, once', async () => {
    fetchMock.mockResolvedValue(reply(200, catalogueFixture(PARTNER_A_ID, [movieFixture()])));

    const result = await fetchPartnerCatalogue(PARTNER_A_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/external/partner-movies?partnerId=${PARTNER_A_ID}`);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(result.partner.productionCompany).toBeUndefined();
    expect(result.movies).toHaveLength(1);
  });

  it('refuses to call without the key: clear error, no request, no fallback', async () => {
    vi.stubEnv('ATLAS_SERVER_API_KEY', '');

    expect(await codeOf(fetchPartnerCatalogue(PARTNER_A_ID))).toBe('not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to call without the base URL', async () => {
    vi.stubEnv('ATLAS_SERVER_API_BASE_URL', '');

    expect(await codeOf(fetchPartnerCatalogue(PARTNER_A_ID))).toBe('not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads the key at call time, not at import', async () => {
    fetchMock.mockResolvedValue(reply(200, catalogueFixture(PARTNER_A_ID, [])));
    vi.stubEnv('ATLAS_SERVER_API_KEY', 'sk-rotated');

    await fetchPartnerCatalogue(PARTNER_A_ID);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-rotated');
  });

  it('rejects a partnerId that could inject into the query, without calling', async () => {
    expect(await codeOf(fetchPartnerCatalogue('abc&partnerId=other'))).toBe('invalid_partner');
    expect(await codeOf(fetchPartnerCatalogue(''))).toBe('invalid_partner');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'unauthorized'],
    [400, 'invalid_partner'],
    [404, 'partner_not_found'],
    [500, 'unavailable'],
    [302, 'unavailable'],
  ])('maps HTTP %i to %s', async (status, code) => {
    fetchMock.mockResolvedValue(reply(status, { status: 'error', code: 'WHATEVER', message: 'upstream detail' }));

    expect(await codeOf(fetchPartnerCatalogue(PARTNER_A_ID))).toBe(code);
  });

  it('maps a network failure to unavailable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    expect(await codeOf(fetchPartnerCatalogue(PARTNER_A_ID))).toBe('unavailable');
  });

  it('maps a wrongly shaped 200 to bad_response', async () => {
    fetchMock.mockResolvedValue(reply(200, { status: 'ok', data: { movies: 'nope' } }));

    expect(await codeOf(fetchPartnerCatalogue(PARTNER_A_ID))).toBe('bad_response');
  });

  it('never leaks the key or upstream detail through errors or logs', async () => {
    fetchMock.mockRejectedValue(new TypeError(`Headers.append: "Bearer ${KEY}" is an invalid header value`));
    const error = await fetchPartnerCatalogue(PARTNER_A_ID).catch((e: Error) => e);

    fetchMock.mockResolvedValue(reply(500, { message: `boom ${KEY}` }));
    const error2 = await fetchPartnerCatalogue(PARTNER_A_ID).catch((e: Error) => e);

    for (const text of [String((error as Error).message), String((error2 as Error).message), JSON.stringify(logged)]) {
      expect(text).not.toContain(KEY);
    }
  });
});
