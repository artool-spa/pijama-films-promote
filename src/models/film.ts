/**
 * Film Model - Fetches film data from Muvi API
 *
 * This model layer:
 * - Fetches data from Muvi API using the #muvi service
 * - Maps Muvi data to Film interface
 * - Fetches real campaigns from database
 * - Generates ad copies from film metadata
 */

import { muvi, getMovies, getMovieDetails } from '#muvi';
import type {
  MuviMovie,
  MuviMovieDetails,
  MuviCast,
  MuviVideoAsset,
} from '#muvi';
import prisma from '#prisma';
import { getCampaignsByFilmMuviUuid, type CampaignWithAds } from './campaign';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

// Re-export the Campaign type from the campaign model
export type { CampaignWithAds as Campaign } from './campaign';

// Film campaign summary for display (aggregated stats)
export type CampaignSummary = {
  id: string;
  name: string;
  status: string;
  budget: number;
  startDate: string;
  endDate: string | null;
  adsCount: number;
};

export type MediaAsset = {
  id: string;
  type: 'image' | 'video';
  name: string;
  url: string;
  thumbnailUrl: string;
  /** Direct mp4 URL for uploading to YouTube (not a streaming manifest) */
  downloadUrl?: string;
};

export type AdCopyVariant = {
  headline: string;
  description: string;
};

export type AdCopies = {
  [language: string]: {
    A: AdCopyVariant;
    B: AdCopyVariant;
    C: AdCopyVariant;
  };
};

export type Film = {
  id: string;
  title: string;
  description: string;
  duration: number;
  year: number;
  genre: string[];
  director: string;
  posterUrl: string;
  trailerUrl: string;
  rentalUrl: string;
  isPublished: boolean;
  campaigns?: CampaignSummary[];
  campaignCount?: number;
  mediaAssets?: MediaAsset[];
};

// ============================================================================
// CAMPAIGN HELPERS
// Maps database campaigns to UI-friendly format
// ============================================================================

/**
 * Map database campaign to CampaignSummary for display
 */
function mapCampaignToSummary(campaign: CampaignWithAds): CampaignSummary {
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    budget: campaign.budget,
    startDate: campaign.startDate.toISOString().split('T')[0],
    endDate: campaign.endDate?.toISOString().split('T')[0] || null,
    adsCount: campaign.ads.length,
  };
}

/**
 * Fetch real campaigns for a film from the database
 */
async function fetchCampaignsForFilm(filmMuviUuid: string): Promise<CampaignSummary[]> {
  try {
    const campaigns = await getCampaignsByFilmMuviUuid(filmMuviUuid);
    return campaigns.map(mapCampaignToSummary);
  } catch (error) {
    console.error(`Failed to fetch campaigns for film ${filmMuviUuid}:`, error);
    return [];
  }
}

// ============================================================================
// AD COPY GENERATOR
// Generates ad copy variants directly from film metadata
// ============================================================================

/**
 * Truncate text to max length with ellipsis
 */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3).trim() + '...';
}

/**
 * Generate ad copy variants for a film based on its metadata
 * Creates personalized copies using actual film title, description, and genre
 */
export function generateAdCopiesForFilm(
  film: MuviMovie,
  language: string = 'en'
): { A: AdCopyVariant; B: AdCopyVariant; C: AdCopyVariant } {
  const title = film.content_name || 'Sin título';
  const desc = film.content_desc || '';
  const genre = film.categories?.[0]?.category_name || '';

  if (language === 'es') {
    return {
      A: {
        headline: `${title} - Ya disponible`,
        description: desc ? truncate(desc, 150) : `Descubre ${title}, una experiencia única.`,
      },
      B: {
        headline: genre ? `${genre}: ${title}` : `No te pierdas ${title}`,
        description: desc
          ? `${truncate(desc, 100)} Mírala ahora.`
          : `La película que todos están viendo. Disponible ahora.`,
      },
      C: {
        headline: `Mira ${title} hoy`,
        description: genre
          ? `${genre}. ${truncate(desc || title, 100)}`
          : truncate(desc || `Descubre ${title} en streaming.`, 120),
      },
    };
  }

  if (language === 'pt') {
    return {
      A: {
        headline: `${title} - Já disponível`,
        description: desc ? truncate(desc, 150) : `Descubra ${title}, uma experiência única.`,
      },
      B: {
        headline: genre ? `${genre}: ${title}` : `Não perca ${title}`,
        description: desc
          ? `${truncate(desc, 100)} Assista agora.`
          : `O filme que todos estão assistindo. Disponível agora.`,
      },
      C: {
        headline: `Assista ${title} hoje`,
        description: genre
          ? `${genre}. ${truncate(desc || title, 100)}`
          : truncate(desc || `Descubra ${title} em streaming.`, 120),
      },
    };
  }

  // English (default)
  return {
    A: {
      headline: `${title} - Now Streaming`,
      description: desc ? truncate(desc, 150) : `Discover ${title}, a unique experience.`,
    },
    B: {
      headline: genre ? `${genre}: ${title}` : `Don't Miss ${title}`,
      description: desc
        ? `${truncate(desc, 100)} Watch now.`
        : `The film everyone's watching. Available now.`,
    },
    C: {
      headline: `Watch ${title} Today`,
      description: genre
        ? `${genre}. ${truncate(desc || title, 100)}`
        : truncate(desc || `Discover ${title} on streaming.`, 120),
    },
  };
}

