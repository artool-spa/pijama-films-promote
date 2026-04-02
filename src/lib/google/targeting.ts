/**
 * Google Ads Targeting Builder
 *
 * Builds targeting specifications for campaigns by combining:
 * - BASE audiences (core film enthusiast custom audiences)
 * - Genre-specific audiences (GÉNEROS CINEMATOGRÁFICOS)
 * - LGBT audience (optional)
 *
 * Audiences are fetched dynamically from Google Ads custom audiences,
 * mirroring Meta's targeting approach with the same naming convention.
 */

import { createLogger } from '@/lib/logger';
import type { GoogleTargeting } from './types';
import type { GoogleAdsClient } from './client';
import type { GoogleCustomAudience } from './api';
import { getAllCustomAudiences } from './api';

const log = createLogger('google-targeting');

// ============================================================================
// TYPES
// ============================================================================

export interface GoogleTargetingConfig {
  countries: string[];
  ageMin: number;
  ageMax: number;
  genders: number[]; // Meta-style gender codes: 1=male, 2=female
  filmGenres: string[];
  includeBaseAudiences: boolean;
}

export interface GoogleTargetingResult {
  geoTargets: string[]; // geo_target_constant resource names
  ageRange?: { min: string; max: string };
  genders: string[]; // MALE, FEMALE, UNDETERMINED
  affinityAudiences: string[]; // Kept for backward compatibility (empty)
  customAudiences: string[]; // Custom audience resource names
  topicIds: string[]; // Topic constant resource names
}

// ============================================================================
// COUNTRY CODE TO GEO TARGET CONSTANT
// ============================================================================

// Common country codes to Google Ads geo_target_constant IDs
const COUNTRY_GEO_TARGETS: Record<string, string> = {
  US: '2840',
  CL: '2152',
  AR: '2032',
  MX: '2484',
  ES: '2724',
  BR: '2076',
  CO: '2170',
  PE: '2604',
  GB: '2826',
  FR: '2250',
  DE: '2276',
  IT: '2380',
  CA: '2124',
  AU: '2036',
  JP: '2392',
  KR: '2410',
};

// ============================================================================
// AUDIENCE NAME PATTERNS (same convention as Meta)
// ============================================================================

const BASE_AUDIENCE_PREFIX = 'Base_';
const GENRE_AUDIENCE_PREFIX = 'GENEROS_CINEMATOGRAFICOS_';

// Genre name mappings (frontend Spanish genre → Google Ads audience name suffixes)
const GENRE_MAPPINGS: Record<string, string[]> = {
  'Drama': ['Drama'],
  'Comedia': ['Comedia', 'Comedy'],
  'Acción': ['Accion', 'Action'],
  'Terror': ['Terror', 'Horror'],
  'Suspenso': ['Suspenso', 'Thriller'],
  'Romance': ['Romance'],
  'Ciencia Ficción': ['Ciencia_Ficcion', 'Sci_Fi', 'SciFi'],
  'Documental': ['Documental', 'Documentary'],
  'Animación': ['Animacion', 'Animation'],
  'Aventura': ['Aventura', 'Adventure'],
  'Fantasía': ['Fantasia', 'Fantasy'],
  'Musical': ['Musical'],
  'Crimen': ['Crimen', 'Crime'],
  'Biografía': ['Biografia', 'Biography'],
  'Historia': ['Historia', 'Historical'],
  'Guerra': ['Guerra', 'War'],
  'Western': ['Western'],
  'Familia': ['Familia', 'Family'],
  'Deportes': ['Deportes', 'Sports'],
  'Misterio': ['Misterio', 'Mystery'],
};

// ============================================================================
// AUDIENCE CACHING
// ============================================================================

