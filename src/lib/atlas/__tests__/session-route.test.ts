import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Tests for POST /api/auth/atlas/session (Contract A).
 *
 * Lives under src/lib/atlas/__tests__ rather than beside the route so the whole
 * Atlas domain has one test location.
 *
 * Stubbing happens at the two real boundaries and nowhere else:
 *   - the network (global fetch), so the actual client builds the URL, headers
 *     and redirect policy and the actual Zod schemas unpack the body;
 *   - Firestore and the cookie jar, which cannot run in a unit test.
 * Everything between them is the production code path.
 */

const logged: unknown[] = [];

vi.mock('@/lib/logger', () => {
  const record = (payload: unknown, message?: unknown) => logged.push({ payload, message });

  return {
    createLogger: () => ({ info: record, warn: record, error: record, debug: record }),
    default: { info: record, warn: record, error: record },
  };
});

const getOrCreatePartner = vi.fn();
vi.mock('@/models/partner', () => ({
  getOrCreatePartner: (...args: unknown[]) => getOrCreatePartner(...args),
}));

const createSessionToken = vi.fn();
const setSessionCookie = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  createSessionToken: (...args: unknown[]) => createSessionToken(...args),
  setSessionCookie: (...args: unknown[]) => setSessionCookie(...args),
}));

const { POST } = await import('@/app/api/auth/atlas/session/route');
const { resetAtlasSessionQuota } = await import('@/lib/atlas/rate-limit');

const BASE = 'https://dashboard.pijamafilms.com';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.PAYLOAD-THAT-MUST-NEVER-LEAK.sig';
const ALLOWED_PARTNER = 'partner-a';

/**
 * FIXTURE PROVENANCE — read before trusting a green test here.
 *
 * ASSUMED (documented by Crazy Cake, never observed): every 2xx body below.
 * MEASURED (T0 probes, 2026-08-26): the 302 to /auth/auth/logout, returned
 * identically with no token and with an invalid one.
 */
const documentedSuccess = {
  status: 'ok',
  data: {
    partner: {
      name: 'Pijama Films',
      email: 'partner@example.com',
      muviUuid: 'muvi-partner-1',
      partnerId: ALLOWED_PARTNER,
    },
    movies: [
      { _id: '1', title: 'Film One', muviUuid: 'muvi-1' },
      { _id: '2', title: 'Film Two', muviUuid: 'muvi-2' },
      { _id: '3', title: 'Film Three', muviUuid: 'muvi-3' },
      { _id: '4', title: 'Film Four', muviUuid: 'muvi-4' },
    ],
  },
};

