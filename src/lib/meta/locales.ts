/**
 * Meta Locales API
 *
 * Provides locale mapping for multi-language ad targeting.
 * Used for asset_customization_rules in dynamic creative ads.
 *
 * API Reference: https://developers.facebook.com/docs/marketing-api/audiences/reference/targeting-search
 */

import { z } from 'zod';
import { MetaClient } from './client';
import { MetaApiError } from './errors';

// ============================================================================
// TYPES
// ============================================================================

export const MetaLocaleSchema = z.object({
  key: z.number(),
  name: z.string(),
});

export type MetaLocale = z.infer<typeof MetaLocaleSchema>;

export const MetaLocaleSearchResponseSchema = z.object({
  data: z.array(MetaLocaleSchema),
});

export type MetaLocaleSearchResponse = z.infer<typeof MetaLocaleSearchResponseSchema>;

// ============================================================================
// LANGUAGE TO LOCALE MAPPING
// ============================================================================

/**
 * Hardcoded mapping from ISO 639-1 language codes to Meta locale IDs.
 * These are Facebook locale IDs used in asset_customization_rules.
 *
 * Reference: https://developers.facebook.com/docs/marketing-api/audiences/reference/basic-targeting#locales
 *
 * Common locale IDs:
 * - 6: English (US)
 * - 10: German
 * - 11: French
 * - 16: Italian
 * - 17: Japanese
 * - 18: Korean
 * - 20: Portuguese (Brazil)
 * - 21: Portuguese (Portugal)
 * - 23: Spanish (Spain)
 * - 24: Spanish (Latin America)
 * - 44: Chinese (Simplified)
 * - 45: Chinese (Traditional)
 */
const LANGUAGE_TO_LOCALES: Record<string, number[]> = {
  // Spanish variants
  es: [23, 24], // Spanish (Spain), Spanish (Latin America)
  'es-ES': [23], // Spanish (Spain) only
  'es-LA': [24], // Spanish (Latin America) only
  'es-MX': [24], // Mexican Spanish -> Latin America
  'es-AR': [24], // Argentine Spanish -> Latin America
  'es-CL': [24], // Chilean Spanish -> Latin America

  // English variants
  en: [6], // English (US)
  'en-US': [6], // English (US)
  'en-GB': [24], // English (UK) - Note: Meta uses different ID, using 24 as fallback

  // Portuguese variants
  pt: [20, 21], // Portuguese (Brazil), Portuguese (Portugal)
  'pt-BR': [20], // Portuguese (Brazil) only
  'pt-PT': [21], // Portuguese (Portugal) only

  // Other major languages
  fr: [11], // French
  de: [10], // German
  it: [16], // Italian
  ja: [17], // Japanese
  ko: [18], // Korean

  // Chinese variants
  zh: [44, 45], // Chinese (Simplified, Traditional)
  'zh-CN': [44], // Chinese (Simplified)
  'zh-TW': [45], // Chinese (Traditional)
  'zh-HK': [45], // Chinese (Hong Kong) -> Traditional

  // Additional European languages
  nl: [14], // Dutch
  pl: [19], // Polish
  ru: [22], // Russian
  tr: [42], // Turkish
  sv: [30], // Swedish
  da: [5], // Danish
  no: [15], // Norwegian
  fi: [9], // Finnish
  el: [12], // Greek
  cs: [4], // Czech
  hu: [13], // Hungarian
  ro: [37], // Romanian

  // Other Asian languages
  th: [40], // Thai
  vi: [43], // Vietnamese
  id: [25], // Indonesian
  ms: [26], // Malay

  // Middle Eastern languages
  ar: [28], // Arabic
  he: [27], // Hebrew
};

/**
 * Get Meta locale IDs for a given language code.
 *
 * @param langCode - ISO 639-1 language code (e.g., 'es', 'en', 'pt-BR')
 * @returns Array of Meta locale IDs
 *
 * @example
 * getLocaleIdsForLanguage('es') // [23, 24] - Spanish (Spain & Latin America)
 * getLocaleIdsForLanguage('pt-BR') // [20] - Portuguese (Brazil)
 */
