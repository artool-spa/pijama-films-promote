import { GoogleAdsClient } from './client';
import { GoogleAdsConfigError } from './errors';

// Singleton pattern for Google Ads client
const globalForGoogle = global as unknown as { google: GoogleAdsClient | undefined };

/**
 * Create Google Ads configuration from environment variables
 */
function createGoogleAdsConfig() {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  const apiVersion = process.env.GOOGLE_ADS_API_VERSION || 'v18';
  const baseUrl = process.env.GOOGLE_ADS_BASE_URL || 'https://googleads.googleapis.com';

  const missingVars: string[] = [];
  if (!developerToken) missingVars.push('GOOGLE_ADS_DEVELOPER_TOKEN');
  if (!clientId) missingVars.push('GOOGLE_ADS_CLIENT_ID');
  if (!clientSecret) missingVars.push('GOOGLE_ADS_CLIENT_SECRET');
  if (!refreshToken) missingVars.push('GOOGLE_ADS_REFRESH_TOKEN');
  if (!customerId) missingVars.push('GOOGLE_ADS_CUSTOMER_ID');

  if (missingVars.length > 0) {
    throw new GoogleAdsConfigError(
      `Missing required Google Ads environment variables: ${missingVars.join(', ')}. ` +
        'Please configure them in your .env file.',
      missingVars
    );
  }

  return {
    developerToken: developerToken!,
    clientId: clientId!,
    clientSecret: clientSecret!,
    refreshToken: refreshToken!,
    customerId: customerId!,
    loginCustomerId,
    apiVersion,
    baseUrl,
  };
}

/**
 * Get or create the Google Ads singleton instance.
 * Cached in development to prevent multiple instances during hot reload.
 */
function getGoogleAdsClient(): GoogleAdsClient {
  if (globalForGoogle.google) {
    return globalForGoogle.google;
  }

  const config = createGoogleAdsConfig();
  const client = new GoogleAdsClient(config);

  if (process.env.NODE_ENV !== 'production') {
    globalForGoogle.google = client;
  }

  return client;
}

// Export the singleton instance
export const google = getGoogleAdsClient();

// Re-export API functions
export {
  createVideoCampaign,
  createVideoAdGroup,
  createVideoAd,
  createYouTubeCampaignWithAdGroup,
  getYouTubeInsights,
  updateCampaignStatus,
  updateAdGroupStatus,
  getCampaignStatus,
} from './api';

// Re-export YouTube upload functions
export { uploadVideoToYouTube } from './youtube';

// Re-export types
export type {
  GoogleAdsConfig,
  GoogleCampaignCreate,
  GoogleAdGroupCreate,
  GoogleVideoAdCreate,
  GoogleInsightsResponse,
  GoogleTargeting,
  YouTubeAdFormat,
  GoogleMutateResponse,
  GoogleSearchResponse,
} from './types';

// Re-export schemas
export {
  YouTubeAdFormatSchema,
} from './types';

// Re-export error classes
export {
  GoogleAdsError,
  GoogleAdsConfigError,
  GoogleAdsAuthError,
  GoogleAdsApiError,
  GoogleAdsQuotaError,
} from './errors';

// Re-export client class
export { GoogleAdsClient } from './client';

// Re-export targeting functions
export {
  buildGoogleTargeting,
  toGoogleTargetingSchema,
} from './targeting';

// Re-export targeting types
export type {
  GoogleTargetingConfig,
  GoogleTargetingResult,
} from './targeting';

// Re-export auth functions
export { clearTokenCache } from './auth';