/**
 * Generate full ad copies for all supported languages
 */
export function generateAllAdCopiesForFilm(film: MuviMovie): AdCopies {
  const languages = ['en', 'es', 'pt'];
  const copies: AdCopies = {};

  for (const lang of languages) {
    copies[lang] = generateAdCopiesForFilm(film, lang);
  }

  return copies;
}

/**
 * Extract year from ISO date string
 */
function extractYear(dateString?: string | null): number {
  if (!dateString) return new Date().getFullYear();
  const date = new Date(dateString);
  return isNaN(date.getTime()) ? new Date().getFullYear() : date.getFullYear();
}

/**
 * Extract director from cast details
 * Looks for cast members with cast_type_name 'Director'
 */
function extractDirector(castDetails?: MuviCast[] | null): string {
  if (!castDetails || castDetails.length === 0) return '';

  const director = castDetails.find(
    (cast) =>
      cast.cast_type_details?.cast_type_name?.toLowerCase() === 'director'
  );

  return director?.cast_name || '';
}

/**
 * Extract genres from categories
 */
function extractGenres(movie: MuviMovie): string[] {
  if (!movie.categories || movie.categories.length === 0) return [];

  return movie.categories
    .map((cat) => cat.category_name)
    .filter((name): name is string => Boolean(name));
}

/**
 * Get poster URL from movie
 * Note: The API returns arrays for poster/banner platforms, which can be null
 * Priority: TV posters (higher res) > Website posters > Mobile posters
 */
function getPosterUrl(movie: MuviMovie): string {
  // TV posters tend to be higher resolution, prioritize them
  const tvPosters = movie.posters?.tv_apps;
  const websitePosters = movie.posters?.website;
  const mobilePosters = movie.posters?.mobile_apps;

  const posterUrl =
    (Array.isArray(tvPosters) && tvPosters[0]?.file_url) ||
    (Array.isArray(websitePosters) && websitePosters[0]?.file_url) ||
    (Array.isArray(mobilePosters) && mobilePosters[0]?.file_url) ||
    movie.app_poster_details?.file_url ||
    movie.no_image_available_url ||
    '';

  return posterUrl;
}

/**
 * Get trailer URL from video details
 */
function getTrailerUrl(trailerDetails?: MuviVideoAsset | null): string {
  if (!trailerDetails) return '';

  return (
    trailerDetails.mpeg_path ||
    trailerDetails.file_url ||
    trailerDetails.hls_path ||
    trailerDetails.third_party_url ||
    ''
  );
}

/**
 * Get a direct downloadable mp4 URL from MUVI video details.
 * Picks the highest resolution from encoded_url or offline_url arrays.
 * Returns undefined if no direct file URL is available.
 */
function getDirectVideoUrl(videoDetails?: MuviVideoAsset | null): string | undefined {
  if (!videoDetails) return undefined;

  // Try encoded_url first (transcoded mp4 files), then offline_url
  const candidates = [
    ...(videoDetails.encoded_url || []),
    ...(videoDetails.offline_url || []),
  ];

  // Pick the first available URL (typically highest resolution listed first)
  const directUrl = candidates.find(c => c.url)?.url;
  if (directUrl) return directUrl;

  // file_url is sometimes a direct file
  if (videoDetails.file_url) return videoDetails.file_url;

  return undefined;
}

/**
 * Map Muvi video/image assets to MediaAsset format
 */
