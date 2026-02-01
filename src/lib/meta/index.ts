import { MetaClient } from './client';
import { MetaConfigError } from './errors';

// Singleton pattern for Meta client
const globalForMeta = global as unknown as { meta: MetaClient | undefined };

/**
 * Create Meta configuration from environment variables
 */
function createMetaConfig() {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  const pixelId = process.env.META_PIXEL_ID;
  const pageId = process.env.META_PAGE_ID;
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const apiVersion = process.env.META_API_VERSION || 'v19.0';
  const baseUrl = process.env.META_BASE_URL || 'https://graph.facebook.com';

  const missingVars: string[] = [];
  if (!accessToken) missingVars.push('META_ACCESS_TOKEN');
  if (!adAccountId) missingVars.push('META_AD_ACCOUNT_ID');

  if (missingVars.length > 0) {
    throw new MetaConfigError(
      `Missing required Meta environment variables: ${missingVars.join(', ')}. ` +
        'Please configure them in your .env file.',
      missingVars
    );
  }

  return {
    accessToken: accessToken!,
    adAccountId: adAccountId!,
    pixelId,
    pageId,
    appId,
    appSecret,
    apiVersion,
    baseUrl,
  };
}

/**
 * Get or create the Meta singleton instance.
 * Cached in development to prevent multiple instances during hot reload.
 */
function getMetaClient(): MetaClient {
  if (globalForMeta.meta) {
    return globalForMeta.meta;
  }

  const config = createMetaConfig();
  const client = new MetaClient(config);

  if (process.env.NODE_ENV !== 'production') {
    globalForMeta.meta = client;
  }

  return client;
}

// Export the singleton instance
export const meta = getMetaClient();

// Re-export API functions
export {
  createCampaign,
  updateCampaign,
  getCampaign,
  createAdSet,
  updateAdSet,
  getAdSet,
  createAd,
  updateAd,
  uploadAdVideo,
  uploadAdImage,
  createAdCreative,
  createDynamicCreativeAd,
  createMultiLanguageAd,
  createCBOCampaignWithAdSets,
  getInsights,
  getDailyInsights,
  getAdPreview,
  generateAdPreview,
  getSavedAudiences,
  getSavedAudience,
  getAllSavedAudiences,
} from './api';

// Re-export CBO types
export type {
  CBOCampaignConfig,
  CBOCampaignResult,
} from './api';

// Re-export types
export type {
  MetaConfig,
  MetaCampaignCreate,
  MetaCampaignResponse,
  MetaAdSetCreate,
  MetaAdSetResponse,
  MetaAdCreate,
  MetaAdResponse,
  MetaInsightsRequest,
  MetaInsightsResponse,
  MetaInsightData,
  MetaTargeting,
  MetaAdPreviewFormat,
  MetaSavedAudience,
  MetaSavedAudiencesResponse,
  LanguageCopies,
  MultiLanguageAdData,
} from './types';

// Re-export error classes
export {
  MetaError,
  MetaConfigError,
  MetaAuthError,
  MetaApiError,
  MetaValidationError,
  MetaRateLimitError,
} from './errors';

// Re-export client class for advanced usage
export { MetaClient } from './client';

// Re-export targeting functions
export {
  buildTargeting,
  getAvailableGenres,
  hasLgbtAudience,
  getBaseAudienceCount,
  previewTargetingInterests,
  clearAudienceCache,
} from './targeting';

// Re-export targeting types
export type {
  AudienceConfig,
  TargetingConfig,
  BuiltTargeting,
} from './targeting';

// Re-export location functions
export {
  searchLocations,
  validateLocations,
  getDefaultCountries,
  getLocationsByKeys,
  clearLocationCache,
} from './locations';

// Re-export location types
export type {
  MetaLocation,
  MetaLocationType,
} from './locations';

// Re-export locale functions
export {
  getLocaleIdsForLanguage,
  getSupportedLanguages,
  isLanguageSupported,
  searchLocales,
  clearLocaleCache,
} from './locales';

// Re-export locale types
export type { MetaLocale } from './locales';