/** The administrator case: the contract answers, but this account is not a partner. */
const adminAccountSuccess = {
  status: 'ok',
  data: { partner: null, movies: [] },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function measuredRedirect(): Response {
  return new Response('', {
    status: 302,
    headers: { location: '/auth/auth/logout' },
  });
}

function request(body: unknown): NextRequest {
  return new NextRequest('https://promote.pijamafilms.com/api/auth/atlas/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  logged.length = 0;
  // Every request here is unattributed, so they all share one bucket. Without
  // this the suite would exhaust its own quota partway through and the failures
  // would look like route bugs.
  resetAtlasSessionQuota();
  getOrCreatePartner.mockReset().mockResolvedValue({ id: 'doc-1', partnerId: ALLOWED_PARTNER });
  createSessionToken.mockReset().mockResolvedValue('signed-session-token');
  setSessionCookie.mockReset().mockResolvedValue(undefined);

  fetchMock = vi.fn().mockResolvedValue(jsonResponse(documentedSuccess));
  vi.stubGlobal('fetch', fetchMock);

  process.env.ATLAS_API_BASE_URL = BASE;
  process.env.ATLAS_LOGIN_ENABLED = 'true';
  process.env.ATLAS_LOGIN_ALLOWED_PARTNER_IDS = ALLOWED_PARTNER;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ATLAS_API_BASE_URL;
  delete process.env.ATLAS_LOGIN_ENABLED;
  delete process.env.ATLAS_LOGIN_ALLOWED_PARTNER_IDS;
});

// ============================================================================
// stage: input
// ============================================================================

describe('stage input', () => {
  it('rejects a body that is not JSON', async () => {
    const res = await POST(request('not json at all'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toMatchObject({ ok: false, stage: 'input' });
  });

  it.each([
    ['a missing mode', { token: TOKEN }],
    ['an unknown mode', { token: TOKEN, mode: 'admin' }],
    ['an empty token', { token: '', mode: 'probe' }],
    ['a non-string token', { token: 42, mode: 'probe' }],
    ['an extra field', { token: TOKEN, mode: 'probe', partnerId: 'partner-a' }],
  ])('rejects %s with stage input and never calls Atlas', async (_case, body) => {
    const res = await POST(request(body));
    const parsed = await res.json();

    expect(res.status).toBe(400);
    expect(parsed.stage).toBe('input');
    expect(
      fetchMock,
      'a request that failed validation must not reach Atlas: forwarding an ' +
        'unvalidated token upstream is a credential leaving our perimeter for nothing'
    ).not.toHaveBeenCalled();
  });

  it('does not echo the submitted token in the validation error', async () => {
    const res = await POST(request({ token: TOKEN, mode: 'nope' }));

    expect(JSON.stringify(await res.json())).not.toContain(TOKEN);
  });
});

// ============================================================================
// stage: allowlist
// ============================================================================

describe('stage allowlist', () => {
  it('refuses login when the allowlist is absent, before calling Atlas', async () => {
    delete process.env.ATLAS_LOGIN_ALLOWED_PARTNER_IDS;

    const res = await POST(request({ token: TOKEN, mode: 'login' }));
    const body = await res.json();

    expect(
      body.stage,
      'an absent ATLAS_LOGIN_ALLOWED_PARTNER_IDS must reject every login. The allowlist ' +
        'is the only containment for a known hole: getFilms() does not filter by partner, ' +
        'so one unintended session sees the entire catalogue'
    ).toBe('allowlist');
    expect(res.status).toBe(403);
    expect(body.ok).toBe(false);
    expect(setSessionCookie).not.toHaveBeenCalled();
    expect(getOrCreatePartner).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['', '   ', ',', ' , , '])(
    'refuses login when the allowlist is %o',
    async (value) => {
      process.env.ATLAS_LOGIN_ALLOWED_PARTNER_IDS = value;

      const res = await POST(request({ token: TOKEN, mode: 'login' }));
      const body = await res.json();

      expect(
        body.stage,
        `ATLAS_LOGIN_ALLOWED_PARTNER_IDS=${JSON.stringify(value)} names no partner, so ` +
          'it must admit nobody - never "empty means all"'
      ).toBe('allowlist');
      expect(setSessionCookie).not.toHaveBeenCalled();
    }
  );

  it('refuses login with stage disabled when ATLAS_LOGIN_ENABLED is not "true"', async () => {
    process.env.ATLAS_LOGIN_ENABLED = 'false';

    const res = await POST(request({ token: TOKEN, mode: 'login' }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(
      body.stage,
      'an environment kill switch and an unlisted partner are different problems with ' +
        'different fixes; folding both into "allowlist" makes the operator parse prose ' +
        'to find out which one they have'
    ).toBe('disabled');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps disabled and allowlist as distinct stages', async () => {
    process.env.ATLAS_LOGIN_ENABLED = 'false';
    const disabled = await (await POST(request({ token: TOKEN, mode: 'login' }))).json();

    process.env.ATLAS_LOGIN_ENABLED = 'true';
    process.env.ATLAS_LOGIN_ALLOWED_PARTNER_IDS = 'someone-else';
    const unlisted = await (await POST(request({ token: TOKEN, mode: 'login' }))).json();

    expect(disabled.stage).toBe('disabled');
    expect(unlisted.stage).toBe('allowlist');
  });

  it('refuses a partner Atlas vouched for but the allowlist does not name', async () => {
    process.env.ATLAS_LOGIN_ALLOWED_PARTNER_IDS = 'someone-else';

    const res = await POST(request({ token: TOKEN, mode: 'login' }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.stage).toBe('allowlist');
    expect(
      setSessionCookie,
      'Atlas authenticating a partner is not the same as us authorizing it; the ' +
        'allowlist is the second gate and it has to hold on its own'
    ).not.toHaveBeenCalled();
    expect(getOrCreatePartner).not.toHaveBeenCalled();
    // Diagnostics still travel, so the operator can see who was refused.
    expect(body.diagnostics.partner.partnerId).toBe(ALLOWED_PARTNER);
  });
});

// ============================================================================
// stage: atlas_call
// ============================================================================

describe('stage atlas_call', () => {
  it('reports the measured 302 to a probe as a result, not as a failure', async () => {
    fetchMock.mockResolvedValue(measuredRedirect());

    const res = await POST(request({ token: TOKEN, mode: 'probe' }));
    const body = await res.json();

    // The 302 is the ONLY behaviour ever measured against the real Atlas. If the
    // probe answered it with 502 + ok:false, the first real test with JP's token
    // would read as "the probe failed" while it had in fact measured something -
    // and the diagnostics, the only thing a probe exists to produce, would be
    // buried inside an error envelope.
    expect(
      res.status,
      'a probe that reaches Atlas has succeeded at its job whatever Atlas said; ' +
        'reporting 502 here turns a measurement into a false negative'
    ).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.diagnostics.atlasStatus).toBe(302);
    expect(body.diagnostics.atlasUrlTried).toBe(`${BASE}/movies/by-partner`);
    expect(body.diagnostics.contractMatched).toBe(false);
  });

  it.each([401, 403, 500])('reports HTTP %i to a probe as a result too', async (status) => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'nope' }, status));

    const res = await POST(request({ token: TOKEN, mode: 'probe' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.diagnostics.atlasStatus).toBe(status);
    expect(
      body.diagnostics.contractMatched,
      'a documented-looking body attached to a non-2xx is not a usable answer'
    ).toBe(false);
  });

  it('still refuses a login when Atlas answers non-2xx', async () => {
    fetchMock.mockResolvedValue(measuredRedirect());

    const res = await POST(request({ token: TOKEN, mode: 'login' }));
    const body = await res.json();

    expect(
      body.stage,
      'login judges where probe reports: a 302 means the token was not accepted, ' +
        'and minting a session off that would be inventing an identity'
    ).toBe('atlas_call');
    expect(res.status).toBe(502);
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it('does not treat a documented body attached to a 302 as a matched contract', async () => {
    fetchMock.mockResolvedValue(jsonResponse(documentedSuccess, 302));

    const res = await POST(request({ token: TOKEN, mode: 'login' }));
    const body = await res.json();

    expect(body.stage).toBe('atlas_call');
    expect(body.diagnostics.contractMatched).toBe(false);
    expect(body.diagnostics.partner).toBeNull();
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it('reports an unreachable Atlas as atlas_call with status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed: ENOTFOUND'));

    const res = await POST(request({ token: TOKEN, mode: 'probe' }));
    const body = await res.json();

    expect(body.stage).toBe('atlas_call');
    expect(body.diagnostics.atlasStatus).toBe(0);
  });

  it('keeps atlas_call for a transport failure, which is the only thing it now means', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed: ECONNREFUSED'));

    const res = await POST(request({ token: TOKEN, mode: 'login' }));
    const body = await res.json();

    expect(
      body.stage,
      'a refused connection IS an absence of an HTTP response from Atlas. Narrowing ' +
        'the stage must not empty it: this is the case it exists for'
    ).toBe('atlas_call');
    expect(res.status).toBe(502);
  });
});

// ============================================================================
// mode: probe
// ============================================================================

describe('mode probe', () => {
  it('never mints a session and never creates a partner, even on a perfect response', async () => {
    const res = await POST(request({ token: TOKEN, mode: 'probe' }));

    expect(res.status).toBe(200);
    expect(
      setSessionCookie,
      'probe exists so a human can measure the unverified upstream contract; if it ' +
        'could mint a session, measuring would itself be the risk it is meant to avoid'
    ).not.toHaveBeenCalled();
    expect(getOrCreatePartner).not.toHaveBeenCalled();
    expect(createSessionToken).not.toHaveBeenCalled();
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('works while login is disabled and the allowlist is empty', async () => {
    process.env.ATLAS_LOGIN_ENABLED = 'false';
    delete process.env.ATLAS_LOGIN_ALLOWED_PARTNER_IDS;

    const res = await POST(request({ token: TOKEN, mode: 'probe' }));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.diagnostics.contractMatched).toBe(true);
  });

  it('reports partner, counts and a sample capped at three', async () => {
    const res = await POST(request({ token: TOKEN, mode: 'probe' }));
    const body = await res.json();

    expect(body.diagnostics.partner).toEqual({
      name: 'Pijama Films',
      email: 'partner@example.com',
      muviUuid: 'muvi-partner-1',
      partnerId: ALLOWED_PARTNER,
    });
    expect(body.diagnostics.movieCount).toBe(4);
    expect(
      body.diagnostics.movieSample,
      'the sample is a fixed-size diagnostic, not a catalogue dump: an unbounded ' +
        'sample would put a partner\'s whole library in a response meant for a debug panel'
    ).toHaveLength(3);
    expect(body.diagnostics.movieSample[0]).toEqual({ title: 'Film One', muviUuid: 'muvi-1' });
  });

  it('reports raw shape keys when Atlas answers 2xx in some other shape', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'TOKEN_EXPIRED' }));

    const res = await POST(request({ token: TOKEN, mode: 'probe' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(
      body.diagnostics.contractMatched,
      'reporting an unrecognised 2xx body as a match is how an integration gets ' +
        'declared working on a shape nobody has read'
    ).toBe(false);
    expect(body.diagnostics.responseShapeKeys).toEqual(['error']);
    expect(body.diagnostics.partner).toBeNull();
  });

  it('reports no shape keys when the 2xx body is not JSON', async () => {
    fetchMock.mockResolvedValue(
      new Response('<!doctype html><title>Atlas</title>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    );

    const res = await POST(request({ token: TOKEN, mode: 'probe' }));
    const body = await res.json();

    expect(body.diagnostics.contractMatched).toBe(false);
    expect(body.diagnostics.responseShapeKeys).toEqual([]);
  });

  it('keeps "not a partner" distinguishable from "contract broken"', async () => {
    fetchMock.mockResolvedValue(jsonResponse(adminAccountSuccess));

    const res = await POST(request({ token: TOKEN, mode: 'probe' }));
    const body = await res.json();

    // The account available for the real test is an administrator, and
    // /movies/by-partner is partner-scoped. This triple is the whole signal:
    // the contract answered, in shape, with no partner attached.
    expect(
      body.diagnostics,
      'an admin account with no partnerId must not look like a broken upstream: ' +
        'the two have opposite next steps - ask JP for a producer account, versus ' +
        'go back to Crazy Cake'
    ).toMatchObject({
      atlasStatus: 200,
      contractMatched: true,
      partner: null,
      responseShapeKeys: ['status', 'data'],
    });
  });
});

// ============================================================================
// mode: login
// ============================================================================

describe('mode login', () => {
  it('mints a session for an allowlisted partner', async () => {
    const res = await POST(request({ token: TOKEN, mode: 'login' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, redirectTo: '/films' });
    expect(getOrCreatePartner).toHaveBeenCalledWith(ALLOWED_PARTNER, 'Pijama Films');
    expect(setSessionCookie).toHaveBeenCalledWith('signed-session-token');
  });

  it('puts the external partner id, not a Firestore doc id, in the session', async () => {
    getOrCreatePartner.mockResolvedValue({ id: 'firestore-doc-id', partnerId: ALLOWED_PARTNER });

    await POST(request({ token: TOKEN, mode: 'login' }));

    expect(
      createSessionToken,
      'every consumer resolves session.partnerId through getPartnerByPartnerId, i.e. ' +
        'the external id; storing the doc id here logs the partner into nothing'
    ).toHaveBeenCalledWith({
      uid: `atlas:${ALLOWED_PARTNER}`,
      email: 'partner@example.com',
      name: 'Pijama Films',
      partnerId: ALLOWED_PARTNER,
    });
  });

  it('refuses an administrator account with stage no_partner, not contract', async () => {
    fetchMock.mockResolvedValue(jsonResponse(adminAccountSuccess));

    const res = await POST(request({ token: TOKEN, mode: 'login' }));
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(
      body.stage,
      'the envelope matched, so the contract is not broken: Atlas correctly said this ' +
        'token has no partner. Calling it "contract" sends the reader to Crazy Cake ' +
        'when the fix is to ask for a producer account'
    ).toBe('no_partner');
    expect(
      res.status,
      '422, not 403: the request was well-formed and the caller authenticated fine; ' +
        'what is unusable is the content Atlas returned for it'
    ).toBe(422);
    expect(
      setSessionCookie,
      'with no partnerId there is nothing to authorize against; inventing a session ' +
        'here would hand an admin token a partner-scoped dashboard'
    ).not.toHaveBeenCalled();
    expect(body.diagnostics.contractMatched).toBe(true);
    expect(body.message).toMatch(/no partner associated/i);
  });

  it('refuses with no_partner when the partner object is an empty one', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ status: 'ok', data: { movies: [] } })
    );

    const res = await POST(request({ token: TOKEN, mode: 'login' }));
    const body = await res.json();

    expect(body.stage).toBe('no_partner');
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it('refuses to log in on a 2xx body in an unrecognised shape', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'TOKEN_EXPIRED' }));

    const res = await POST(request({ token: TOKEN, mode: 'login' }));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.stage).toBe('contract');
    expect(body.diagnostics.responseShapeKeys).toEqual(['error']);
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it('refuses to log in when the envelope reports a non-ok status', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ status: 'error', data: { partner: documentedSuccess.data.partner, movies: [] } })
    );

    const res = await POST(request({ token: TOKEN, mode: 'login' }));
    const body = await res.json();

    expect(
      body.stage,
      'the envelope carries its own verdict; authorizing off data attached to ' +
        'status:"error" is trusting a payload Atlas already disowned'
    ).toBe('contract');
    expect(body.diagnostics.contractMatched).toBe(false);
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it('refuses to log in when the envelope has no movies key at all', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ status: 'ok', data: { partner: documentedSuccess.data.partner } })
    );

    const res = await POST(request({ token: TOKEN, mode: 'login' }));
    const body = await res.json();

    // Deliberately strict, and deliberately fail-closed: a body missing a
    // documented key is a divergence to report to the humans, not something to
    // absorb quietly. The probe will name it via responseShapeKeys.
    expect(body.stage).toBe('contract');
    expect(body.diagnostics.contractMatched).toBe(false);
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  /**
   * One case per missing field, on purpose. The earlier single case dropped both
   * `partnerId` and `muviUuid` at once, so it went green on the absence of
   * `muviUuid` and proved nothing about `partnerId` - the field the whole
   * authorization hangs on. Making `partnerId` optional left that test green.
   */
  it.each([
    [
      'partnerId',
      { name: 'Pijama Films', email: 'p@example.com', muviUuid: 'muvi-partner-1' },
    ],
    [
      'muviUuid',
      { name: 'Pijama Films', email: 'p@example.com', partnerId: ALLOWED_PARTNER },
    ],
    ['name', { email: 'p@example.com', muviUuid: 'm', partnerId: ALLOWED_PARTNER }],
    ['email', { name: 'Pijama Films', muviUuid: 'm', partnerId: ALLOWED_PARTNER }],
  ])('refuses to log in when the partner object is missing %s', async (field, partner) => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok', data: { partner, movies: [] } }));

    const res = await POST(request({ token: TOKEN, mode: 'login' }));
    const body = await res.json();

    expect(
      body.stage,
      `a partner missing "${field}" is a contract mismatch, not an account without a ` +
        'partner: a present-but-incomplete partner means Atlas changed shape, and ' +
        'defaulting the field would authorize against a guess'
    ).toBe('contract');
    expect(body.diagnostics.contractMatched).toBe(false);
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it('refuses to log in when partnerId is present but empty', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: 'ok',
        data: {
          partner: { name: 'P', email: 'p@example.com', muviUuid: 'm', partnerId: '' },
          movies: [],
        },
      })
    );

    const res = await POST(request({ token: TOKEN, mode: 'login' }));
    const body = await res.json();

    expect(
      body.stage,
      'an empty partnerId is not an identity; it would also match nothing on the ' +
        'allowlist, but it must never get that far'
    ).toBe('contract');
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it('reports stage session when the partner upsert fails', async () => {
    getOrCreatePartner.mockRejectedValue(new Error('Firestore unavailable'));

    const res = await POST(request({ token: TOKEN, mode: 'login' }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.stage).toBe('session');
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it('reports stage session when the cookie cannot be set', async () => {
    setSessionCookie.mockRejectedValue(new Error('cookies() unavailable'));

    const res = await POST(request({ token: TOKEN, mode: 'login' }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.stage).toBe('session');
  });

  it('does not leak internal error detail to the caller', async () => {
    getOrCreatePartner.mockRejectedValue(new Error('Firestore unavailable at 10.1.2.3'));

    const res = await POST(request({ token: TOKEN, mode: 'login' }));

    expect(JSON.stringify(await res.json())).not.toContain('10.1.2.3');
  });
});

// ============================================================================
// cross-cutting: the token
// ============================================================================

describe('token handling across every path', () => {
  const cases: Array<[string, () => void, 'probe' | 'login']> = [
    ['a successful login', () => {}, 'login'],
    ['a probe', () => {}, 'probe'],
    ['a 302 from Atlas', () => fetchMock.mockResolvedValue(measuredRedirect()), 'probe'],
    [
      'a 302 whose Location carries a token in the fragment',
      () =>
        fetchMock.mockResolvedValue(
          new Response('', { status: 302, headers: { location: `/#/auth#token=${TOKEN}` } })
        ),
      'login',
    ],
    [
      'an allowlist refusal',
      () => {
        delete process.env.ATLAS_LOGIN_ALLOWED_PARTNER_IDS;
      },
      'login',
    ],
    [
      'a session failure',
      () => getOrCreatePartner.mockRejectedValue(new Error('down')),
      'login',
    ],
  ];

  it.each(cases)('keeps the token out of the response and the logs on %s', async (_case, arrange, mode) => {
    arrange();

    const res = await POST(request({ token: TOKEN, mode }));
    const raw = await res.text();

    expect(
      raw,
      'the Atlas JWT is a live credential valid for 24h; echoing it puts it in the ' +
        'browser devtools and in any proxy log between here and the caller'
    ).not.toContain(TOKEN);
    expect(JSON.stringify(logged)).not.toContain(TOKEN);
  });

  it('logs the request with a fingerprint instead of the token', async () => {
    await POST(request({ token: TOKEN, mode: 'probe' }));

    expect(JSON.stringify(logged)).toContain('"tokenPrefix":"eyJhbG"');
  });
});

// ============================================================================
// stage: rate_limited
// ============================================================================

describe('stage rate_limited', () => {
  it('refuses past the per-caller budget, with a stage and a Retry-After', async () => {
    const from = (ip: string) =>
      new NextRequest('https://promote.pijamafilms.com/api/auth/atlas/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ token: TOKEN, mode: 'probe' }),
      });

    for (let i = 0; i < 20; i++) {
      expect((await POST(from('9.9.9.9'))).status).toBe(200);
    }

    const res = await POST(from('9.9.9.9'));
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(
      body.stage,
      'Contract A says every error carries a stage; answering a rate limit with the ' +
        'house { error, code } shape would break the envelope T2 parses'
    ).toBe('rate_limited');
    expect(body.ok).toBe(false);
    expect(res.headers.get('retry-after')).toBeTruthy();
  });

  it('counts before parsing, so malformed bodies cannot flood for free', async () => {
    const junk = () =>
      new NextRequest('https://promote.pijamafilms.com/api/auth/atlas/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '8.8.8.8' },
        body: 'not json',
      });

    for (let i = 0; i < 20; i++) await POST(junk());

    expect(
      (await POST(junk())).status,
      'a flood of garbage costs the same to serve as a flood of valid requests'
    ).toBe(429);
  });

  it('does not let one noisy caller lock out another', async () => {
    const from = (ip: string) =>
      new NextRequest('https://promote.pijamafilms.com/api/auth/atlas/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ token: TOKEN, mode: 'probe' }),
      });

    for (let i = 0; i < 25; i++) await POST(from('7.7.7.7'));

    expect(
      (await POST(from('6.6.6.6'))).status,
      'JP running the real probe must not be blocked by unrelated traffic'
    ).toBe(200);
  });

  it('never reaches Atlas once the caller is over budget', async () => {
    const from = () =>
      new NextRequest('https://promote.pijamafilms.com/api/auth/atlas/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '5.5.5.5' },
        body: JSON.stringify({ token: TOKEN, mode: 'probe' }),
      });

    for (let i = 0; i < 20; i++) await POST(from());
    const callsBefore = fetchMock.mock.calls.length;

    await POST(from());

    expect(
      fetchMock.mock.calls.length,
      'the whole point is to stop the outbound call; a limiter that still calls Atlas ' +
        'buys nothing'
    ).toBe(callsBefore);
  });
});

