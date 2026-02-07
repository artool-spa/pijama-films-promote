/**
 * Google Ads Targeting Builder
 *
 * Maps film genres to Google affinity audiences and topics for YouTube video campaigns.
 * Builds demographic and geo targeting using geo_target_constants.
 */

import type { GoogleTargeting } from './types';

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
  affinityAudiences: string[]; // User interest resource names
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
// GENRE TO AFFINITY AUDIENCE MAPPING
// ============================================================================

// Maps film genres to Google Ads affinity audience resource names
// These are standard Google Ads affinity categories for movie/entertainment targeting
const GENRE_AFFINITY_AUDIENCES: Record<string, string[]> = {
  Drama: ['/affinityUserInterests/80432'], // Movie Lovers
  Comedia: ['/affinityUserInterests/80432', '/affinityUserInterests/80530'], // Movie Lovers, Comedy Fans
  'Acción': ['/affinityUserInterests/80432', '/affinityUserInterests/80502'], // Movie Lovers, Action & Adventure
  Terror: ['/affinityUserInterests/80432'], // Movie Lovers
  Suspenso: ['/affinityUserInterests/80432'], // Movie Lovers
  Romance: ['/affinityUserInterests/80432'], // Movie Lovers
  'Ciencia Ficción': ['/affinityUserInterests/80432', '/affinityUserInterests/80502'], // Movie Lovers, Sci-Fi
  Documental: ['/affinityUserInterests/80432', '/affinityUserInterests/80509'], // Movie Lovers, Documentary
  'Animación': ['/affinityUserInterests/80432', '/affinityUserInterests/80526'], // Movie Lovers, Animation
  Aventura: ['/affinityUserInterests/80432', '/affinityUserInterests/80502'], // Movie Lovers, Action & Adventure
  'Fantasía': ['/affinityUserInterests/80432'], // Movie Lovers
  Musical: ['/affinityUserInterests/80432', '/affinityUserInterests/80438'], // Movie Lovers, Music Lovers
  Crimen: ['/affinityUserInterests/80432'], // Movie Lovers
  'Biografía': ['/affinityUserInterests/80432', '/affinityUserInterests/80509'], // Movie Lovers, Documentary
  Historia: ['/affinityUserInterests/80432'], // Movie Lovers
  Guerra: ['/affinityUserInterests/80432'], // Movie Lovers
  Western: ['/affinityUserInterests/80432'], // Movie Lovers
  Familia: ['/affinityUserInterests/80432', '/affinityUserInterests/80526'], // Movie Lovers, Family
  Deportes: ['/affinityUserInterests/80432', '/affinityUserInterests/80496'], // Movie Lovers, Sports Fans
  Misterio: ['/affinityUserInterests/80432'], // Movie Lovers
};

// Base affinity audiences for all film campaigns
const BASE_AFFINITY_AUDIENCES = [
  '/affinityUserInterests/80432', // Movie Lovers
  '/affinityUserInterests/80433', // TV Lovers
  '/affinityUserInterests/80431', // Entertainment Fans
];

// ============================================================================
// AGE RANGE MAPPING
// ============================================================================

// Google Ads age range enum values
function mapAgeToGoogleRange(ageMin: number, ageMax: number): { min: string; max: string } {
  const ranges = ['AGE_RANGE_18_24', 'AGE_RANGE_25_34', 'AGE_RANGE_35_44', 'AGE_RANGE_45_54', 'AGE_RANGE_55_64', 'AGE_RANGE_65_UP'];

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
 * Build Google Ads targeting for a YouTube video campaign
 */
export function buildGoogleTargeting(config: GoogleTargetingConfig): GoogleTargetingResult {
  // Geo targeting
  const geoTargets = config.countries
    .map((code) => COUNTRY_GEO_TARGETS[code])
    .filter(Boolean)
    .map((id) => `geoTargetConstants/${id}`);

  // Age range
  const ageRange = mapAgeToGoogleRange(config.ageMin, config.ageMax);

  // Genders
  const genders = mapGenders(config.genders);

  // Affinity audiences
  const affinitySet = new Set<string>();

  // Add base audiences if enabled
  if (config.includeBaseAudiences) {
    for (const audience of BASE_AFFINITY_AUDIENCES) {
      affinitySet.add(audience);
    }
  }

  // Add genre-specific audiences
  for (const genre of config.filmGenres) {
    const audiences = GENRE_AFFINITY_AUDIENCES[genre];
    if (audiences) {
      for (const audience of audiences) {
        affinitySet.add(audience);
      }
    }
  }

  return {
    geoTargets,
    ageRange,
    genders,
    affinityAudiences: Array.from(affinitySet),
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
    affinityAudiences: result.affinityAudiences,
  };
}
