import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Logger is mocked so the token-redaction assertions can inspect everything the
 * client tried to log. Do not "simplify" this away: a leaked token in a log
 * line is invisible to every other assertion in this file.
 */
const logged: Array<{ level: string; payload: unknown; message: unknown }> = [];

vi.mock('@/lib/logger', () => {
  const record = (level: string) => (payload: unknown, message?: unknown) =>
    logged.push({ level, payload, message });

  return {
    createLogger: () => ({
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
      debug: record('debug'),
    }),
    default: { info: record('info'), warn: record('warn'), error: record('error') },
  };
});

const { fetchPartnerMovies, describeToken } = await import('../client');

const BASE = 'https://dashboard.pijamafilms.com';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.PAYLOAD-THAT-MUST-NEVER-LEAK.sig';

/**
 * FIXTURE PROVENANCE
 *
 * `measuredRedirect` is REAL: T0 probed Atlas on 2026-08-26 without a token and
 * with an invalid one, and both answered `302` with `Location:
 * /auth/auth/logout` - contradicting the documented `401 MISSING_TOKEN` /
 * `403 TOKEN_EXPIRED` JSON errors.
 *
 * `documentedSuccess` is ASSUMED: nobody has ever seen Atlas answer 2xx here.
 * It reproduces Crazy Cake's integration note, nothing more. Do not treat a
 * green test built on it as evidence that the upstream contract holds.
 */