let cachedAudiences: GoogleCustomAudience[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get all custom audiences with caching
 */
async function getCachedAudiences(client: GoogleAdsClient): Promise<GoogleCustomAudience[]> {
  const now = Date.now();

  if (cachedAudiences && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedAudiences;
  }

  cachedAudiences = await getAllCustomAudiences(client);
  cacheTimestamp = now;

  return cachedAudiences;
}

/**
 * Clear the audience cache (useful for testing or forced refresh)
 */
export function clearGoogleAudienceCache(): void {
  cachedAudiences = null;
  cacheTimestamp = 0;
}

// ============================================================================
// AUDIENCE FILTERING
// ============================================================================

/**
 * Filter audiences by name prefix
 */
function filterAudiencesByPrefix(
  audiences: GoogleCustomAudience[],
  prefix: string
): GoogleCustomAudience[] {
  return audiences.filter((a) => a.name.startsWith(prefix));
}

/**
 * Find genre audiences that match any of the requested genres
 */
function findGenreAudiences(
  audiences: GoogleCustomAudience[],
  genres: string[]
): GoogleCustomAudience[] {
  const genreAudiences = filterAudiencesByPrefix(audiences, GENRE_AUDIENCE_PREFIX);

  return genreAudiences.filter((audience) => {
    const audienceName = audience.name.replace(GENRE_AUDIENCE_PREFIX, '').trim();

    return genres.some((requestedGenre) => {
      // Check direct match
      if (audienceName.toLowerCase().includes(requestedGenre.toLowerCase())) {
        return true;
      }

      // Check mapped variations
      const mappings = GENRE_MAPPINGS[requestedGenre];
      if (mappings) {
        return mappings.some((mapping) =>
          audienceName.toLowerCase().includes(mapping.toLowerCase())
        );
      }

      return false;
    });
  });
}

// ============================================================================
// AGE RANGE MAPPING
// ============================================================================

// Google Ads age range enum values
function mapAgeToGoogleRange(ageMin: number, ageMax: number): { min: string; max: string } {
  let min = 'AGE_RANGE_18_24';
  let max = 'AGE_RANGE_65_UP';

  if (ageMin >= 55) min = 'AGE_RANGE_55_64';
  else if (ageMin >= 45) min = 'AGE_RANGE_45_54';
  else if (ageMin >= 35) min = 'AGE_RANGE_35_44';
  else if (ageMin >= 25) min = 'AGE_RANGE_25_34';
  else min = 'AGE_RANGE_18_24';

  if (ageMax >= 65) max = 'AGE_RANGE_65_UP';
  else if (ageMax >= 55) max = 'AGE_RANGE_55_64';
  else if (ageMax >= 45) max = 'AGE_RANGE_45_54';
  else if (ageMax >= 35) max = 'AGE_RANGE_35_44';
  else if (ageMax >= 25) max = 'AGE_RANGE_25_34';
  else max = 'AGE_RANGE_18_24';

  return { min, max };
}

// ============================================================================
// GENDER MAPPING
// ============================================================================

/**
 * Map Meta-style gender codes to Google Ads gender types
 * Meta: 1=male, 2=female
 * Google: MALE, FEMALE, UNDETERMINED
 */
function mapGenders(metaGenders: number[]): string[] {
  if (metaGenders.length === 0) return []; // All genders

  const googleGenders: string[] = [];
  if (metaGenders.includes(1)) googleGenders.push('MALE');
  if (metaGenders.includes(2)) googleGenders.push('FEMALE');

  return googleGenders;
}

// ============================================================================
// MAIN TARGETING BUILDER
// ============================================================================

/**
 * Build Google Ads targeting by dynamically fetching custom audiences
 * from the account, mirroring Meta's targeting approach.
 */
export async function buildGoogleTargeting(
  client: GoogleAdsClient,
  config: GoogleTargetingConfig
): Promise<GoogleTargetingResult> {
  const audiences = await getCachedAudiences(client);

  log.debug({ audiences: audiences.map(a => a.name) }, 'Available custom audiences');

  // Geo targeting
  const geoTargets = config.countries
    .map((code) => COUNTRY_GEO_TARGETS[code])
    .filter(Boolean)
    .map((id) => `geoTargetConstants/${id}`);

  // Age range
  const ageRange = mapAgeToGoogleRange(config.ageMin, config.ageMax);

  // Genders
  const genders = mapGenders(config.genders);

  // Custom audiences
  const customAudienceSet = new Set<string>();

  // Add BASE audiences if enabled
  if (config.includeBaseAudiences) {
    const baseAudiences = filterAudiencesByPrefix(audiences, BASE_AUDIENCE_PREFIX);
    log.debug({ audiences: baseAudiences.map(a => a.name) }, 'Found BASE audiences');

    for (const audience of baseAudiences) {
      customAudienceSet.add(audience.resourceName);
    }
  }

  // Add genre-specific audiences
  if (config.filmGenres.length > 0) {
    log.debug({ genres: config.filmGenres }, 'Looking for genres');
    const genreAudiences = findGenreAudiences(audiences, config.filmGenres);
    log.debug({ audiences: genreAudiences.map(a => a.name) }, 'Found genre audiences');

    for (const audience of genreAudiences) {
      customAudienceSet.add(audience.resourceName);
    }
  }

  return {
    geoTargets,
    ageRange,
    genders,
    affinityAudiences: [], // No longer used; kept for backward compatibility
    customAudiences: Array.from(customAudienceSet),
    topicIds: [], // Can be extended with topic targeting
  };
}

/**
 * Convert GoogleTargetingResult to the format used by Google Ads API schemas
 */
export function toGoogleTargetingSchema(result: GoogleTargetingResult): GoogleTargeting {
  return {
    countries: result.geoTargets,
    ageMin: undefined, // Age is set via campaign criteria
    ageMax: undefined,
    genders: result.genders.length > 0 ? result.genders as Array<'MALE' | 'FEMALE' | 'UNDETERMINED'> : undefined,
    affinityAudiences: result.affinityAudiences.length > 0 ? result.affinityAudiences : undefined,
    customAudiences: result.customAudiences.length > 0 ? result.customAudiences : undefined,
  };
}
