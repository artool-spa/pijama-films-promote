import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ATLAS_BRIDGE_GLOBAL, type AtlasBridge, type BridgeMessage } from '../atlas-bridge';
import { BRIDGE_BUFFER_LIMIT, buildBridgeScript } from '../bridge-script';

const LAB = 'https://dashboard-lab.pijamafilms.com';
const PROD = 'https://dashboard.pijamafilms.com';

interface FakeOpener {
  postMessage: (data: unknown, targetOrigin: string) => void;
}

/** Records the order of the two things that must not be swapped. */
let order: string[] = [];
let openerPosts: Array<{ data: unknown; targetOrigin: string }> = [];
let installedListeners: Array<(event: Event) => void> = [];
let realAddEventListener: typeof window.addEventListener;

function makeOpener(): FakeOpener {
  return {
    postMessage: (data: unknown, targetOrigin: string) => {
      order.push('opener.postMessage');
      openerPosts.push({ data, targetOrigin });
    },
  };
}

function install(options: {
  allowedOrigins?: string[];
  allowSelfOrigin?: boolean;
  opener?: FakeOpener | null;
}): AtlasBridge {
  const source = buildBridgeScript({
    allowedOrigins: options.allowedOrigins ?? [LAB, PROD],
    allowSelfOrigin: options.allowSelfOrigin ?? false,
  });

  Object.defineProperty(window, 'opener', {
    value: options.opener === undefined ? null : options.opener,
    configurable: true,
    writable: true,
  });

  // Run exactly what the browser would run from the inline <script>.
  new Function(source)();

  const bridge = (window as unknown as Record<string, unknown>)[ATLAS_BRIDGE_GLOBAL];
  return bridge as AtlasBridge;
}