// ============================================================================
// stage: input - a token that cannot travel in an HTTP header
//
// REGRESSION, measured 2026-08-28. A user pasted a JavaScript fragment into the
// token field. The response was:
//
//   502 { ok:false, stage:'atlas_call', message:'Atlas produced no HTTP
//         response: TypeError: Headers.append: "Bearer const r = await
//         fetch(...)\nconsole.log(r)" is an invalid header value.' }
//
// Two defects in one envelope: the stage blamed the third party for our own
// input error (and the /auth page, which derives its conclusion from the stage,
// told the user "Atlas could not be reached at all"), and the pasted value came
// back in full inside the message - a live token would have leaked into the
// response and the logs.
// ============================================================================

const ctrl = String.fromCharCode;
const PASTED_SCRIPT = 'const r = await fetch(...)\nconsole.log(r)\n';

describe('stage input - header safety', () => {
  it.each([
    ['the pasted script that produced the 502', PASTED_SCRIPT],
    ['a line feed', 'abc' + ctrl(10) + 'def'],
    ['a carriage return', 'abc' + ctrl(13) + 'def'],
    ['a tab', 'abc' + ctrl(9) + 'def'],
    ['a NUL', 'abc' + ctrl(0) + 'def'],
    ['an internal space', 'abc def'],
    ['a non-ASCII accent', 'abc' + ctrl(233) + 'def'],
    ['an emoji', 'abc\u{1F3AC}def'],
  ])('rejects a token containing %s at stage input, without calling Atlas', async (_case, token) => {
    const res = await POST(request({ token, mode: 'probe' }));
    const body = await res.json();

    expect(
      body.stage,
      'the value never left this process, so nothing at all is known about Atlas. ' +
        'Reporting atlas_call here made /auth tell the user "Atlas could not be ' +
        'reached", which is us blaming the third party for our own validation hole'
    ).toBe('input');
    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('names what is wrong with the value and says nothing about Atlas', async () => {
    const res = await POST(request({ token: PASTED_SCRIPT, mode: 'probe' }));
    const body = await res.json();

    expect(body.message).toContain('HTTP header');
    // The pasted script trips on the space in "const r" before it reaches the
    // newline: the message names the FIRST offending character, by class and
    // index, which is what makes it actionable.
    expect(body.message).toContain('a space at index 5');
    expect(
      body.message.toLowerCase(),
      'a message that mentions the third party for a fault of ours is how a ' +
        'non-existent bug gets reported to the counterparty'
    ).not.toContain('atlas');
  });

  it('names a control character when that is the first thing wrong', async () => {
    const res = await POST(request({ token: 'abc' + ctrl(10) + 'def', mode: 'probe' }));
    const body = await res.json();

    expect(body.message).toContain('control character');
    expect(
      body.message,
      'a raw newline pasted into the message would be a control character in the ' +
        'HTTP response body itself'
    ).not.toContain(ctrl(10));
  });

  it('masks the rejected value instead of echoing it back', async () => {
    const res = await POST(request({ token: PASTED_SCRIPT, mode: 'probe' }));
    const raw = JSON.stringify(await res.json());

    expect(
      raw,
      'the 502 this replaces returned the pasted fragment in full. If that paste had ' +
        'been a real token, it left in the HTTP response and in the logs'
    ).not.toContain('console.log');
    expect(raw).not.toContain(PASTED_SCRIPT);
    expect(raw, 'length and a 6-char prefix are the fingerprint used everywhere else').toContain(
      String(PASTED_SCRIPT.length)
    );
  });

  it('keeps the rejected value out of the logs too', async () => {
    await POST(request({ token: PASTED_SCRIPT, mode: 'probe' }));

    expect(JSON.stringify(logged)).not.toContain('console.log');
  });

  it('reports input before the login pre-flight, in login mode too', async () => {
    process.env.ATLAS_LOGIN_ENABLED = 'false';

    const res = await POST(request({ token: PASTED_SCRIPT, mode: 'login' }));
    const body = await res.json();

    expect(
      body.stage,
      'a malformed request is malformed whatever the environment flags say; answering ' +
        '"disabled" would send the operator to fix a setting that is not the problem'
    ).toBe('input');
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // THE CONTROL. If these go red, the validation stopped being about headers and
  // started being an opinion about what a token should look like - the exact
  // assumption that has already cost this project once.
  // --------------------------------------------------------------------------
  it('still sends an opaque one-line token that is not a JWT, and reports what Atlas said', async () => {
    fetchMock.mockResolvedValue(measuredRedirect());

    const res = await POST(request({ token: 'basura-sin-saltos', mode: 'probe' }));
    const body = await res.json();

    expect(
      res.status,
      'D1: a probe that got any HTTP response out of Atlas returns 200 - the ' +
        'diagnostics are the product, they do not get buried in an error envelope'
    ).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.diagnostics.atlasStatus).toBe(302);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      (fetchMock.mock.calls[0][1].headers as Record<string, string>).Authorization,
      'the token is opaque. Whether "basura-sin-saltos" is a valid credential is ' +
        'Atlas\' answer to give, not ours to guess from its shape'
    ).toBe('Bearer basura-sin-saltos');
  });

  it('passes a real three-segment JWT through untouched', async () => {
    const res = await POST(request({ token: TOKEN, mode: 'probe' }));

    expect(res.status).toBe(200);
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`
    );
  });

  it.each([
    ['a base64url token with padding', 'AAAA.BBBB.CCCC=='],
    ['an opaque uuid-style token', '9f8e7d6c-5b4a-3210-fedc-ba9876543210'],
    ['a very long single-line token', 'a'.repeat(4096)],
  ])('still forwards %s', async (_case, token) => {
    const res = await POST(request({ token, mode: 'probe' }));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// stage: config - our own deployment is not configured
//
// This used to be `atlas_call`, which /auth renders as "Atlas could not be
// reached at all". An unset ATLAS_API_BASE_URL means we never had an address to
// call: nothing was sent, so nothing is known about Atlas. The old envelope
// sent whoever read it to write to Crazy Cake about a variable of ours - and
// that mail was nearly sent on 2026-08-28.
//
// Same class of defect as the header-unsafe token: our fault, filed under the
// third party. Configuration rather than input does not change who it accuses.
// ============================================================================

describe('stage config', () => {
  it.each(['probe', 'login'])(
    'reports an unset ATLAS_API_BASE_URL as config in %s mode, not as an Atlas failure',
    async (mode) => {
      delete process.env.ATLAS_API_BASE_URL;

      const res = await POST(request({ token: TOKEN, mode }));
      const body = await res.json();

      expect(
        body.stage,
        'we never had an address to call. Reporting atlas_call states that Atlas ' +
          'failed to answer, which is a claim about a third party we did not contact'
      ).toBe('config');
      expect(body.ok).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it('answers 500: the request was fine and no gateway was involved', async () => {
    delete process.env.ATLAS_API_BASE_URL;

    const res = await POST(request({ token: TOKEN, mode: 'probe' }));

    expect(
      res.status,
      '400 would blame the caller for a well-formed request; 502 claims an upstream ' +
        'exchange that never happened. The deployment is what is broken'
    ).toBe(500);
  });

  it('names the variable to set', async () => {
    delete process.env.ATLAS_API_BASE_URL;

    const res = await POST(request({ token: TOKEN, mode: 'probe' }));
    const body = await res.json();

    expect(body.message).toContain('ATLAS_API_BASE_URL');
  });

  it('does not claim anything about reachability', async () => {
    delete process.env.ATLAS_API_BASE_URL;

    const res = await POST(request({ token: TOKEN, mode: 'probe' }));
    const body = await res.json();

    expect(body.message).not.toMatch(/could not be reached|no HTTP response|did not answer/i);
  });

  it('attaches no diagnostics, because there is nothing to diagnose', async () => {
    delete process.env.ATLAS_API_BASE_URL;

    const res = await POST(request({ token: TOKEN, mode: 'probe' }));
    const body = await res.json();

    expect(
      body.diagnostics,
      'a diagnostics block with atlasStatus 0 makes /auth print "the request to Atlas ' +
        'never completed - DNS, timeout or a refused connection", which is the same ' +
        'false accusation coming back through describeAtlasOutcome'
    ).toBeUndefined();
  });

  it('still mints no session', async () => {
    delete process.env.ATLAS_API_BASE_URL;

    await POST(request({ token: TOKEN, mode: 'login' }));

    expect(setSessionCookie).not.toHaveBeenCalled();
    expect(getOrCreatePartner).not.toHaveBeenCalled();
  });
});

// ============================================================================
// the uid format is a SECURITY CONTRACT
// ============================================================================

describe('session uid contract', () => {
  it('mints `atlas:<partnerId>` as the uid, because the catalogue source depends on it', async () => {
    const res = await POST(request({ token: TOKEN, mode: 'login' }));
    expect(res.status).toBe(200);

    const payload = createSessionToken.mock.calls[0][0] as { uid: string; partnerId: string };

    expect(
      payload.uid,
      'getFilms()/getFilmById() (src/models/film.ts resolveCatalogueSource) decide between the ' +
        "partner's own catalogue and the GLOBAL MUVI catalogue by `uid.startsWith(\"atlas:\")`. " +
        'Changing this format silently hands every Atlas session the whole catalogue. ' +
        'Change both sides together, and update the film-catalogue-source tests'
    ).toBe(`atlas:${payload.partnerId}`);
  });
});