function mapMediaAssets(movie: MuviMovieDetails): MediaAsset[] {
  const assets: MediaAsset[] = [];

  // Add poster as image asset
  const posterUrl = getPosterUrl(movie);
  if (posterUrl) {
    assets.push({
      id: `${movie.content_uuid}-poster`,
      type: 'image',
      name: 'Poster Oficial',
      url: posterUrl,
      thumbnailUrl: posterUrl,
    });
  }

  // Add banner as image asset
  const websiteBanners = movie.banners?.website;
  const bannerUrl = Array.isArray(websiteBanners) ? websiteBanners[0]?.file_url : undefined;
  if (bannerUrl) {
    assets.push({
      id: `${movie.content_uuid}-banner`,
      type: 'image',
      name: 'Banner',
      url: bannerUrl,
      thumbnailUrl: bannerUrl,
    });
  }

  // Add trailer as video asset
  if (movie.trailer_details) {
    const trailerUrl = getTrailerUrl(movie.trailer_details);
    if (trailerUrl) {
      assets.push({
        id: `${movie.content_uuid}-trailer`,
        type: 'video',
        name: 'Trailer',
        url: trailerUrl,
        thumbnailUrl: posterUrl,
        downloadUrl: getDirectVideoUrl(movie.trailer_details),
      });
    }
  }

  // Add main video as asset
  if (movie.video_details) {
    const videoUrl =
      movie.video_details.mpeg_path ||
      movie.video_details.file_url ||
      movie.video_details.hls_path ||
      movie.video_details.third_party_url ||
      '';
    if (videoUrl) {
      assets.push({
        id: `${movie.content_uuid}-video`,
        type: 'video',
        name: 'Video Principal',
        url: videoUrl,
        thumbnailUrl: posterUrl,
        downloadUrl: getDirectVideoUrl(movie.video_details),
      });
    }
  }

  return assets;
}

/**
 * Map MuviMovie to Film interface
 */
/**
 * Parse duration from string (e.g., "01:44:04") or number to minutes
 */
function parseDuration(duration?: string | number | null): number {
  if (!duration) return 0;
  if (typeof duration === 'number') return duration;

  // Parse "HH:MM:SS" format to minutes
  const parts = duration.split(':').map(Number);
  if (parts.length === 3) {
    const [hours, minutes] = parts;
    return hours * 60 + minutes;
  }
  return 0;
}

function mapMuviToFilm(movie: MuviMovie): Film {
  const movieDetails = movie as MuviMovieDetails;

  return {
    id: movie.content_uuid,
    title: movie.content_name || 'Sin título',
    description: movie.content_desc || '',
    duration: parseDuration(movieDetails.video_details?.duration),
    year: extractYear(movie.content_created_date),
    genre: extractGenres(movie),
    director: extractDirector(movieDetails.cast_details),
    posterUrl: getPosterUrl(movie),
    trailerUrl: getTrailerUrl(movieDetails.trailer_details),
    rentalUrl: movie.content_permalink || '',
    isPublished: movie.content_status === 2 || movie.content_status === 'active',
    campaigns: [], // Will be populated by getFilms/getFilmById if needed
    campaignCount: 0,
    mediaAssets: mapMediaAssets(movieDetails),
  };
}

// Store for caching movie data to avoid repeated API calls for campaigns
let cachedMovies: MuviMovie[] = [];

/**
 * Fetch and cache all movies for campaign calculations
 */
async function fetchAndCacheMovies(): Promise<MuviMovie[]> {
  if (cachedMovies.length > 0) {
    return cachedMovies;
  }

  try {
    const result = await getMovies(muvi, { page: 1, perPage: 100 });
    cachedMovies = result.movies;
    return cachedMovies;
  } catch (error) {
    console.error('Failed to fetch movies for cache:', error);
    return [];
  }
}

// Results type for getFilms
export interface GetFilmsResult {
  films: Film[];
  total: number;
  pages: number;
  currentPage: number;
}

/**
 * Get a paginated list of films from Muvi API
 * Optionally includes real campaign data from the database
 */
