/**
 * Meta Locations API
 *
 * Provides location search functionality using Meta's Targeting Search API.
 * Used for campaign targeting by country, region, city, etc.
 *
 * API Reference: https://developers.facebook.com/docs/marketing-api/audiences/reference/targeting-search
 */

import { z } from 'zod';
import { createLogger } from '@/lib/logger';
import { MetaClient } from './client';
import { MetaApiError } from './errors';

const log = createLogger('meta-locations');

// ============================================================================
// TYPES
// ============================================================================

export const MetaLocationTypeSchema = z.enum([
  'country',
  'region',
  'city',
  'zip',
  'geo_market',
  'electoral_district',
]);

export type MetaLocationType = z.infer<typeof MetaLocationTypeSchema>;

export const MetaLocationSchema = z.object({
  key: z.string(),
  name: z.string(),
  type: MetaLocationTypeSchema,
  country_code: z.string().optional(),
  country_name: z.string().optional(),
  region: z.string().optional(),
  region_id: z.string().optional(),
  primary_city: z.string().optional(),
  primary_city_id: z.string().optional(),
  supports_region: z.boolean().optional(),
  supports_city: z.boolean().optional(),
});

export type MetaLocation = z.infer<typeof MetaLocationSchema>;

export const MetaLocationSearchResponseSchema = z.object({
  data: z.array(MetaLocationSchema),
});

export type MetaLocationSearchResponse = z.infer<typeof MetaLocationSearchResponseSchema>;

// ============================================================================
// CACHE
// ============================================================================

interface CacheEntry {
  data: MetaLocation[];
  timestamp: number;
}

const locationCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getCacheKey(query: string, types: MetaLocationType[], countryCode?: string): string {
  return `${types.sort().join(',')}:${query.toLowerCase()}:${countryCode || ''}`;
}

function getFromCache(key: string): MetaLocation[] | null {
  const entry = locationCache.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (now - entry.timestamp > CACHE_TTL_MS) {
    locationCache.delete(key);
    return null;
  }

  return entry.data;
}

function setInCache(key: string, data: MetaLocation[]): void {
  locationCache.set(key, {
    data,
    timestamp: Date.now(),
  });
}

/**
 * Clear the location cache (useful for testing or forced refresh)
 */
export function clearLocationCache(): void {
  locationCache.clear();
}

// ============================================================================
// DEFAULT COUNTRIES (Fallback)
// ============================================================================

const DEFAULT_COUNTRIES: MetaLocation[] = [
  { key: 'CL', name: 'Chile', type: 'country', country_code: 'CL' },
  { key: 'AR', name: 'Argentina', type: 'country', country_code: 'AR' },
  { key: 'MX', name: 'Mexico', type: 'country', country_code: 'MX' },
  { key: 'ES', name: 'Spain', type: 'country', country_code: 'ES' },
  { key: 'US', name: 'United States', type: 'country', country_code: 'US' },
  { key: 'BR', name: 'Brazil', type: 'country', country_code: 'BR' },
  { key: 'CO', name: 'Colombia', type: 'country', country_code: 'CO' },
  { key: 'PE', name: 'Peru', type: 'country', country_code: 'PE' },
  { key: 'VE', name: 'Venezuela', type: 'country', country_code: 'VE' },
  { key: 'EC', name: 'Ecuador', type: 'country', country_code: 'EC' },
];

/**
 * Get default countries list (used as fallback when API fails)
 */
export function getDefaultCountries(): MetaLocation[] {
  return DEFAULT_COUNTRIES;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Search for locations using Meta's Targeting Search API
 *
 * @param client - MetaClient instance
 * @param query - Search query (e.g., "argentina", "buenos aires")
 * @param types - Location types to search (default: ['country'])
 * @param countryCode - Optional country code to filter results (for regions/cities)
 * @param limit - Maximum number of results (default: 20)
 */
export async function searchLocations(
  client: MetaClient,
  query: string,
  types: MetaLocationType[] = ['country'],
  countryCode?: string,
  limit: number = 20
): Promise<MetaLocation[]> {
  // Check cache first
  const cacheKey = getCacheKey(query, types, countryCode);
  const cached = getFromCache(cacheKey);
  if (cached) {
    return cached;
  }

  // Build the search URL
  const params = new URLSearchParams({
    type: 'adgeolocation',
    location_types: JSON.stringify(types),
    q: query,
    limit: limit.toString(),
    locale: 'en_US',
  });

  if (countryCode) {
    params.set('country_code', countryCode);
  }

  const url = `${client.baseUrl}/search?${params.toString()}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: client.getAuthHeaders(),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new MetaApiError(
        errorData.error?.message || 'Failed to search locations',
        {
          statusCode: response.status,
          errorCode: errorData.error?.code,
          response: errorData,
        }
      );
    }

    const data = await response.json();
    const parsed = MetaLocationSearchResponseSchema.safeParse(data);

    if (!parsed.success) {
      log.error({ err: parsed.error }, 'Failed to parse location search response');
      // Return empty array on parse error, don't throw
      return [];
    }

    const locations = parsed.data.data;

    // Cache the results
    setInCache(cacheKey, locations);

    return locations;
  } catch (error) {
    // Log error but return empty array to allow fallback
    log.error({ err: error }, 'Error searching locations');

    // For API errors, rethrow to let caller handle
    if (error instanceof MetaApiError) {
      throw error;
    }

    // For network errors, return empty array
    return [];
  }
}

/**
 * Validate that the provided locations exist in Meta's database
 *
 * @param client - MetaClient instance
 * @param locations - Array of location keys to validate
 * @returns Object with valid boolean and list of invalid locations
 */
export async function validateLocations(
  client: MetaClient,
  locations: string[]
): Promise<{ valid: boolean; invalidLocations: string[] }> {
  const invalidLocations: string[] = [];

  for (const locationKey of locations) {
    try {
      // Search for the exact location by key
      const results = await searchLocations(
        client,
        locationKey,
        ['country', 'region', 'city'],
        undefined,
        5
      );

      // Check if any result matches the key
      const found = results.some(
        (loc) => loc.key === locationKey || loc.country_code === locationKey
      );

      if (!found) {
        invalidLocations.push(locationKey);
      }
    } catch {
      // If search fails, consider location invalid
      invalidLocations.push(locationKey);
    }
  }

  return {
    valid: invalidLocations.length === 0,
    invalidLocations,
  };
}

/**
 * Get locations by their keys (for displaying selected locations)
 *
 * @param client - MetaClient instance
 * @param keys - Array of location keys to fetch
 */
export async function getLocationsByKeys(
  client: MetaClient,
  keys: string[]
): Promise<MetaLocation[]> {
  const locations: MetaLocation[] = [];

  for (const key of keys) {
    // First check if it's a default country
    const defaultCountry = DEFAULT_COUNTRIES.find(
      (c) => c.key === key || c.country_code === key
    );

    if (defaultCountry) {
      locations.push(defaultCountry);
      continue;
    }

    // Otherwise search for it
    try {
      const results = await searchLocations(
        client,
        key,
        ['country', 'region', 'city'],
        undefined,
        1
      );

      const match = results.find(
        (loc) => loc.key === key || loc.country_code === key
      );

      if (match) {
        locations.push(match);
      }
    } catch {
      // Skip locations that can't be found
      log.warn({ key }, 'Could not find location with key');
    }
  }

  return locations;
}
