import { PijamaClient } from './client';
import { PijamaConfigError } from './errors';

// Singleton pattern for Pijama client
const globalForPijama = global as unknown as { pijama: PijamaClient | undefined };

/**
 * Create Pijama configuration from environment variables
 * Returns null if environment variables are not configured (optional integration)
 */
function createPijamaConfig() {
  const baseUrl = process.env.PIJAMA_API_URL || 'https://api.pijamafilms.com';
  const clientId = process.env.PIJAMA_CLIENT_ID;
  const clientSecret = process.env.PIJAMA_CLIENT_SECRET;

  // Pijama integration is optional - return null if not configured
  if (!clientId || !clientSecret) {
    return null;
  }

  return {
    baseUrl,
    clientId,
    clientSecret,
  };
}

/**
 * Get or create the Pijama singleton instance.
 * Returns null if Pijama is not configured.
 */
function getPijamaClient(): PijamaClient | null {
  if (globalForPijama.pijama) {
    return globalForPijama.pijama;
  }

  const config = createPijamaConfig();
  if (!config) {
    return null;
  }

  const client = new PijamaClient(config);

  if (process.env.NODE_ENV !== 'production') {
    globalForPijama.pijama = client;
  }

  return client;
}

// Export the singleton instance (may be null if not configured)
export const pijama = getPijamaClient();

/**
 * Check if Pijama integration is configured
 */
export function isPijamaConfigured(): boolean {
  return pijama !== null;
}

/**
 * Get the Pijama client, throwing if not configured
 */
export function requirePijama(): PijamaClient {
  if (!pijama) {
    throw new PijamaConfigError(
      'Pijama API is not configured. Set PIJAMA_CLIENT_ID and PIJAMA_CLIENT_SECRET.',
      ['PIJAMA_CLIENT_ID', 'PIJAMA_CLIENT_SECRET']
    );
  }
  return pijama;
}

// Re-export API functions
export {
  getPartner,
  getCurrentPartner,
  listPartners,
  canPartnerAccessFilm,
  getPartnerFilmIds,
  validatePartnerToken,
  exchangeAuthCode,
} from './api';

// Re-export types
export type {
  PijamaConfig,
  PijamaPartner,
  PijamaPartnerListResponse,
  PijamaTokenResponse,
} from './types';

// Re-export error classes
export {
  PijamaError,
  PijamaConfigError,
  PijamaAuthError,
  PijamaApiError,
} from './errors';

// Re-export client class for advanced usage
export { PijamaClient } from './client';