export async function getFilms(
  page: number = 1,
  limit: number = 12,
  includeCampaigns: boolean = true
): Promise<GetFilmsResult> {
  try {
    const result = await getMovies(muvi, { page, perPage: limit });

    // Cache the movies for later use
    if (page === 1 && result.movies.length > 0) {
      cachedMovies = result.movies;
    }

    // Map movies to films
    const films = result.movies.map((movie) => mapMuviToFilm(movie));

    // Fetch real campaigns from database if requested
    if (includeCampaigns) {
      await Promise.all(
        films.map(async (film) => {
          const campaigns = await fetchCampaignsForFilm(film.id);
          film.campaigns = campaigns;
          film.campaignCount = campaigns.length;
        })
      );
    }

    return {
      films,
      total: result.totalCount,
      pages: Math.ceil(result.totalCount / limit),
      currentPage: page,
    };
  } catch (error) {
    console.error('Failed to fetch films from Muvi:', error);
    throw error;
  }
}

/**
 * Get a single film by ID from Muvi API
 * Includes real campaigns from the database
 */
export async function getFilmById(
  id: string,
  includeCampaigns: boolean = true
): Promise<Film | undefined> {
  try {
    const movie = await getMovieDetails(muvi, id);

    if (!movie) {
      return undefined;
    }

    const film = mapMuviToFilm(movie);

    // Fetch real campaigns from database
    if (includeCampaigns) {
      const campaigns = await fetchCampaignsForFilm(film.id);
      film.campaigns = campaigns;
      film.campaignCount = campaigns.length;
    }

    return film;
  } catch (error) {
    console.error(`Failed to fetch film ${id} from Muvi:`, error);
    throw error;
  }
}

/**
 * Get aggregate stats for all campaigns from the database
 * Returns real stats from database campaigns
 */
export async function getAggregateStats() {
  try {
    const result = await prisma.campaign.aggregate({
      where: { status: { not: 'DRAFT' } },
      _sum: {
        budget: true,
      },
      _count: {
        id: true,
      },
    });

    const activeCampaigns = await prisma.campaign.count({
      where: { status: 'ACTIVE' },
    });

    return {
      totalBudget: result._sum.budget || 0,
      totalCampaigns: result._count.id,
      activeCampaigns,
      // These will be populated from Meta Insights API when available
      totalSpend: 0,
      totalConversions: 0,
      totalImpressions: 0,
      costPerConversion: 0,
    };
  } catch (error) {
    console.error('Failed to get aggregate stats:', error);
    return {
      totalBudget: 0,
      totalCampaigns: 0,
      activeCampaigns: 0,
      totalSpend: 0,
      totalConversions: 0,
      totalImpressions: 0,
      costPerConversion: 0,
    };
  }
}

/**
 * Get all campaigns from the database with their ads
 */
export async function getAllCampaigns(): Promise<CampaignWithAds[]> {
  try {
    const campaigns = await prisma.campaign.findMany({
      include: {
        ads: {
          include: {
            images: true,
            videos: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return campaigns as CampaignWithAds[];
  } catch (error) {
    console.error('Failed to get all campaigns:', error);
    return [];
  }
}

/**
 * Get films with their real campaigns from the database
 * Returns all films that have at least one campaign
 */
export async function getFilmsWithCampaigns(): Promise<Film[]> {
  const movies = await fetchAndCacheMovies();
  const films = movies.map((movie) => mapMuviToFilm(movie));

  // Fetch campaigns for all films in parallel
  await Promise.all(
    films.map(async (film) => {
      const campaigns = await fetchCampaignsForFilm(film.id);
      film.campaigns = campaigns;
      film.campaignCount = campaigns.length;
    })
  );

  // Return only films that have campaigns
  return films.filter((film) => (film.campaignCount || 0) > 0);
}

/**
 * Get generated ad copies for a film by ID
 * Fetches film from API and generates ad copies based on metadata
 */
export async function getAdCopiesForFilm(
  filmId: string,
  language: string = 'en'
): Promise<{ A: AdCopyVariant; B: AdCopyVariant; C: AdCopyVariant } | null> {
  try {
    const movie = await getMovieDetails(muvi, filmId);
    if (!movie) return null;

    return generateAdCopiesForFilm(movie, language);
  } catch (error) {
    console.error(`Failed to get ad copies for film ${filmId}:`, error);
    return null;
  }
}

/**
 * Get all ad copies for a film across multiple languages
 */
export async function getAllAdCopiesForFilm(
  filmId: string
): Promise<AdCopies | null> {
  try {
    const movie = await getMovieDetails(muvi, filmId);
    if (!movie) return null;

    return generateAllAdCopiesForFilm(movie);
  } catch (error) {
    console.error(`Failed to get all ad copies for film ${filmId}:`, error);
    return null;
  }
}
