import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Contract D, layer 2: the simulator must not render in production.
 *
 * The middleware is layer 1 and is owned elsewhere. This test exists because a
 * defence whose failure mode is silence is indistinguishable from no defence:
 * before it, deleting the `notFound()` guard broke nothing that anyone would
 * notice until the simulator was live on the internet.
 */

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({ notFound }));

afterEach(() => {
  vi.unstubAllEnvs();
  notFound.mockClear();
});

describe('AtlasSimulatorPage — production guard', () => {
  // Development first: importing the page under NODE_ENV=production would leave
  // React's development JSX runtime unloaded for the rest of the file.
  it('renders outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.resetModules();
    const { default: AtlasSimulatorPage } = await import('../page');

    await expect(AtlasSimulatorPage()).resolves.toBeTruthy();
    expect(notFound).not.toHaveBeenCalled();
  });

  it('refuses to render when NODE_ENV is production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const { default: AtlasSimulatorPage } = await import('../page');

    await expect(AtlasSimulatorPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });
});
