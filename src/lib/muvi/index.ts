import { MuviTokenHandler } from './client';
import { MuviConfigError } from './errors';

// Declare global type for singleton pattern (prevents multiple instances in dev)
const globalForMuvi = global as unknown as { muvi: MuviTokenHandler | undefined };

/**
 * Create and validate Muvi configuration from environment variables
 */
function createMuviConfig() {
  const secretKey = process.env.MUVI_SECRET_KEY;
  const appId = process.env.MUVI_APP_ID;
  const baseUrl = process.env.MUVI_BASE_URL || 'https://apigateway.muvi.com';

  const missingVars: string[] = [];
  if (!secretKey) missingVars.push('MUVI_SECRET_KEY');
  if (!appId) missingVars.push('MUVI_APP_ID');

  if (missingVars.length > 0) {
    throw new MuviConfigError(
      `Missing required Muvi environment variables: ${missingVars.join(', ')}. ` +
        'Please configure them in your .env file.',
      missingVars
    );
  }

  return {
    secretKey: secretKey!,
    appId: appId!,
    baseUrl,
  };
}

/**
 * Get or create the Muvi singleton instance.
 * Throws MuviConfigError if required environment variables are missing.
 */
function getMuviClient(): MuviTokenHandler {
  if (globalForMuvi.muvi) {
    return globalForMuvi.muvi;
  }

  const config = createMuviConfig();
  const client = new MuviTokenHandler(config);

  if (process.env.NODE_ENV !== 'production') {
    globalForMuvi.muvi = client;
  }

  return client;
}

/**
 * Lazily initialised singleton, mirroring the Stripe client.
 *
 * Constructing it eagerly threw at import time whenever the Muvi credentials
 * were absent, which took down every route whose import graph reaches this
 * module. That is exactly the situation during a build: secrets are declared
 * RUNTIME-only, so the build has none of them, and Next evaluates every route
 * module while collecting page data.
 *
 * The proxy keeps the import surface identical and defers construction — and
 * the configuration error — to the first real use.
 */
// One instance per process, memoised here rather than by the factory: it only
// caches outside production, so without this every property access would build
// a fresh client. That is what broke the Muvi token — `getAccessToken()` stored
// it on one instance and `productKey` read from another.
let muviInstance: MuviTokenHandler | undefined;

export const muvi = new Proxy({} as MuviTokenHandler, {
  // `receiver` is deliberately omitted: forwarding it would run the client's
  // getters with `this` bound to the proxy, so a getter reading internal state
  // would recurse back through this handler and see nothing.
  get(_target, prop) {
    muviInstance ??= getMuviClient();
    const value = Reflect.get(muviInstance, prop);
    return typeof value === 'function' ? value.bind(muviInstance) : value;
  },
});

// Re-export API functions
export { getMovies, getMovieDetails } from './api';

// Re-export types for consumers
export type {
  MuviConfig,
  MuviMovie,
  MuviMovieDetails,
  MuviVideoAsset,
  MuviImageAsset,
  MuviCast,
  MuviCategory,
  MuviCustomField,
  GetMoviesOptions,
  GetMoviesResult,
} from './types';

// Re-export error classes
export {
  MuviError,
  MuviConfigError,
  MuviAuthError,
  MuviApiError,
  MuviValidationError,
} from './errors';

// Re-export the client class for advanced usage
export { MuviTokenHandler } from './client';
