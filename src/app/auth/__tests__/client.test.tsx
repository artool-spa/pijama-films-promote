import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { ATLAS_BRIDGE_GLOBAL } from '../atlas-bridge';
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
function installBridge(allowedOrigins: string[] = [LAB, PROD]) {
  Object.defineProperty(window, 'opener', { value: null, configurable: true, writable: true });
  new Function(buildBridgeScript({ allowedOrigins, allowSelfOrigin: false }))();
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

    await screen.findByText('Sign-in failed');

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
    expect(screen.getByText('https://dashboard.pijamafilms.com.evil.io')).toBeTruthy();
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
    vi.useFakeTimers({ shouldAdvanceTime: true });
    respondWith(200, { ok: true, diagnostics: {} });
    installBridge();
    post(validEnvelope(), LAB);
    renderClient({ timeoutMs: 5_000 });

    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(5_000);
    });

    expect(screen.queryByText('No postMessage arrived within 5 seconds')).toBeNull();
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

    expect(await screen.findByText('Probe succeeded')).toBeTruthy();
    expect(screen.getByText('302')).toBeTruthy();
    expect(screen.getByText('error')).toBeTruthy();
    expect(screen.getByText('https://dashboard-lab.pijamafilms.com/movies/by-partner')).toBeTruthy();
  });

  it('shows the stage on a failure', async () => {
    respondWith(403, { ok: false, stage: 'allowlist', message: 'partner not in allowlist' });
    installBridge();
    post(validEnvelope(), LAB);
    renderClient();

    expect(await screen.findByText('Sign-in failed')).toBeTruthy();
    expect(screen.getByText('allowlist')).toBeTruthy();
    expect(screen.getByText('partner not in allowlist')).toBeTruthy();
  });

  it('flags a stage that is not one of the five the contract defines', async () => {
    respondWith(403, { ok: false, stage: 'login_disabled', message: 'off' });
    installBridge();
    post(validEnvelope(), LAB);
    renderClient();

    expect(await screen.findByText('login_disabled (not a Contract A stage)')).toBeTruthy();
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

  it('survives a body that is not Contract A at all', async () => {
    // What a missing endpoint looks like today: Next answers with an HTML 404.
    respondWith(404, null, true);
    installBridge();
    post(validEnvelope(), LAB);
    renderClient();

    expect(await screen.findByText(/does not match Contract A/)).toBeTruthy();
    expect(
      screen.getByText('transport (detected by this page, not reported by the endpoint)')
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
