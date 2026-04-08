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

// ISO 3166-1 alpha-2 country codes to Google Ads geo_target_constant IDs.
// ID format: 2 + ISO 3166-1 numeric code (e.g., US=840 → 2840).
// Complete mapping so any country a user selects is supported.
const COUNTRY_GEO_TARGETS: Record<string, string> = {
  // Americas
  US: '2840', CA: '2124', MX: '2484', GT: '2320', BZ: '2084', HN: '2340',
  SV: '2222', NI: '2558', CR: '2188', PA: '2591', CU: '2192', JM: '2388',
  HT: '2332', DO: '2214', PR: '2630', TT: '2780', BB: '2052', BS: '2044',
  AG: '2028', DM: '2212', GD: '2308', KN: '2659', LC: '2662', VC: '2670',
  CO: '2170', VE: '2862', EC: '2218', PE: '2604', BO: '2068', CL: '2152',
  AR: '2032', UY: '2858', PY: '2600', BR: '2076', GY: '2328', SR: '2740',

  // Europe
  GB: '2826', IE: '2372', FR: '2250', DE: '2276', AT: '2040', CH: '2756',
  NL: '2528', BE: '2056', LU: '2442', ES: '2724', PT: '2620', IT: '2380',
  MT: '2470', GR: '2300', CY: '2196', TR: '2792', SE: '2752', NO: '2578',
  DK: '2208', FI: '2246', IS: '2352', PL: '2616', CZ: '2203', SK: '2703',
  HU: '2348', RO: '2642', BG: '2100', HR: '2191', SI: '2705', RS: '2688',
  BA: '2070', ME: '2499', MK: '2807', AL: '2008', XK: '2411', EE: '2233',
  LV: '2428', LT: '2440', UA: '2804', BY: '2112', MD: '2498', RU: '2643',
  GE: '2268', AM: '2051', AZ: '2031', MC: '2492', AD: '2020', LI: '2438',
  SM: '2674',

  // Middle East & Central Asia
  IL: '2376', PS: '2275', JO: '2400', LB: '2422', SY: '2760', IQ: '2368',
  KW: '2414', SA: '2682', BH: '2048', QA: '2634', AE: '2784', OM: '2512',
  YE: '2887', IR: '2364', AF: '2004', PK: '2586', KZ: '2398', UZ: '2860',
  TM: '2795', TJ: '2762', KG: '2417',

  // Africa
  EG: '2818', LY: '2434', TN: '2788', DZ: '2012', MA: '2504', MR: '2478',
  SN: '2686', GM: '2270', GN: '2324', SL: '2694', LR: '2430', CI: '2384',
  GH: '2288', TG: '2768', BJ: '2204', NE: '2562', NG: '2566', CM: '2120',
  TD: '2148', CF: '2140', GA: '2266', CG: '2178', CD: '2180', AO: '2024',
  ET: '2231', ER: '2232', DJ: '2262', SO: '2706', KE: '2404', UG: '2800',
  TZ: '2834', RW: '2646', BI: '2108', MW: '2454', MZ: '2508', ZM: '2894',
  ZW: '2716', BW: '2072', NA: '2516', ZA: '2710', SZ: '2748', LS: '2426',
  MG: '2450', MU: '2480', SC: '2690', SD: '2736', SS: '2728', ML: '2466',
  BF: '2854', CV: '2132', GW: '2624', ST: '2678', GQ: '2226',

  // Asia & Pacific
  IN: '2356', BD: '2050', LK: '2144', NP: '2524', BT: '2064', MV: '2462',
  MM: '2104', TH: '2764', VN: '2704', LA: '2418', KH: '2116', MY: '2458',
  SG: '2702', ID: '2360', PH: '2608', BN: '2096', TL: '2626', CN: '2156',
  HK: '2344', MO: '2446', TW: '2158', JP: '2392', KR: '2410', KP: '2408',
  MN: '2496',

  // Oceania
  AU: '2036', NZ: '2554', PG: '2598', FJ: '2242', WS: '2882', TO: '2776',
  VU: '2548', SB: '2090', KI: '2296', MH: '2584', FM: '2583', PW: '2585',
  NR: '2520',
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
