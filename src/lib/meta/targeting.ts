/**
 * Meta Audience Targeting Builder
 *
 * Builds targeting specifications for AdSets by combining:
 * - BASE audiences (core film enthusiast interests)
 * - Genre-specific audiences (GÉNEROS CINEMATOGRÁFICOS)
 * - LGBT audience (optional)
 *
 * Audiences are fetched from Meta saved audiences and combined using flexible_spec
 */

import { MetaClient } from './client';
import { getAllSavedAudiences, getSavedAudience } from './api';
import type { MetaSavedAudience, MetaTargeting } from './types';

// ============================================================================
// TYPES
// ============================================================================

export interface AudienceConfig {
  includeBaseAudiences: boolean;
  filmGenres: string[];
  includeLgbtAudience: boolean;
}

export interface TargetingConfig {
  countries: string[];
  ageMin: number;
  ageMax: number;
  genders: number[];
  audiences: AudienceConfig;
}

export interface Interest {
  id: string;
  name?: string;
}

export interface FlexibleSpec {
  interests?: Interest[];
  behaviors?: Interest[];
}

export interface BuiltTargeting {
  geo_locations: {
    countries: string[];
  };
  age_min: number;
  age_max: number;
  genders: number[];
  flexible_spec?: FlexibleSpec[];
  exclusions?: {
    interests?: Interest[];
  };
}

// ============================================================================
// AUDIENCE NAME PATTERNS
// ============================================================================

// Prefix patterns for different audience types
const BASE_AUDIENCE_PREFIX = 'BASE +';
const GENRE_AUDIENCE_PREFIX = 'GÉNEROS CINEMATOGRÁFICOS +';
const LGBT_AUDIENCE_NAME = 'LGBT';

// Genre name mappings (Spanish genre names to audience name patterns)
const GENRE_MAPPINGS: Record<string, string[]> = {
  'Drama': ['Drama', 'Dramático'],
  'Comedia': ['Comedia', 'Comedy'],
  'Acción': ['Acción', 'Action'],
  'Terror': ['Terror', 'Horror'],
  'Suspenso': ['Suspenso', 'Thriller'],
  'Romance': ['Romance', 'Romántico'],
  'Ciencia Ficción': ['Ciencia Ficción', 'Sci-Fi'],
  'Documental': ['Documental', 'Documentary'],
  'Animación': ['Animación', 'Animation'],
  'Aventura': ['Aventura', 'Adventure'],
  'Fantasía': ['Fantasía', 'Fantasy'],
  'Musical': ['Musical'],
  'Crimen': ['Crimen', 'Crime'],
  'Biografía': ['Biografía', 'Biography'],
  'Historia': ['Historia', 'Historical'],
  'Guerra': ['Guerra', 'War'],
  'Western': ['Western'],
  'Familia': ['Familia', 'Family'],
  'Deportes': ['Deportes', 'Sports'],
  'Misterio': ['Misterio', 'Mystery'],
};

// ============================================================================
// AUDIENCE FETCHING
// ============================================================================

/**
 * Cache for saved audiences to avoid repeated API calls
 */
