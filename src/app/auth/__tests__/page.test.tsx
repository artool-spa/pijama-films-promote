import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { AtlasAuthClientProps } from '../client';

/**
 * The controller decides three things that cannot be seen from the view: which
 * origins are allowed, whether the development allowance is on, and which mode
 * runs. All three are the difference between a working handshake and a silent
 * rejection in production, so they are asserted here rather than assumed.
 */

const LAB = 'https://dashboard-lab.pijamafilms.com';
const PROD = 'https://dashboard.pijamafilms.com';

async function renderController(
  searchParams: { mode?: string; origins?: string } = {}
): Promise<AtlasAuthClientProps> {
  vi.resetModules();
  const { default: AtlasAuthPage } = await import('../page');
  const tree = (await AtlasAuthPage({
    searchParams: Promise.resolve(searchParams),
  })) as ReactElement<{ children: ReactElement[] }>;

  const client = tree.props.children.find(
    (child) => typeof child?.type !== 'string'
  ) as ReactElement<AtlasAuthClientProps>;

  return client.props;
}

/** The inline script the controller renders, as a string. */
async function renderScript(
  searchParams: { mode?: string; origins?: string } = {}
): Promise<string> {
  vi.resetModules();
  const { default: AtlasAuthPage } = await import('../page');
  const tree = (await AtlasAuthPage({
    searchParams: Promise.resolve(searchParams),
  })) as ReactElement<{ children: ReactElement[] }>;

  const script = tree.props.children.find(
    (child) => child?.type === 'script'
  ) as ReactElement<{ dangerouslySetInnerHTML: { __html: string } }>;

  return script.props.dangerouslySetInnerHTML.__html;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('AtlasAuthPage — allowlist resolution', () => {
  it('uses the configured origins when the variable holds any', async () => {
    vi.stubEnv('NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS', `${LAB},${PROD}`);

    const props = await renderController();

    expect(props.allowedOrigins).toEqual([LAB, PROD]);
    expect(props.usingDefaultOrigins).toBe(false);
  });

  it('falls back to the built-in list, production first, when the variable is unset', async () => {
    // An unset variable used to mean "reject every origin", which reads on screen
    // as a broken SSO rather than as a missing configuration.
    vi.stubEnv('NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS', '');

    const props = await renderController();

    expect(props.allowedOrigins).toEqual([PROD, LAB]);
    expect(props.allowedOrigins[0]).toBe(PROD);
    expect(props.usingDefaultOrigins).toBe(true);
  });

  it('falls back when the variable holds only unusable entries', async () => {
    vi.stubEnv('NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS', 'https://*.pijamafilms.com, nonsense');

    const props = await renderController();

    expect(props.usingDefaultOrigins).toBe(true);
    expect(props.allowedOrigins).toEqual([PROD, LAB]);
  });

  it('never hardcodes an origin into the inline script when one is configured', async () => {
    // The trap: Crazy Cake's sample compares against the lab origin inline. A
    // build configured for production must not carry the lab origin at all.
    vi.stubEnv('NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS', PROD);

    const script = await renderScript();

    expect(script).toContain(PROD);
    expect(script).not.toContain(LAB);
  });
});

describe('AtlasAuthPage — the development origin allowance', () => {
  it('is on outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    expect((await renderController()).allowSelfOrigin).toBe(true);
  });

  it('is off in production, whatever the query string says', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    expect((await renderController()).allowSelfOrigin).toBe(false);
    expect((await renderController({ origins: 'anything' })).allowSelfOrigin).toBe(false);
  });

  it('is off outside production when the page is opened with origins=strict', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    expect((await renderController({ origins: 'strict' })).allowSelfOrigin).toBe(false);
  });

  it('bakes the allowance into the inline script as a literal boolean', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    expect(await renderScript()).toContain('if(false&&');
  });
});

describe('AtlasAuthPage — mode resolution', () => {
  it('defaults to login, the real Console flow', async () => {
    expect((await renderController()).mode).toBe('login');
    expect((await renderController({ mode: 'nonsense' })).mode).toBe('login');
  });

  it('honours an explicit probe', async () => {
    expect((await renderController({ mode: 'probe' })).mode).toBe('probe');
  });
});
