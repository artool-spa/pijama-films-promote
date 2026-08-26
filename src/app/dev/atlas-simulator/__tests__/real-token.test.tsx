import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import { PROMOTE_READY_TYPE } from '@/app/auth/atlas-bridge';
import AtlasSimulatorClient from '../client';

/**
 * The pasted-token path handles a real production credential. These tests are
 * the standing guarantee that it stays handled: password field, no persistence,
 * no logging, cleared after use, and posted through the same `postMessage` the
 * real Console uses rather than injected past our own listener.
 */

const REAL_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.REAL-PRODUCTION-CREDENTIAL-DO-NOT-LEAK.signature';

interface Posted {
  data: unknown;
  targetOrigin: string;
}

let posted: Posted[] = [];
let openedUrls: string[] = [];
let child: Window;

function openSimulator() {
  posted = [];
  openedUrls = [];
  child = {
    closed: false,
    postMessage: (data: unknown, targetOrigin: string) => {
      posted.push({ data, targetOrigin });
    },
  } as unknown as Window;

  vi.stubGlobal(
    'open',
    vi.fn((url: string) => {
      openedUrls.push(url);
      return child;
    })
  );

  return render(<AtlasSimulatorClient />);
}

function pasteRealToken(value = REAL_TOKEN) {
  const field = document.querySelector('input[type="password"]') as HTMLInputElement;
  fireEvent.change(field, { target: { value } });
  return field;
}

function clickRealTokenButton() {
  fireEvent.click(screen.getByRole('button', { name: /post the real token/i }));
}

/** Console signalling that the new window is listening. */
function sendReady() {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: PROMOTE_READY_TYPE },
        origin: window.location.origin,
        source: child as never,
      })
    );
  });
}

/**
 * Both storages are replaced with recording stand-ins: happy-dom does not expose
 * a usable `localStorage` here, and its `sessionStorage` accessor does not hand
 * back a stable object to spy on. Without stand-ins the "never written to
 * storage" assertion would pass vacuously, which is worse than no test — so a
 * canary test below proves the stand-ins really do catch a write.
 */
let storageWrites: Array<[string, string, string]> = [];

function recordingStorage(label: string) {
  return {
    length: 0,
    getItem: () => null,
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    setItem: (key: string, value: string) => {
      storageWrites.push([label, key, value]);
    },
  };
}

beforeEach(() => {
  storageWrites = [];
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: recordingStorage('local'),
  });
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    value: recordingStorage('session'),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the pasted-token field', () => {
  it('is a password field, not plain text', () => {
    openSimulator();

    const field = document.querySelector('input[type="password"]');
    expect(field).not.toBeNull();
    expect(field?.getAttribute('autocomplete')).toBe('off');
  });

  it('does nothing at all when nothing was pasted', () => {
    openSimulator();
    clickRealTokenButton();

    expect(openedUrls).toHaveLength(0);
    expect(screen.getByText(/No real token was pasted/)).toBeTruthy();
  });
});

describe('the pasted-token run', () => {
  it('always opens probe mode, whatever the synthetic form says', () => {
    openSimulator();
    fireEvent.click(screen.getByRole('radio', { name: /^login$/i }));

    // Prove the synthetic form really is in login mode by launching it, so the
    // assertion below is about the real-token path ignoring that setting rather
    // than about a click that never landed.
    fireEvent.click(screen.getByRole('button', { name: /Open \/auth and post/i }));
    expect(openedUrls).toEqual(['/auth?mode=login']);

    pasteRealToken();
    clickRealTokenButton();

    // The real-token path exists to settle Contract C, and probe is the only mode
    // that never issues a session. It must not be steerable into login.
    expect(openedUrls).toEqual(['/auth?mode=login', '/auth?mode=probe']);
  });

  it('delivers the token through postMessage, the same path Console uses', () => {
    openSimulator();
    pasteRealToken();
    clickRealTokenButton();
    sendReady();

    expect(posted).toHaveLength(1);
    expect(posted[0].data).toEqual({
      type: 'ATLAS_AUTH',
      token: REAL_TOKEN,
      partner: { name: 'Simulated Partner', email: 'partner@example.test' },
    });
    expect(posted[0].targetOrigin).toBe(window.location.origin);
  });

  it('never puts the token in the opened URL', () => {
    openSimulator();
    pasteRealToken();
    clickRealTokenButton();

    expect(openedUrls.join(' ')).not.toContain('REAL-PRODUCTION-CREDENTIAL');
    expect(openedUrls.join(' ')).not.toContain(REAL_TOKEN);
  });

  it('logs a fingerprint and never the token', () => {
    const { container } = openSimulator();
    pasteRealToken();
    clickRealTokenButton();
    sendReady();

    expect(container.innerHTML).not.toContain('REAL-PRODUCTION-CREDENTIAL');
    expect(screen.getAllByText(new RegExp(`${REAL_TOKEN.length} chars`)).length).toBeGreaterThan(0);
  });

  it('clears the field as soon as the token has been handed over', () => {
    openSimulator();
    const field = pasteRealToken();
    clickRealTokenButton();

    expect(field.value).toBe('');
  });

  it('never writes the token to browser storage', () => {
    openSimulator();
    pasteRealToken();
    clickRealTokenButton();
    sendReady();

    expect(storageWrites).toEqual([]);
  });

  it('the storage stand-ins really would catch a write', () => {
    // Guards the assertion above from passing vacuously.
    window.localStorage.setItem('canary', 'a');
    window.sessionStorage.setItem('canary', 'b');

    expect(storageWrites).toEqual([
      ['local', 'canary', 'a'],
      ['session', 'canary', 'b'],
    ]);
  });

  it('does not log the token to the console', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    openSimulator();
    pasteRealToken();
    clickRealTokenButton();
    sendReady();

    const everythingLogged = [...spy.mock.calls, ...infoSpy.mock.calls].flat().join(' ');
    expect(everythingLogged).not.toContain('REAL-PRODUCTION-CREDENTIAL');
  });
});
