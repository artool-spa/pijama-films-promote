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

// Export the singleton instance
export const muvi = getMuviClient();

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