let cachedAudiences: MetaSavedAudience[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get all saved audiences with caching
 */
async function getCachedAudiences(client: MetaClient): Promise<MetaSavedAudience[]> {
  const now = Date.now();

  if (cachedAudiences && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedAudiences;
  }

  cachedAudiences = await getAllSavedAudiences(client);
  cacheTimestamp = now;

  return cachedAudiences;
}

/**
 * Clear the audience cache (useful for testing or forced refresh)
 */
export function clearAudienceCache(): void {
  cachedAudiences = null;
  cacheTimestamp = 0;
}

/**
 * Filter audiences by name prefix
 */
function filterAudiencesByPrefix(
  audiences: MetaSavedAudience[],
  prefix: string
): MetaSavedAudience[] {
  return audiences.filter((a) => a.name.startsWith(prefix));
}

/**
 * Find audience by exact name
 */
function findAudienceByName(
  audiences: MetaSavedAudience[],
  name: string
): MetaSavedAudience | undefined {
  return audiences.find((a) => a.name === name);
}

/**
 * Find genre audiences that match any of the requested genres
 */
function findGenreAudiences(
  audiences: MetaSavedAudience[],
  genres: string[]
): MetaSavedAudience[] {
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
// INTEREST EXTRACTION
// ============================================================================

/**
 * Extract interests from a saved audience's targeting
 * Supports both legacy (pre-v24.0) and new (v24.0+) flexible_spec structure
 */
function extractInterests(audience: MetaSavedAudience): Interest[] {
  const interests: Interest[] = [];
  const targeting = audience.targeting;

  if (!targeting) return interests;

  // Legacy structure: direct interests array
  if (targeting.interests) {
    for (const interest of targeting.interests) {
      interests.push({
        id: interest.id,
        name: interest.name,
      });
    }
  }

  // v24.0+ structure: interests inside flexible_spec array
  if (targeting.flexible_spec) {
    for (const spec of targeting.flexible_spec) {
      if (spec.interests) {
        for (const interest of spec.interests) {
          interests.push({
            id: interest.id,
            name: interest.name,
          });
        }
      }
    }
  }

  return interests;
}

/**
 * Extract behaviors from a saved audience's targeting
 * Supports both legacy (pre-v24.0) and new (v24.0+) flexible_spec structure
 */
function extractBehaviors(audience: MetaSavedAudience): Interest[] {
  const behaviors: Interest[] = [];
  const targeting = audience.targeting;

  if (!targeting) return behaviors;

  // Legacy structure: direct behaviors array
  if (targeting.behaviors) {
    for (const behavior of targeting.behaviors) {
      behaviors.push({
        id: behavior.id,
        name: behavior.name,
      });
    }
  }

  // v24.0+ structure: behaviors inside flexible_spec array
  if (targeting.flexible_spec) {
    for (const spec of targeting.flexible_spec) {
      if (spec.behaviors) {
        for (const behavior of spec.behaviors) {
          behaviors.push({
            id: behavior.id,
            name: behavior.name,
          });
        }
      }
    }
  }

  return behaviors;
}

/**
 * Combine interests from multiple audiences, removing duplicates
 */
function combineInterests(audiences: MetaSavedAudience[]): Interest[] {
  const interestMap = new Map<string, Interest>();

  for (const audience of audiences) {
    const interests = extractInterests(audience);
    for (const interest of interests) {
      if (!interestMap.has(interest.id)) {
        interestMap.set(interest.id, interest);
      }
    }
  }

  return Array.from(interestMap.values());
}

/**
 * Combine behaviors from multiple audiences, removing duplicates
 */
function combineBehaviors(audiences: MetaSavedAudience[]): Interest[] {
  const behaviorMap = new Map<string, Interest>();

  for (const audience of audiences) {
    const behaviors = extractBehaviors(audience);
    for (const behavior of behaviors) {
      if (!behaviorMap.has(behavior.id)) {
        behaviorMap.set(behavior.id, behavior);
      }
    }
  }

  return Array.from(behaviorMap.values());
}

// ============================================================================
// MAIN TARGETING BUILDER
// ============================================================================

/**
 * Build Meta targeting specification for an AdSet
 *
 * The targeting is built as follows:
 * 1. Start with demographic targeting (geo, age, gender)
 * 2. If includeBaseAudiences, add BASE audience interests
 * 3. If filmGenres provided, intersect with genre-specific interests
 * 4. If includeLgbtAudience, intersect with LGBT audience
 *
 * Intersection is achieved using flexible_spec arrays in Meta API
 */
export async function buildTargeting(
  client: MetaClient,
  config: TargetingConfig
): Promise<BuiltTargeting> {
  const audiences = await getCachedAudiences(client);

  // Log available audiences for debugging
  console.log('[Meta] Available saved audiences:', audiences.map(a => a.name));

  // Start with basic demographic targeting
  const targeting: BuiltTargeting = {
    geo_locations: {
      countries: config.countries,
    },
    age_min: config.ageMin,
    age_max: config.ageMax,
    genders: config.genders,
  };

  const flexibleSpecs: FlexibleSpec[] = [];

  // 1. Add BASE audience interests if enabled
  if (config.audiences.includeBaseAudiences) {
    const baseAudiences = filterAudiencesByPrefix(audiences, BASE_AUDIENCE_PREFIX);
    console.log('[Meta] Found BASE audiences:', baseAudiences.map(a => a.name));

    // Debug: log what targeting data is available in audiences
    if (baseAudiences.length > 0) {
      console.log('[Meta] BASE audience targeting sample:', JSON.stringify(baseAudiences[0].targeting, null, 2));
    }

    if (baseAudiences.length > 0) {
      const baseInterests = combineInterests(baseAudiences);
      const baseBehaviors = combineBehaviors(baseAudiences);
      console.log('[Meta] Extracted BASE interests:', baseInterests.length, 'behaviors:', baseBehaviors.length);

      if (baseInterests.length > 0 || baseBehaviors.length > 0) {
        const spec: FlexibleSpec = {};
        if (baseInterests.length > 0) spec.interests = baseInterests;
        if (baseBehaviors.length > 0) spec.behaviors = baseBehaviors;
        flexibleSpecs.push(spec);
      }
    }
  }

  // 2. Add genre-specific interests if genres provided
  if (config.audiences.filmGenres.length > 0) {
    console.log('[Meta] Looking for genres:', config.audiences.filmGenres);
    const genreAudiences = findGenreAudiences(audiences, config.audiences.filmGenres);
    console.log('[Meta] Found genre audiences:', genreAudiences.map(a => a.name));

    if (genreAudiences.length > 0) {
      const genreInterests = combineInterests(genreAudiences);
      const genreBehaviors = combineBehaviors(genreAudiences);

      if (genreInterests.length > 0 || genreBehaviors.length > 0) {
        const spec: FlexibleSpec = {};
        if (genreInterests.length > 0) spec.interests = genreInterests;
        if (genreBehaviors.length > 0) spec.behaviors = genreBehaviors;
        flexibleSpecs.push(spec);
      }
    }
  }

  // 3. Add LGBT audience interests if enabled
  if (config.audiences.includeLgbtAudience) {
    const lgbtAudience = findAudienceByName(audiences, LGBT_AUDIENCE_NAME);

    if (lgbtAudience) {
      const lgbtInterests = extractInterests(lgbtAudience);
      const lgbtBehaviors = extractBehaviors(lgbtAudience);

      if (lgbtInterests.length > 0 || lgbtBehaviors.length > 0) {
        const spec: FlexibleSpec = {};
        if (lgbtInterests.length > 0) spec.interests = lgbtInterests;
        if (lgbtBehaviors.length > 0) spec.behaviors = lgbtBehaviors;
        flexibleSpecs.push(spec);
      }
    }
  }

  // Add flexible_spec if we have any audience targeting
  if (flexibleSpecs.length > 0) {
    targeting.flexible_spec = flexibleSpecs;
  }

  return targeting;
}

/**
 * Get available genre audiences for UI display
 */
export async function getAvailableGenres(client: MetaClient): Promise<string[]> {
  const audiences = await getCachedAudiences(client);
  const genreAudiences = filterAudiencesByPrefix(audiences, GENRE_AUDIENCE_PREFIX);

  return genreAudiences.map((a) =>
    a.name.replace(GENRE_AUDIENCE_PREFIX, '').trim()
  );
}

/**
 * Check if LGBT audience is available
 */
export async function hasLgbtAudience(client: MetaClient): Promise<boolean> {
  const audiences = await getCachedAudiences(client);
  return !!findAudienceByName(audiences, LGBT_AUDIENCE_NAME);
}

/**
 * Get BASE audience count for stats display
 */
export async function getBaseAudienceCount(client: MetaClient): Promise<number> {
  const audiences = await getCachedAudiences(client);
  const baseAudiences = filterAudiencesByPrefix(audiences, BASE_AUDIENCE_PREFIX);
  return baseAudiences.length;
}

/**
 * Preview what interests would be included in targeting
 * Useful for debugging and UI preview
 */
export async function previewTargetingInterests(
  client: MetaClient,
  config: AudienceConfig
): Promise<{
  baseInterests: Interest[];
  genreInterests: Interest[];
  lgbtInterests: Interest[];
  totalUniqueInterests: number;
}> {
  const audiences = await getCachedAudiences(client);

  let baseInterests: Interest[] = [];
  let genreInterests: Interest[] = [];
  let lgbtInterests: Interest[] = [];

  if (config.includeBaseAudiences) {
    const baseAudiences = filterAudiencesByPrefix(audiences, BASE_AUDIENCE_PREFIX);
    baseInterests = combineInterests(baseAudiences);
  }

  if (config.filmGenres.length > 0) {
    const genreAudiences = findGenreAudiences(audiences, config.filmGenres);
    genreInterests = combineInterests(genreAudiences);
  }

  if (config.includeLgbtAudience) {
    const lgbtAudience = findAudienceByName(audiences, LGBT_AUDIENCE_NAME);
    if (lgbtAudience) {
      lgbtInterests = extractInterests(lgbtAudience);
    }
  }

  // Count unique interests
  const allInterestIds = new Set([
    ...baseInterests.map((i) => i.id),
    ...genreInterests.map((i) => i.id),
    ...lgbtInterests.map((i) => i.id),
  ]);

  return {
    baseInterests,
    genreInterests,
    lgbtInterests,
    totalUniqueInterests: allInterestIds.size,
  };
}