function measuredRedirect(): Response {
  return new Response('', {
    status: 302,
    headers: { location: '/auth/auth/logout?next=%2Fmovies' },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const documentedSuccess = {
  status: 'ok',
  data: {
    partner: {
      name: 'Pijama Films',
      email: 'partner@example.com',
      muviUuid: 'muvi-partner-1',
      partnerId: 'partner-a',
    },
    movies: [{ _id: '1', title: 'A Film', muviUuid: 'muvi-1' }],
  },
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  logged.length = 0;
  process.env.ATLAS_API_BASE_URL = BASE;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  delete process.env.ATLAS_API_BASE_URL;
  vi.unstubAllGlobals();
});

describe('fetchPartnerMovies - the request it makes', () => {
  it('calls the documented path on the configured base with a bearer token', async () => {
    fetchMock.mockResolvedValue(jsonResponse(documentedSuccess));

    await fetchPartnerMovies(TOKEN);

    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toBe(`${BASE}/movies/by-partner`);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('does not follow redirects', async () => {
    fetchMock.mockResolvedValue(jsonResponse(documentedSuccess));

    await fetchPartnerMovies(TOKEN);

    expect(
      fetchMock.mock.calls[0][1].redirect,
      'every unauthenticated Atlas route answers 302 to a logout page; following it ' +
        'would turn "Atlas rejected the token" into an HTML page with status 200, ' +
        'which reads as success'
    ).toBe('manual');
  });

  it('sends an abort signal so a hung upstream cannot hold the request open', async () => {
    fetchMock.mockResolvedValue(jsonResponse(documentedSuccess));

    await fetchPartnerMovies(TOKEN);

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('fetchPartnerMovies - what it reports back', () => {
  it('reports the measured 302 as a failure, with the redirect target', async () => {
    fetchMock.mockResolvedValue(measuredRedirect());

    const result = await fetchPartnerMovies(TOKEN);

    expect(
      result.ok,
      'a 302 is not success: treating it as one is exactly how an unauthenticated ' +
        'Atlas response would be mistaken for a working contract'
    ).toBe(false);
    expect(result.status).toBe(302);
    expect(result.redirectedTo).toBe('/auth/auth/logout');
    expect(result.responseShapeKeys).toEqual([]);
  });

  it('strips the query string off the redirect target', async () => {
    fetchMock.mockResolvedValue(measuredRedirect());

    const result = await fetchPartnerMovies(TOKEN);

    expect(result.redirectedTo).not.toContain('?');
  });

  /**
   * Atlas is a hash-routed SPA, so the fragment is exactly where a session
   * parameter would sit. `redirectedTo` is logged AND interpolated into the
   * message the caller reads, so a token surviving here lands in Cloud Logging
   * and in the browser at once.
   */
  it.each([
    ['a query string', `/auth/auth/logout?next=%2Fmovies&t=${TOKEN}`, '/auth/auth/logout'],
    ['a hash route with a query token', `/#/auth?token=${TOKEN}`, '/'],
    ['a hash route with a fragment token', `/#/auth#token=${TOKEN}`, '/'],
    ['a token in a hash path segment', `/#/session/${TOKEN}`, '/'],
  ])('keeps a token out of the redirect target: %s', async (_case, location, expected) => {
    fetchMock.mockResolvedValue(new Response('', { status: 302, headers: { location } }));

    const result = await fetchPartnerMovies(TOKEN);

    expect(
      result.redirectedTo,
      `a Location of "${location}" must not survive into the diagnostics: cutting only ` +
        'at "?" leaves the fragment intact, and in a hash-routed SPA the fragment is ' +
        'where the credential lives'
    ).toBe(expected);
    expect(JSON.stringify(logged)).not.toContain(TOKEN);
  });

  it('redacts a token sitting in a plain path segment, where truncation cannot reach it', async () => {
    fetchMock.mockResolvedValue(
      new Response('', { status: 302, headers: { location: `/session/${TOKEN}/renew` } })
    );

    const result = await fetchPartnerMovies(TOKEN);

    expect(result.redirectedTo).not.toContain(TOKEN);
    expect(
      result.redirectedTo,
      'the path is still worth reporting; only the credential inside it is removed'
    ).toBe('/session/[redacted]/renew');
  });

  it('reports top-level keys of a JSON object body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(documentedSuccess));

    const result = await fetchPartnerMovies(TOKEN);

    expect(result.ok).toBe(true);
    expect(result.bodyKind).toBe('json');
    expect(result.responseShapeKeys).toEqual(['status', 'data']);
  });

  it('reports an HTML body as text with no shape keys instead of throwing', async () => {
    fetchMock.mockResolvedValue(
      new Response('<!doctype html><title>Atlas</title>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    );

    const result = await fetchPartnerMovies(TOKEN);

    expect(result.bodyKind).toBe('text');
    expect(result.json).toBeNull();
    expect(result.responseShapeKeys).toEqual([]);
  });

  it('distinguishes an empty body from a non-JSON one', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 204 }));

    const result = await fetchPartnerMovies(TOKEN);

    expect(result.bodyKind).toBe('empty');
  });

  it('reports a transport failure as status 0 rather than throwing', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed: ENOTFOUND'));

    const result = await fetchPartnerMovies(TOKEN);

    expect(
      result.status,
      'the route builds one diagnostics shape for every outcome; a thrown error here ' +
        'would surface as a 500 with no stage instead of stage:"atlas_call"'
    ).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.networkError).toContain('ENOTFOUND');
  });

  it('reports a missing base URL without calling the network', async () => {
    delete process.env.ATLAS_API_BASE_URL;

    const result = await fetchPartnerMovies(TOKEN);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.status).toBe(0);
    expect(result.networkError).toMatch(/ATLAS_API_BASE_URL/);
  });
});

describe('token handling', () => {
  it('describes a token by length and a short prefix only', () => {
    expect(describeToken(TOKEN)).toEqual({ length: TOKEN.length, prefix: 'eyJhbG' });
  });

  it.each([
    ['a successful call', () => jsonResponse(documentedSuccess), false],
    ['a 302 from Atlas', measuredRedirect, false],
    ['a transport failure', () => new TypeError('boom'), true],
  ])('never puts the token in a log line or the result on %s', async (_case, make, rejects) => {
    if (rejects) fetchMock.mockRejectedValue(make());
    else fetchMock.mockResolvedValue(make());

    const result = await fetchPartnerMovies(TOKEN);

    expect(logged.length).toBeGreaterThan(0);
    expect(
      JSON.stringify(logged),
      'the Atlas JWT is a live credential: logging it copies it into Cloud Logging, ' +
        'where it outlives the 24h expiry of any incident response'
    ).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('logs the fingerprint so a support case can still tell tokens apart', async () => {
    fetchMock.mockResolvedValue(jsonResponse(documentedSuccess));

    await fetchPartnerMovies(TOKEN);

    expect(JSON.stringify(logged)).toContain('"tokenPrefix":"eyJhbG"');
  });
});