function post(data: unknown, origin: string) {
  window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

beforeEach(() => {
  order = [];
  openerPosts = [];
  installedListeners = [];
  delete (window as unknown as Record<string, unknown>)[ATLAS_BRIDGE_GLOBAL];

  realAddEventListener = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation(((
    type: string,
    listener: (event: Event) => void,
    optionsArg?: unknown
  ) => {
    if (type === 'message') {
      order.push('addEventListener(message)');
      installedListeners.push(listener);
    }
    return realAddEventListener(type, listener as EventListener, optionsArg as never);
  }) as typeof window.addEventListener);
});

afterEach(() => {
  vi.restoreAllMocks();
  installedListeners.forEach((listener) =>
    window.removeEventListener('message', listener as EventListener)
  );
  delete (window as unknown as Record<string, unknown>)[ATLAS_BRIDGE_GLOBAL];
});

describe('buildBridgeScript — inline safety', () => {
  it('cannot terminate its own script tag', () => {
    const source = buildBridgeScript({
      allowedOrigins: ['https://a.example.test'],
      allowSelfOrigin: true,
    });

    // Only `</script` and `<!--` matter to the HTML parser; a bare `<` is just
    // the less-than operator in the script body.
    expect(source).not.toContain('</script');
    expect(source).not.toContain('<!--');
  });

  it('escapes angle brackets coming from the allowlist value', () => {
    // parseAllowedOrigins already drops these, but the escaping is the last line
    // of defence if the env var is ever embedded from somewhere else.
    const source = buildBridgeScript({
      allowedOrigins: ['https://a.example.test/</script><script>alert(1)'],
      allowSelfOrigin: false,
    });

    expect(source).not.toContain('</script>');
    expect(source).toContain('\\u003c');
  });
});

describe('buildBridgeScript — execution order', () => {
  it('registers the message listener before posting PROMOTE_READY', () => {
    // If these ever swap, Console can post between the two and we lose it.
    install({ opener: makeOpener() });

    expect(order[0]).toBe('addEventListener(message)');
    expect(order).toContain('opener.postMessage');
    expect(order.indexOf('addEventListener(message)')).toBeLessThan(
      order.indexOf('opener.postMessage')
    );
  });

  it('posts PROMOTE_READY once per allowed origin, addressed exactly', () => {
    const bridge = install({ allowedOrigins: [LAB, PROD], opener: makeOpener() });

    expect(openerPosts).toHaveLength(2);
    expect(openerPosts.map((entry) => entry.targetOrigin)).toEqual([LAB, PROD]);
    expect(openerPosts.every((entry) => (entry.data as { type: string }).type === 'PROMOTE_READY')).toBe(
      true
    );
    expect(bridge.readySignal.postedTo).toEqual([LAB, PROD]);
    expect(bridge.readySignal.hasOpener).toBe(true);
  });

  it('never uses a wildcard target origin', () => {
    install({ allowedOrigins: [LAB], opener: makeOpener() });

    expect(openerPosts.map((entry) => entry.targetOrigin)).not.toContain('*');
  });

  it('records that there was no opener instead of throwing', () => {
    const bridge = install({ opener: null });

    expect(bridge.readySignal.hasOpener).toBe(false);
    expect(bridge.readySignal.postedTo).toEqual([]);
    expect(openerPosts).toHaveLength(0);
  });

  it('is idempotent: a second execution does not replace the live bridge', () => {
    const first = install({ opener: makeOpener() });
    const second = install({ opener: makeOpener() });

    expect(second).toBe(first);
    expect(order.filter((entry) => entry === 'addEventListener(message)')).toHaveLength(1);
  });
});

describe('buildBridgeScript — buffering', () => {
  it('buffers messages that arrive before anyone subscribes', () => {
    const bridge = install({ allowedOrigins: [LAB] });

    post({ type: 'ATLAS_AUTH', token: 'tok', partner: { name: 'n', email: 'e' } }, LAB);

    expect(bridge.buffer).toHaveLength(1);
    expect(bridge.buffer[0].origin).toBe(LAB);
    expect(bridge.buffer[0].allowed).toBe(true);
  });

  it('hands buffered messages to a late subscriber, flagged as buffered', () => {
    const bridge = install({ allowedOrigins: [LAB] });
    post({ type: 'ATLAS_AUTH', token: 'tok', partner: { name: 'n', email: 'e' } }, LAB);

    const seen: BridgeMessage[] = [];
    bridge.subscribe((message) => seen.push(message));

    expect(seen).toHaveLength(1);
    expect(seen[0].buffered).toBe(true);
    expect(bridge.buffer).toHaveLength(0);
  });

  it('delivers later messages live rather than buffering them', () => {
    const bridge = install({ allowedOrigins: [LAB] });
    const seen: BridgeMessage[] = [];
    bridge.subscribe((message) => seen.push(message));

    post({ type: 'ATLAS_AUTH', token: 'tok', partner: { name: 'n', email: 'e' } }, LAB);

    expect(seen).toHaveLength(1);
    expect(seen[0].buffered).toBe(false);
  });

  it('buffers again after the subscriber unsubscribes', () => {
    const bridge = install({ allowedOrigins: [LAB] });
    const unsubscribe = bridge.subscribe(() => {});
    unsubscribe();

    post({ type: 'ATLAS_AUTH', token: 'tok', partner: { name: 'n', email: 'e' } }, LAB);

    expect(bridge.buffer).toHaveLength(1);
  });

  it('stops buffering at the limit instead of growing without bound', () => {
    const bridge = install({ allowedOrigins: [LAB] });

    for (let i = 0; i < BRIDGE_BUFFER_LIMIT + 5; i++) {
      post({ type: 'ATLAS_AUTH', token: 'tok', partner: { name: 'n', email: 'e' } }, LAB);
    }

    expect(bridge.buffer).toHaveLength(BRIDGE_BUFFER_LIMIT);
    expect(bridge.ignoredCount).toBe(5);
  });
});

describe('buildBridgeScript — origin classification', () => {
  it('records an ATLAS_AUTH from a disallowed origin, marked not allowed', () => {
    // Rejecting it silently would make "wrong origin" indistinguishable from
    // "nothing arrived", which is exactly the false negative we are avoiding.
    const bridge = install({ allowedOrigins: [PROD] });

    post({ type: 'ATLAS_AUTH', token: 'tok', partner: { name: 'n', email: 'e' } }, LAB);

    expect(bridge.buffer).toHaveLength(1);
    expect(bridge.buffer[0].allowed).toBe(false);
    expect(bridge.buffer[0].origin).toBe(LAB);
  });

  it('counts unrelated chatter from a disallowed origin without recording it', () => {
    const bridge = install({ allowedOrigins: [PROD] });

    post({ type: 'webpackHotUpdate' }, 'http://localhost:9999');
    post('a bare string', 'http://localhost:9999');

    expect(bridge.buffer).toHaveLength(0);
    expect(bridge.ignoredCount).toBe(2);
  });

  it('records other message types from an allowed origin', () => {
    const bridge = install({ allowedOrigins: [LAB] });

    post({ type: 'SOMETHING_ELSE' }, LAB);

    expect(bridge.buffer).toHaveLength(1);
    expect(bridge.buffer[0].type).toBe('SOMETHING_ELSE');
    expect(bridge.buffer[0].allowed).toBe(true);
  });

  it('does not add the page origin to the allowlist unless asked', () => {
    const bridge = install({ allowedOrigins: [LAB], allowSelfOrigin: false });

    expect(bridge.allowedOrigins).toEqual([LAB]);
    expect(bridge.allowedOrigins).not.toContain(window.location.origin);
  });

  it('adds the page origin only when the development allowance is on', () => {
    const bridge = install({ allowedOrigins: [LAB], allowSelfOrigin: true });

    expect(bridge.allowedOrigins).toContain(window.location.origin);
  });
});
