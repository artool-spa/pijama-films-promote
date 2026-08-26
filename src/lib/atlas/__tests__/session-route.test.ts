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

  it('refuses login when ATLAS_LOGIN_ENABLED is not "true"', async () => {
    process.env.ATLAS_LOGIN_ENABLED = 'false';

    const res = await POST(request({ token: TOKEN, mode: 'login' }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.stage).toBe('allowlist');
    expect(fetchMock).not.toHaveBeenCalled();
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
  it('reports the measured 302 as atlas_call, with the status in the diagnostics', async () => {
    fetchMock.mockResolvedValue(measuredRedirect());

    const res = await POST(request({ token: TOKEN, mode: 'probe' }));
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.stage).toBe('atlas_call');
    expect(body.diagnostics.atlasStatus).toBe(302);
    expect(body.diagnostics.atlasUrlTried).toBe(`${BASE}/movies/by-partner`);
    expect(body.diagnostics.contractMatched).toBe(false);
  });

  it('reports an unreachable Atlas as atlas_call with status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed: ENOTFOUND'));

    const res = await POST(request({ token: TOKEN, mode: 'probe' }));
    const body = await res.json();

    expect(body.stage).toBe('atlas_call');
    expect(body.diagnostics.atlasStatus).toBe(0);
  });

  it('reports a missing ATLAS_API_BASE_URL as atlas_call, not as a crash', async () => {
    delete process.env.ATLAS_API_BASE_URL;

    const res = await POST(request({ token: TOKEN, mode: 'probe' }));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.stage).toBe('atlas_call');
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

  it('refuses to log in an administrator account that carries no partner', async () => {
    fetchMock.mockResolvedValue(jsonResponse(adminAccountSuccess));

    const res = await POST(request({ token: TOKEN, mode: 'login' }));
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.stage).toBe('contract');
    expect(
      setSessionCookie,
      'with no partnerId there is nothing to authorize against; inventing a session ' +
        'here would hand an admin token a partner-scoped dashboard'
    ).not.toHaveBeenCalled();
    expect(body.diagnostics.contractMatched).toBe(true);
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

  it('refuses to log in when the partner object is present but malformed', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: 'ok',
        data: { partner: { name: 'Pijama Films', email: 'p@example.com' }, movies: [] },
      })
    );

    const res = await POST(request({ token: TOKEN, mode: 'login' }));
    const body = await res.json();

    expect(
      body.stage,
      'a partner without partnerId is a contract mismatch, not an account without a ' +
        'partner id: defaulting the missing field would authorize against a guess'
    ).toBe('contract');
    expect(body.diagnostics.contractMatched).toBe(false);
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
