import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ATLAS_BRIDGE_GLOBAL, type AtlasBridge } from '../atlas-bridge';
import { buildBridgeScript } from '../bridge-script';
import AtlasAuthClient from '../client';

const LAB = 'https://dashboard-lab.pijamafilms.com';
const PROD = 'https://dashboard.pijamafilms.com';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.SECRET-PAYLOAD-MUST-NEVER-RENDER.sig';

const push = vi.fn();
const refresh = vi.fn();

// A single stable object, the way the real router hook behaves.
const router = { push, refresh, replace: vi.fn(), prefetch: vi.fn() };

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

/** Runs the real inline script, so the tests exercise what the browser runs. */
function installBridge(allowedOrigins: string[] = [LAB, PROD]): AtlasBridge {
  Object.defineProperty(window, 'opener', { value: null, configurable: true, writable: true });
  new Function(buildBridgeScript({ allowedOrigins, allowSelfOrigin: false }))();
  return (window as unknown as Record<string, unknown>)[ATLAS_BRIDGE_GLOBAL] as AtlasBridge;
}

function post(data: unknown, origin: string) {
  window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

function validEnvelope(token = TOKEN) {
  return {
    type: 'ATLAS_AUTH',
    token,
    partner: { name: 'Pijama Films', email: 'producer@example.test' },
  };
}

function respondWith(status: number, body: unknown, jsonThrows = false) {
  const fetchMock = vi.fn().mockResolvedValue({
    status,
    ok: status < 400,
    json: jsonThrows
      ? () => Promise.reject(new SyntaxError('Unexpected token <'))
      : () => Promise.resolve(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderClient(overrides: Partial<React.ComponentProps<typeof AtlasAuthClient>> = {}) {
  return render(
    <AtlasAuthClient
      allowedOrigins={[LAB, PROD]}
      allowSelfOrigin={false}
      usingDefaultOrigins={false}
      mode="probe"
      timeoutMs={20_000}
      {...overrides}
    />
  );
}

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  delete (window as unknown as Record<string, unknown>)[ATLAS_BRIDGE_GLOBAL];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete (window as unknown as Record<string, unknown>)[ATLAS_BRIDGE_GLOBAL];
});

describe('AtlasAuthClient — waiting state', () => {
  it('shows the configured allowlist and that the listener is installed', () => {
    installBridge();
    renderClient();

    expect(screen.getByText('Waiting for Atlas Console')).toBeTruthy();
    expect(screen.getByText('installed')).toBeTruthy();
    expect(screen.getByText(`${LAB}, ${PROD}`)).toBeTruthy();
  });

  it('says so when the pre-paint script never ran', () => {
    // No installBridge() on purpose: this is the symptom of the script not
    // reaching the HTML, which would silently lose every message.
    renderClient();

    expect(screen.getByText('NOT installed')).toBeTruthy();
  });
});

describe('AtlasAuthClient — buffered delivery', () => {
  it('picks up a message that arrived before the view mounted', async () => {
    const fetchMock = respondWith(200, { ok: true, diagnostics: { atlasStatus: 200 } });
    installBridge();

    // Posted while only the inline script exists — the race this page is built for.
    post(validEnvelope(), LAB);

    renderClient();

    expect(await screen.findByText('buffered pre-mount')).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/atlas/session');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: TOKEN, mode: 'probe' });
  });

  it('picks up a message that arrives after the view mounted, marked live', async () => {
    respondWith(200, { ok: true, diagnostics: {} });
    installBridge();
    renderClient();

    await act(async () => {
      post(validEnvelope(), PROD);
    });

    expect(await screen.findByText('live')).toBeTruthy();
  });

  it('exchanges only once even if Console posts twice', async () => {
    const fetchMock = respondWith(200, { ok: true, diagnostics: {} });
    installBridge();
    renderClient();

    await act(async () => {
      post(validEnvelope(), LAB);
      post(validEnvelope(), LAB);
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});

describe('AtlasAuthClient — the token never reaches the DOM', () => {
  it('renders a fingerprint and not the token', async () => {
    respondWith(200, { ok: true, diagnostics: {} });
    installBridge();
    post(validEnvelope(), LAB);
    const { container } = renderClient();

    await screen.findByText(/present · /);

    expect(container.innerHTML).not.toContain('SECRET-PAYLOAD-MUST-NEVER-RENDER');
    expect(container.innerHTML).not.toContain(TOKEN);
    expect(screen.getByText(`present · ${TOKEN.length} chars · starts with "eyJhbG…"`)).toBeTruthy();
  });

  it('keeps the token out of the DOM even when the exchange fails', async () => {
    respondWith(403, { ok: false, stage: 'allowlist', message: 'partner not allowed' });
    installBridge();
    post(validEnvelope(), LAB);
    const { container } = renderClient();

    await screen.findByText('Sign-in did not complete');

    expect(container.innerHTML).not.toContain('SECRET-PAYLOAD-MUST-NEVER-RENDER');
  });
});

describe('AtlasAuthClient — origin rejection', () => {
  it('rejects an envelope from an origin outside the allowlist and shows the origin', async () => {
    const fetchMock = respondWith(200, { ok: true, diagnostics: {} });
    installBridge([PROD]);
    post(validEnvelope(), 'https://dashboard.pijamafilms.com.evil.io');
    renderClient({ allowedOrigins: [PROD] });

    expect(await screen.findByText('Envelope rejected: origin not allowed')).toBeTruthy();
    // Shown in the banner, in the Origins card and on the event row: the origin
    // that actually arrived is the single most useful fact on this screen.
    expect(screen.getAllByText('https://dashboard.pijamafilms.com.evil.io').length).toBeGreaterThan(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects everything when the allowlist is empty', async () => {
    const fetchMock = respondWith(200, { ok: true, diagnostics: {} });
    installBridge([]);
    post(validEnvelope(), PROD);
    renderClient({ allowedOrigins: [] });

    expect(await screen.findByText('Envelope rejected: origin not allowed')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('AtlasAuthClient — malformed envelope', () => {
  it('reports a Contract B mismatch separately from an origin rejection', async () => {
    const fetchMock = respondWith(200, { ok: true, diagnostics: {} });
    installBridge();
    post({ type: 'ATLAS_AUTH', partner: { name: 'n', email: 'e' } }, LAB);
    renderClient();

    expect(await screen.findByText('Envelope does not match Contract B')).toBeTruthy();
    expect(screen.getByText('absent')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * The envelope the deployed Atlas Console really posts: `{ type, token }`, with no
 * `partner` key. Measured 2026-08-28 from the public production bundle.
 */
function consoleEnvelope(token = TOKEN) {
  return { type: 'ATLAS_AUTH', token };
}

describe('AtlasAuthClient — the envelope Atlas Console actually sends', () => {
  it('accepts it and exchanges the token even though no partner came with it', async () => {
    const fetchMock = respondWith(200, { ok: true, diagnostics: { atlasStatus: 200 } });
    installBridge();
    post(consoleEnvelope(), LAB);
    renderClient();

    await screen.findByText('Accepted');

    // The point of the whole fix: a correct handoff must not be reported as a
    // Contract B mismatch, and the token must still reach Contract A.
    expect(screen.queryByText('Envelope does not match Contract B')).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: TOKEN, mode: 'probe' });
  });

  it('says the partner was not sent, and does not dress it up as a fault', async () => {
    respondWith(200, { ok: true, diagnostics: { atlasStatus: 200 } });
    installBridge();
    post(consoleEnvelope(), LAB);
    renderClient();

    await screen.findByText('Accepted');

    // A mute blank or a bare "not provided" is what made a working handoff look
    // broken. The row has to say that nothing was sent *and* that this is normal.
    expect(screen.getByText(/not sent/)).toBeTruthy();
    expect(screen.getByText(/Atlas Console does not send one/)).toBeTruthy();
  });

  it('still shows the identity when a partner does come with the envelope', async () => {
    respondWith(200, { ok: true, diagnostics: { atlasStatus: 200 } });
    installBridge();
    post(validEnvelope(), LAB);
    renderClient();

    await screen.findByText('Accepted');

    expect(screen.getByText('Pijama Films <producer@example.test>')).toBeTruthy();
    expect(screen.queryByText(/not sent/)).toBeNull();
  });

  it('rejects a partner that is present but malformed, instead of rendering nonsense', async () => {
    const fetchMock = respondWith(200, { ok: true, diagnostics: {} });
    installBridge();
    post({ type: 'ATLAS_AUTH', token: TOKEN, partner: { name: 123, email: null } }, LAB);
    renderClient();

    expect(await screen.findByText('Envelope does not match Contract B')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('AtlasAuthClient — timeout', () => {
  it('distinguishes "nothing arrived" from a failure', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installBridge();
    renderClient({ timeoutMs: 5_000 });

    expect(screen.getByText('Waiting for Atlas Console')).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    expect(screen.getByText('No postMessage arrived within 5 seconds')).toBeTruthy();
    expect(screen.getByText(/Nothing was posted to this window at all/)).toBeTruthy();
  });

  it('does not time out once an envelope has been accepted', async () => {
    respondWith(200, { ok: true, diagnostics: {} });
    installBridge();
    post(validEnvelope(), LAB);
    // Deadline deliberately shorter than the test itself, on real timers: the
    // timer genuinely fires, and the assertion is that it changes nothing.
    renderClient({ timeoutMs: 50 });

    await screen.findByText('Probe succeeded');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });

    expect(screen.queryByText(/No postMessage arrived/)).toBeNull();
    expect(screen.getByText('Probe succeeded')).toBeTruthy();
  });

  it('says something different when messages arrived but none was an envelope', async () => {
    // "Console posted the wrong thing" and "Console never posted" are different
    // findings, and the panel has to be able to tell them apart.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installBridge();
    post({ type: 'SOMETHING_ELSE' }, LAB);
    renderClient({ timeoutMs: 5_000 });

    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    expect(screen.getByText(/Messages did arrive, but none of them was an ATLAS_AUTH/)).toBeTruthy();
    expect(screen.queryByText(/Nothing was posted to this window at all/)).toBeNull();
  });
});

describe('AtlasAuthClient — unrelated messages', () => {
  it('marks a non-envelope message from an allowed origin as ignored', async () => {
    const fetchMock = respondWith(200, { ok: true, diagnostics: {} });
    installBridge();
    post({ type: 'SOMETHING_ELSE' }, LAB);
    renderClient();

    expect(await screen.findByText('Ignored: unrelated message type')).toBeTruthy();
    expect(screen.getByText('SOMETHING_ELSE')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('AtlasAuthClient — Contract A results', () => {
  it('renders probe diagnostics including the raw Atlas response keys', async () => {
    respondWith(200, {
      ok: true,
      diagnostics: {
        atlasUrlTried: 'https://dashboard-lab.pijamafilms.com/movies/by-partner',
        atlasStatus: 302,
        contractMatched: false,
        partner: null,
        movieCount: 0,
        responseShapeKeys: ['error'],
      },
    });
    installBridge();
    post(validEnvelope(), LAB);
    renderClient();

    // This asserted 'Probe succeeded' until 2026-08-28, and that assertion was the
    // bug: the fixture is the production run JP measured — ok:true, 302,
    // contractMatched:false — so the suite was pinning the false green in place.
    // The diagnostics assertions below were always right and are what this test is
    // actually for; only the verdict was wrong.
    expect(await screen.findByText('Atlas answered, but not with the contract')).toBeTruthy();
    expect(screen.queryByText('Probe succeeded')).toBeNull();
    expect(screen.getAllByText('302').length).toBeGreaterThan(0);
    expect(screen.getByText('error')).toBeTruthy();
    expect(screen.getByText('https://dashboard-lab.pijamafilms.com/movies/by-partner')).toBeTruthy();
  });

  it('shows the stage on a failure', async () => {
    respondWith(403, { ok: false, stage: 'allowlist', message: 'partner not in allowlist' });
    installBridge();
    post(validEnvelope(), LAB);
    renderClient();

    expect(await screen.findByText('Sign-in did not complete')).toBeTruthy();
    expect(screen.getByText('allowlist')).toBeTruthy();
    expect(screen.getByText('partner not in allowlist')).toBeTruthy();
  });

  it('degrades an unrecognised stage to the server own message, not to an accusation', async () => {
    // This taxonomy grew three times in a day. A stage this page does not know is
    // far more likely to mean "the server is newer" than "the server is broken",
    // and rendering it as a contract violation sends the reader to the wrong file.
    respondWith(403, { ok: false, stage: 'quota_exceeded', message: 'Out of quota until 10:00.' });
    installBridge();
    post(validEnvelope(), LAB);
    renderClient();

    expect(
      await screen.findByText("quota_exceeded (newer than this page — showing the server's own message)")
    ).toBeTruthy();
    // The message has to reach the "what this means" slot, not merely appear
    // somewhere on the page as the raw Message row.
    expect(screen.getByText('What this means')).toBeTruthy();
    // Three times: the banner verdict, the "what this means" row, and the raw
    // Message row. All three are the server's own words rather than our verdict.
    expect(screen.getAllByText('Out of quota until 10:00.').length).toBe(3);
    expect(screen.queryByText(/not a Contract A stage/)).toBeNull();
  });

  it('explains rate limiting as our own limiter, not a broken integration', async () => {
    respondWith(429, {
      ok: false,
      stage: 'rate_limited',
      message: 'Too many Atlas session requests. Retry in 56s.',
    });
    installBridge();
    post(validEnvelope(), LAB);
    renderClient();

    expect(await screen.findByText('rate_limited')).toBeTruthy();
    expect(screen.getAllByText(/wait a minute and try again/).length).toBeGreaterThan(0);
    expect(screen.getByText('429')).toBeTruthy();
  });

  it('flags an error response that omits the stage entirely', async () => {
    respondWith(500, { ok: false, message: 'boom' });
    installBridge();
    post(validEnvelope(), LAB);
    renderClient();

    expect(
      await screen.findByText('MISSING — Contract A requires a stage on every error')
    ).toBeTruthy();
  });

  it('names a non-JSON body as a missing route', async () => {
    // What a missing endpoint looks like today: Next answers with an HTML 404.
    respondWith(404, null, true);
    installBridge();
    post(validEnvelope(), LAB);
    renderClient();

    expect(await screen.findByText(/body that is not JSON/)).toBeTruthy();
    expect(screen.getByText(/A missing route is the usual cause/)).toBeTruthy();
    expect(
      screen.getByText('transport (detected by this page, not reported by the endpoint)')
    ).toBeTruthy();
  });

  it('names a 401 from the middleware as the middleware, not a missing endpoint', async () => {
    // The exact shape the session middleware returns. It is valid JSON from a
    // route that exists, so "the endpoint is missing" would point at the wrong file.
    respondWith(401, { error: 'Unauthorized' });
    installBridge();
    post(validEnvelope(), LAB);
    renderClient();

    expect(await screen.findByText(/session middleware refusing the request/)).toBeTruthy();
    expect(screen.queryByText(/not JSON/)).toBeNull();
  });

  it('names a JSON body of the wrong shape as a wrong shape', async () => {
    respondWith(200, { status: 'ok', data: {} });
    installBridge();
    post(validEnvelope(), LAB);
    renderClient();

    expect(await screen.findByText(/not a Contract A envelope \(keys: status, data\)/)).toBeTruthy();
  });

  it('says what Atlas did when it redirected instead of answering', async () => {
    // The one Atlas behaviour anyone has measured.
    respondWith(200, {
      ok: true,
      diagnostics: {
        atlasUrlTried: 'https://dashboard.pijamafilms.com/movies/by-partner',
        atlasStatus: 302,
        contractMatched: false,
        partner: null,
        movieCount: 0,
        responseShapeKeys: [],
      },
    });
    installBridge();
    post(validEnvelope(), PROD);
    renderClient();

    expect(await screen.findByText('What Atlas did')).toBeTruthy();
    expect(
      screen.getByText(/either the token was rejected or ATLAS_API_BASE_URL points at the wrong host/)
    ).toBeTruthy();
  });

  it('reports a network failure without crashing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    installBridge();
    post(validEnvelope(), LAB);
    renderClient();

    expect(await screen.findByText(/Could not reach \/api\/auth\/atlas\/session/)).toBeTruthy();
  });
});

/**
 * The banner is the one line a reader takes away, so what it claims has to be the
 * thing that was actually established.
 *
 * Contract D1 makes the probe answer `ok: true` whenever Atlas produced any HTTP
 * response at all, so the diagnostics are never buried inside an error. That is
 * correct and stays. But `ok` means "Atlas answered", not "the contract held", and
 * the banner used to read the first as the second — printing "the contract was
 * exercised end to end" over a run whose own diagnostics row said
 * `Contract C matched: no`. Measured against production with a real token on
 * 2026-08-28: green banner, `atlasStatus: 302`, contract not matched.
 *
 * The green now follows `contractMatched`, not `ok`.
 */
describe('AtlasAuthClient — the banner claims only what was established', () => {
  function bannerSeverity(container: HTMLElement): string | null {
    const alert = container.querySelector('[class*="MuiAlert-standard"]');
    const match = alert?.className.match(/MuiAlert-standard(\w+)/);
    return match ? match[1].toLowerCase() : null;
  }

  it('warns instead of congratulating when Atlas answered but the contract did not hold', async () => {
    respondWith(200, {
      ok: true,
      diagnostics: { atlasStatus: 302, contractMatched: false },
    });
    installBridge();
    post(validEnvelope(), LAB);
    const { container } = renderClient();

    await waitFor(() => expect(bannerSeverity(container)).toBe('warning'));

    // The specific false claim that started this: never over a contract that did
    // not match.
    expect(screen.queryByText(/exercised end to end/)).toBeNull();
    expect(screen.queryByText('Probe succeeded')).toBeNull();
  });

  it('puts the Atlas status in the banner itself, not only in the table below', async () => {
    respondWith(200, {
      ok: true,
      diagnostics: { atlasStatus: 302, contractMatched: false },
    });
    installBridge();
    post(validEnvelope(), LAB);
    const { container } = renderClient();

    await waitFor(() => expect(bannerSeverity(container)).toBe('warning'));

    // A reader who never scrolls to the diagnostics still learns what happened.
    const alert = container.querySelector('[class*="MuiAlert-standardWarning"]');
    expect(alert?.textContent).toContain('302');
  });

  it('says a 302 never reached the endpoint, and blames neither the token nor the account', async () => {
    respondWith(200, {
      ok: true,
      diagnostics: { atlasStatus: 302, contractMatched: false },
    });
    installBridge();
    post(validEnvelope(), LAB);
    const { container } = renderClient();

    await waitFor(() => expect(bannerSeverity(container)).toBe('warning'));
    const text = container.querySelector('[class*="MuiAlert-standardWarning"]')?.textContent ?? '';

    expect(text).toMatch(/redirect/i);
    expect(text).toMatch(/never reached|did not reach/i);
    expect(text).toMatch(/nothing can be concluded/i);

    // Pinned in both directions, because this wording can fail two opposite ways.
    //
    // Blaming the token would send the reader to debug a credential that may never
    // have been used — and could have us tell Crazy Cake their token is bad on the
    // strength of a request that never arrived.
    expect(text).not.toMatch(/token was rejected|invalid token|token is invalid/i);
    expect(text).not.toMatch(/account (is|was) (not )?(allowed|rejected)/i);
    // And exonerating it is the same overclaim mirrored: we cannot see whether Atlas
    // read the token before redirecting, so asserting it did not is a claim about
    // their internals, not an observation. An unknown stated as a fact does not
    // become acceptable by landing on the reassuring side.
    expect(text).not.toMatch(/token was never (evaluated|examined|read|judged)/i);
    expect(text).not.toMatch(/neither was examined/i);
  });

  it('still says end to end when the contract really did hold', async () => {
    respondWith(200, {
      ok: true,
      diagnostics: { atlasStatus: 200, contractMatched: true },
    });
    installBridge();
    post(validEnvelope(), LAB);
    const { container } = renderClient();

    expect(await screen.findByText('Probe succeeded')).toBeTruthy();
    expect(bannerSeverity(container)).toBe('success');
    expect(screen.getByText(/exercised end to end/)).toBeTruthy();
  });

  /**
   * `contractMatched: undefined` is not `false`. Stages that fail before Atlas is
   * ever called (`input`, `config`, `disabled`) carry no diagnostics at all, and
   * absence of evidence must not be rendered as evidence of a mismatch — that
   * would swap one false banner for another.
   */
  it('does not fall into the warning when there are no diagnostics to judge', async () => {
    respondWith(200, { ok: true });
    installBridge();
    post(validEnvelope(), LAB);
    const { container } = renderClient();

    expect(await screen.findByText('Probe succeeded')).toBeTruthy();
    expect(bannerSeverity(container)).toBe('success');
  });

  it('does not fall into the warning when diagnostics arrive without a verdict', async () => {
    respondWith(200, { ok: true, diagnostics: { atlasStatus: 200 } });
    installBridge();
    post(validEnvelope(), LAB);
    const { container } = renderClient();

    expect(await screen.findByText('Probe succeeded')).toBeTruthy();
    expect(bannerSeverity(container)).toBe('success');
  });

  it('describes a non-redirect mismatch without claiming a redirect happened', async () => {
    respondWith(200, {
      ok: true,
      diagnostics: { atlasStatus: 200, contractMatched: false, responseShapeKeys: ['error'] },
    });
    installBridge();
    post(validEnvelope(), LAB);
    const { container } = renderClient();

    await waitFor(() => expect(bannerSeverity(container)).toBe('warning'));
    const text = container.querySelector('[class*="MuiAlert-standardWarning"]')?.textContent ?? '';

    expect(text).toContain('200');
    expect(text).not.toMatch(/redirect/i);
  });

  /**
   * `no_partner` outranks everything: it is the one outcome that really does mean
   * the SSO works. It must not be demoted to a warning by a contract flag.
   */
  it('keeps no_partner winning even when the contract flag says no', async () => {
    respondWith(403, {
      ok: false,
      stage: 'no_partner',
      message: 'account has no partner',
      diagnostics: { atlasStatus: 200, contractMatched: false },
    });
    installBridge();
    post(validEnvelope(), LAB);
    const { container } = renderClient();

    expect(
      await screen.findByText('The SSO works — this account has no partner attached')
    ).toBeTruthy();
    expect(bannerSeverity(container)).toBe('info');
  });
});

describe('AtlasAuthClient — login redirect', () => {
  it('follows a same-site redirectTo in login mode', async () => {
    respondWith(200, { ok: true, redirectTo: '/films' });
    installBridge();
    post(validEnvelope(), LAB);
    renderClient({ mode: 'login' });

    await waitFor(() => expect(push).toHaveBeenCalledWith('/films'));
  });

  it('refuses to follow an off-site redirectTo', async () => {
    respondWith(200, { ok: true, redirectTo: '//evil.example.com' });
    installBridge();
    post(validEnvelope(), LAB);
    renderClient({ mode: 'login' });

    expect(await screen.findByText('Signed in')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it('does not redirect in probe mode even if the server sends redirectTo', async () => {
    respondWith(200, { ok: true, redirectTo: '/films' });
    installBridge();
    post(validEnvelope(), LAB);
    renderClient({ mode: 'probe' });

    expect(await screen.findByText('Probe succeeded')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});

describe('AtlasAuthClient — diagnostics are never gated on success', () => {
  it('renders diagnostics that arrive inside an ok:false body', async () => {
    // The only Atlas behaviour anyone has measured is a 302. If diagnostics only
    // rendered on success, the run we know is coming would show nothing at all.
    respondWith(502, {
      ok: false,
      stage: 'atlas_call',
      message: 'Atlas answered 302',
      diagnostics: {
        atlasUrlTried: 'https://dashboard.pijamafilms.com/movies/by-partner',
        atlasStatus: 302,
        contractMatched: false,
        responseShapeKeys: [],
      },
    });
    installBridge();
    post(validEnvelope(), PROD);
    renderClient();

    expect(await screen.findByText('Atlas diagnostics')).toBeTruthy();
    expect(screen.getByText('302')).toBeTruthy();
    expect(screen.getByText('https://dashboard.pijamafilms.com/movies/by-partner')).toBeTruthy();
  });

  it('renders diagnostics from a 4xx as readily as from a 200', async () => {
    respondWith(403, {
      ok: false,
      stage: 'allowlist',
      diagnostics: { atlasStatus: 200, responseShapeKeys: ['status', 'data'] },
    });
    installBridge();
    post(validEnvelope(), PROD);
    renderClient();

    expect(await screen.findByText('Atlas diagnostics')).toBeTruthy();
    expect(screen.getByText('status, data')).toBeTruthy();
  });
});

describe('AtlasAuthClient — a rejected login escalates to a probe by itself', () => {
  it('runs a probe automatically after a failed login', async () => {
    // JP gets one window, once. A diagnosis behind a button he may not press is
    // a diagnosis we do not get.
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce({
        status: 403,
        ok: false,
        json: () => Promise.resolve({ ok: false, stage: 'no_partner', message: 'no partner' }),
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            diagnostics: { atlasStatus: 200, responseShapeKeys: ['status', 'data'] },
          }),
      });
    vi.stubGlobal('fetch', fetchMock);
    installBridge();
    post(validEnvelope(), PROD);
    renderClient({ mode: 'login' });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).mode).toBe('login');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).mode).toBe('probe');
    expect(await screen.findByText('probe mode (run automatically)')).toBeTruthy();
  });

  it('does not escalate when the login succeeded', async () => {
    const fetchMock = respondWith(200, { ok: true, redirectTo: '/films' });
    installBridge();
    post(validEnvelope(), PROD);
    renderClient({ mode: 'login' });

    await waitFor(() => expect(push).toHaveBeenCalledWith('/films'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not escalate a probe into another probe', async () => {
    const fetchMock = respondWith(502, { ok: false, stage: 'atlas_call' });
    installBridge();
    post(validEnvelope(), PROD);
    renderClient({ mode: 'probe' });

    await screen.findByText('Sign-in did not complete');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('AtlasAuthClient — no_partner reads as a working SSO', () => {
  it('reports it as information, not as a failure', async () => {
    respondWith(403, { ok: false, stage: 'no_partner', message: 'account has no partner' });
    installBridge();
    post(validEnvelope(), PROD);
    renderClient();

    expect(
      await screen.findByText('The SSO works — this account has no partner attached')
    ).toBeTruthy();
    expect(screen.queryByText('Sign-in did not complete')).toBeNull();
    expect(screen.getAllByText(/The SSO works\./).length).toBeGreaterThan(0);
  });

  it('spells out a conclusion for every stage the contract defines', async () => {
    for (const [stage, fragment] of [
      ['input', /bug on our side/],
      ['atlas_call', /could not be reached/],
      ['contract', /does not match what Crazy Cake documented/],
      ['disabled', /switched off by configuration/],
      ['allowlist', /not on the list allowed to sign in/],
      ['session', /issuing our own session cookie failed/],
    ] as const) {
      respondWith(502, { ok: false, stage });
      installBridge();
      post(validEnvelope(), PROD);
      renderClient();

      // Twice on purpose: once as the headline verdict, once in the detail rows.
      // Both matter — the banner answers "did it work", the row sits next to the
      // stage it explains.
      expect((await screen.findAllByText(fragment)).length).toBe(2);
      expect(screen.getByText('What this means')).toBeTruthy();
      cleanup();
      delete (window as unknown as Record<string, unknown>)[ATLAS_BRIDGE_GLOBAL];
    }
  });
});

describe('AtlasAuthClient — the relaxed-origin allowance is announced', () => {
  it('warns that a green result here does not prove the real allowlist works', () => {
    installBridge();
    renderClient({ allowSelfOrigin: true });

    expect(screen.getByText('Origin checking is relaxed in this window')).toBeTruthy();
    expect(screen.getByText(/prove the real allowlist works/)).toBeTruthy();
  });

  it('says nothing when the allowance is off', () => {
    installBridge();
    renderClient({ allowSelfOrigin: false });

    expect(screen.queryByText('Origin checking is relaxed in this window')).toBeNull();
  });

  it('warns when the built-in allowlist is standing in for a configured one', () => {
    installBridge();
    renderClient({ usingDefaultOrigins: true });

    expect(screen.getByText('Using the built-in allowlist, not a configured one')).toBeTruthy();
    // The warning has to say which default, not just that there is one: the
    // fallback narrows in production and a reader who assumes otherwise would
    // expect the lab origin to work there.
    expect(
      screen.getByText(/In production that default is the production Console alone/)
    ).toBeTruthy();
    expect(screen.getByText(/baked in at build\s+time/)).toBeTruthy();
  });
});

describe('AtlasAuthClient — the received origin is prominent', () => {
  it('shows both the origin that arrived and the ones that were allowed', async () => {
    respondWith(200, { ok: true, diagnostics: {} });
    installBridge([PROD]);
    post(validEnvelope(), PROD);
    renderClient({ allowedOrigins: [PROD] });

    await screen.findByText('Probe succeeded');
    expect(screen.getByText('Origin received')).toBeTruthy();
    expect(screen.getByText('Origins allowed')).toBeTruthy();
  });

  it('names the rejected origin and the allowed list side by side', async () => {
    installBridge([PROD]);
    post(validEnvelope(), LAB);
    renderClient({ allowedOrigins: [PROD] });

    await screen.findByText('Envelope rejected: origin not allowed');
    // Both facts on screen: what arrived, and what would have been accepted.
    expect(screen.getAllByText(LAB).length).toBeGreaterThan(0);
    expect(screen.getAllByText(new RegExp(PROD)).length).toBeGreaterThan(0);
    // And on the event row itself, not only in the summary card, so the reason
    // travels with the message that was rejected.
    expect(screen.getByText(new RegExp(`Allowed origins are: ${PROD}`))).toBeTruthy();
  });
});

describe('AtlasAuthClient — the bridge copy is scrubbed once the view has the token', () => {
  it('still exchanges normally', async () => {
    // The scrub must not break the thing it is tidying up after.
    const fetchMock = respondWith(200, { ok: true, diagnostics: {} });
    installBridge();
    post(validEnvelope(), PROD);
    renderClient();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).token).toBe(TOKEN);
    expect(await screen.findByText('Probe succeeded')).toBeTruthy();
  });

  it('leaves no token anywhere on the bridge global afterwards', async () => {
    respondWith(200, { ok: true, diagnostics: {} });
    installBridge();
    post(validEnvelope(), PROD);
    renderClient();

    await screen.findByText('Probe succeeded');

    const bridge = (window as unknown as Record<string, unknown>)[ATLAS_BRIDGE_GLOBAL];
    expect(JSON.stringify(bridge)).not.toContain('SECRET-PAYLOAD-MUST-NEVER-RENDER');
  });

  it('keeps the token long enough to use it, scrubbing only after', async () => {
    // Ordering is the whole condition: scrubbing on the way past would turn any
    // failure between reading and using the token into an intermittent failure.
    const bridge = installBridge();
    const fetchMock = respondWith(200, { ok: true, diagnostics: {} });
    post(validEnvelope(), PROD);

    const buffered = bridge.buffer[0];
    expect((buffered.payload as { token?: string }).token).toBe(TOKEN);

    renderClient();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((buffered.payload as { token?: string }).token).toBeUndefined();
  });
});

describe('AtlasAuthClient — the re-run button', () => {
  it('replays the whole token in probe mode', async () => {
    // This button is the only consumer of the token after the first exchange, and
    // it had no coverage at all. What it guards is the *pair*: where the token is
    // read from, and whether the scrub can reach that source. Moving the scrub
    // earlier changes nothing on its own, and reading the token out of
    // `message.payload` instead of Zod's copy changes nothing on its own either —
    // each is still correct with the other half in place. Do both and the button
    // posts an empty token: a working screen producing a useless diagnosis.
    // Verified by mutating the two halves separately (both stay green) and
    // together (this test goes red).
    const fetchMock = respondWith(502, { ok: false, stage: 'atlas_call' });
    installBridge();
    post(validEnvelope(), PROD);
    renderClient({ mode: 'probe' });

    await screen.findByText('Sign-in did not complete');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Re-run as diagnostic probe/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ token: TOKEN, mode: 'probe' });
  });

  it('stays disabled until there is a token to replay', () => {
    installBridge();
    renderClient();

    const button = screen.getByRole('button', { name: /Re-run as diagnostic probe/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