export function getLocaleIdsForLanguage(langCode: string): number[] {
  // Try exact match first
  const exactMatch = LANGUAGE_TO_LOCALES[langCode];
  if (exactMatch) {
    return exactMatch;
  }

  // Try base language code (e.g., 'es-MX' -> 'es')
  const baseCode = langCode.split('-')[0].toLowerCase();
  const baseMatch = LANGUAGE_TO_LOCALES[baseCode];
  if (baseMatch) {
    return baseMatch;
  }

  // Default to English (US) if language not found
  console.warn(`[Meta] Unknown language code: ${langCode}, defaulting to English (US)`);
  return [6];
}

/**
 * Get supported language codes
 */
export function getSupportedLanguages(): string[] {
  return Object.keys(LANGUAGE_TO_LOCALES);
}

/**
 * Check if a language code is supported
 */
export function isLanguageSupported(langCode: string): boolean {
  const baseCode = langCode.split('-')[0].toLowerCase();
  return langCode in LANGUAGE_TO_LOCALES || baseCode in LANGUAGE_TO_LOCALES;
}

// ============================================================================
// CACHE
// ============================================================================

interface CacheEntry {
  data: MetaLocale[];
  timestamp: number;
}

const localeCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour (locales rarely change)

function getCacheKey(query: string): string {
  return `locale:${query.toLowerCase()}`;
}

function getFromCache(key: string): MetaLocale[] | null {
  const entry = localeCache.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (now - entry.timestamp > CACHE_TTL_MS) {
    localeCache.delete(key);
    return null;
  }

  return entry.data;
}

function setInCache(key: string, data: MetaLocale[]): void {
  localeCache.set(key, {
    data,
    timestamp: Date.now(),
  });
}

/**
 * Clear the locale cache (useful for testing or forced refresh)
 */
export function clearLocaleCache(): void {
  localeCache.clear();
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Search for locales using Meta's Targeting Search API
 *
 * @param client - MetaClient instance
 * @param query - Search query (e.g., "spanish", "english")
 * @param limit - Maximum number of results (default: 20)
 */
export async function searchLocales(
  client: MetaClient,
  query: string,
  limit: number = 20
): Promise<MetaLocale[]> {
  // Check cache first
  const cacheKey = getCacheKey(query);
  const cached = getFromCache(cacheKey);
  if (cached) {
    return cached;
  }

  // Build the search URL
  const params = new URLSearchParams({
    type: 'adlocale',
    q: query,
    limit: limit.toString(),
  });

  const url = `${client.baseUrl}/search?${params.toString()}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: client.getAuthHeaders(),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new MetaApiError(
        errorData.error?.message || 'Failed to search locales',
        {
          statusCode: response.status,
          errorCode: errorData.error?.code,
          response: errorData,
        }
      );
    }

    const data = await response.json();
    const parsed = MetaLocaleSearchResponseSchema.safeParse(data);

    if (!parsed.success) {
      console.error('Failed to parse locale search response:', parsed.error);
      return [];
    }

    const locales = parsed.data.data;

    // Cache the results
    setInCache(cacheKey, locales);

    return locales;
  } catch (error) {
    console.error('Error searching locales:', error);

    if (error instanceof MetaApiError) {
      throw error;
    }

    return [];
  }
}

/**
 * Get a locale by its ID from the hardcoded mapping
 */
export function getLocaleNameById(localeId: number): string | undefined {
  const localeNames: Record<number, string> = {
    4: 'Czech',
    5: 'Danish',
    6: 'English (US)',
    9: 'Finnish',
    10: 'German',
    11: 'French',
    12: 'Greek',
    13: 'Hungarian',
    14: 'Dutch',
    15: 'Norwegian',
    16: 'Italian',
    17: 'Japanese',
    18: 'Korean',
    19: 'Polish',
    20: 'Portuguese (Brazil)',
    21: 'Portuguese (Portugal)',
    22: 'Russian',
    23: 'Spanish (Spain)',
    24: 'Spanish (Latin America)',
    25: 'Indonesian',
    26: 'Malay',
    27: 'Hebrew',
    28: 'Arabic',
    30: 'Swedish',
    37: 'Romanian',
    40: 'Thai',
    42: 'Turkish',
    43: 'Vietnamese',
    44: 'Chinese (Simplified)',
    45: 'Chinese (Traditional)',
  };

  return localeNames[localeId];
}
