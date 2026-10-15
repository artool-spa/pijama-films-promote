/**
 * Film Model - Fetches film data from Muvi API
 *
 * This model layer:
 * - Fetches data from Muvi API using the #muvi service
 * - Maps Muvi data to Film interface
 * - Fetches real campaigns from database
 * - Generates ad copies from film metadata
 */

import { createLogger } from '@/lib/logger';
import { muvi, getMovies, getMovieDetails, MuviApiError } from '#muvi';
import type {
  MuviMovie,
  MuviMovieDetails,
  MuviCast,
  MuviVideoAsset,
  MuviCustomField,
  GetMoviesOptions,
} from '#muvi';
import { AggregateField } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { COLLECTIONS, IdSchema as PartnerDocIdSchema, docData } from '@/lib/firestore';
import { getSession } from '@/lib/auth/session';
import {
  AtlasCatalogError,
  fetchPartnerCatalogue,
  type ExternalMovie,
} from '@/lib/atlas/external-api';
import { withAds } from './hydrate';
import { getPartnerRecordByPartnerId } from './partner';
import { getCampaignsByFilmMuviUuid, type CampaignWithAds } from './campaign';

const log = createLogger('film');

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
  metaCampaignId: string | null;
  googleCampaignId: string | null;
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
    metaCampaignId: campaign.metaCampaignId,
    googleCampaignId: campaign.googleCampaignId ?? null,
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
    log.error({ err: error, filmMuviUuid }, 'Failed to fetch campaigns for film');
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
 * Extract "Year of Production" from custom_field_data array.
 * Falls back to parsing the date string (content_created_date).
 */
function extractYear(
  customFields?: MuviCustomField[] | null,
  dateString?: string | null,
): number {
  // Try custom field first
  if (customFields) {
    const yearField = customFields.find(
      (f) => f.custom_field_name === 'Year of Production'
    );
    if (yearField?.custom_field_value) {
      const parsed = parseInt(yearField.custom_field_value, 10);
      if (!isNaN(parsed) && parsed > 1800 && parsed < 2200) {
        return parsed;
      }
    }
  }

  // Fallback to date string
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

  // `movie.video_details` is the FULL FEATURE FILM, and it is deliberately NOT
  // mapped into a promotable asset. This is not an oversight -- do not re-add it.
  //
  // Two exposure paths made this a production incident:
  //   1. Direct download. The asset carried a `downloadUrl` pointing at MUVI's
  //      direct file, and the asset card in the UI renders a download button, so
  //      anyone reaching the film page could pull the producer's whole movie.
  //   2. Meta ingestion. `uploadAdVideo` (src/lib/meta/api.ts) sends
  //      `file_url: videoUrl`, and Meta downloads the video from that URL. If the
  //      asset were picked as a creative, Meta would ingest the feature film. The
  //      500 MB cap does not protect here: it only applies to user uploads
  //      (src/lib/storage/client.ts), never to URLs referenced from MUVI.
  //
  // `movie.trailer_details` above is the trailer -- legitimate promotional
  // material -- and stays. The invariant is pinned by
  // src/models/__tests__/film-media-assets.test.ts.

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
    year: extractYear(movie.custom_field_data, movie.content_created_date),
    genre: extractGenres(movie),
    director: extractDirector(movieDetails.cast_details),
    posterUrl: getPosterUrl(movie),
    trailerUrl: getTrailerUrl(movieDetails.trailer_details),
    rentalUrl: `https://pijamafilms.com/watch/${movie.content_uuid}`,
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
    log.error({ err: error }, 'Failed to fetch movies for cache');
    return [];
  }
}

// ============================================================================
// CATALOGUE SOURCE - decided by the verified session, never by the request
// ============================================================================

/** Prefix the Atlas login route puts on `session.uid` (`atlas:<partnerId>`). */
const ATLAS_UID_PREFIX = 'atlas:';

export type CatalogueSource =
  | { kind: 'atlas'; partnerId: string }
  | { kind: 'muvi' };

/**
 * Which catalogue this session may see.
 *
 * - Atlas SSO session (`uid` = `atlas:<partnerId>`) -> that partner's own
 *   catalogue, from the external API, keyed by the SESSION's partnerId.
 * - Any other session (the in-house Firebase users) -> the global MUVI catalogue.
 *
 * Fail-closed: no session throws, and an Atlas uid whose partnerId disagrees
 * with the session's partnerId throws. The external API key sees every
 * partner, so a mismatch must never fall through to "some catalogue".
 */
export async function resolveCatalogueSource(): Promise<CatalogueSource> {
  const session = await getSession();

  if (!session) {
    throw new Error('A session is required to read the film catalogue');
  }

  if (!session.uid.startsWith(ATLAS_UID_PREFIX)) {
    return { kind: 'muvi' };
  }

  if (session.uid !== `${ATLAS_UID_PREFIX}${session.partnerId}`) {
    throw new Error('Atlas session identity is inconsistent');
  }

  return { kind: 'atlas', partnerId: session.partnerId };
}

function pickAssetUrl(movie: ExternalMovie, type: string): string {
  return movie.assets.find((asset) => asset.type === type && asset.url)?.url ?? '';
}

/**
 * Map a film from the external partner API to the Film the views already use.
 *
 * - `id` is the MUVI uuid: campaigns and every film route key on it.
 * - The trailer comes from `assets[type=trailer]`; `trailerUrl` is always "".
 * - `short` assets are NOT mapped. Whether a `short` is promotional material or
 *   the film itself is unconfirmed, and the full feature must never become a
 *   promotable asset (see the note in mapMediaAssets).
 */
export function mapExternalToFilm(movie: ExternalMovie): Film {
  const posterUrl = pickAssetUrl(movie, 'poster');
  const bannerUrl = pickAssetUrl(movie, 'banner');
  const trailerUrl = pickAssetUrl(movie, 'trailer');
  const mediaAssets: MediaAsset[] = [];

  if (posterUrl) {
    mediaAssets.push({
      id: `${movie.muviContentUuid}-poster`,
      type: 'image',
      name: 'Poster Oficial',
      url: posterUrl,
      thumbnailUrl: posterUrl,
    });
  }
  if (bannerUrl) {
    mediaAssets.push({
      id: `${movie.muviContentUuid}-banner`,
      type: 'image',
      name: 'Banner',
      url: bannerUrl,
      thumbnailUrl: bannerUrl,
    });
  }
  if (trailerUrl) {
    mediaAssets.push({
      id: `${movie.muviContentUuid}-trailer`,
      type: 'video',
      name: 'Trailer',
      url: trailerUrl,
      thumbnailUrl: posterUrl,
      downloadUrl: trailerUrl,
    });
  }

  return {
    id: movie.muviContentUuid,
    title: movie.internationalTitle || movie.originalTitle || 'Sin título',
    description: movie.description ?? '',
    duration: movie.duration ?? 0,
    year: movie.year ?? (movie.publishedAt ? new Date(movie.publishedAt).getFullYear() : new Date().getFullYear()),
    genre: movie.genre,
    director: movie.directors[0] ?? '',
    posterUrl,
    trailerUrl,
    rentalUrl: `https://pijamafilms.com/watch/${movie.muviContentUuid}`,
    // The API only lists published titles (each carries publishedAt).
    isPublished: true,
    campaigns: [],
    campaignCount: 0,
    mediaAssets,
  };
}

/**
 * The partner's catalogue. A partner Console does not know is an EMPTY list,
 * never the global catalogue; every other failure propagates.
 */
async function loadAtlasMovies(partnerId: string): Promise<ExternalMovie[]> {
  try {
    return (await fetchPartnerCatalogue(partnerId)).movies;
  } catch (error) {
    if (error instanceof AtlasCatalogError && error.code === 'partner_not_found') {
      log.warn({ partnerId }, 'Partner is unknown to the external API; empty catalogue');
      return [];
    }
    throw error;
  }
}

/** Campaigns on this film that belong to the given partner (document id). */
async function fetchCampaignsForPartnerFilm(
  filmMuviUuid: string,
  partnerDocId: string | null
): Promise<CampaignSummary[]> {
  if (!partnerDocId) return [];
  try {
    const campaigns = await getCampaignsByFilmMuviUuid(filmMuviUuid);
    return campaigns.filter((c) => c.partnerId === partnerDocId).map(mapCampaignToSummary);
  } catch (error) {
    log.error({ err: error, filmMuviUuid }, 'Failed to fetch campaigns for film');
    return [];
  }
}

async function partnerDocIdFor(partnerId: string): Promise<string | null> {
  const record = await getPartnerRecordByPartnerId(partnerId);
  return record?.id ?? null;
}

function titleOf(movie: ExternalMovie): string {
  return movie.internationalTitle || movie.originalTitle || '';
}

function sortAtlasMovies(movies: ExternalMovie[], sort?: FilmSortOption): ExternalMovie[] {
  const sorted = [...movies];
  const byDate = (m: ExternalMovie) => Date.parse(m.publishedAt ?? '') || 0;

  switch (sort) {
    case 'atoz':
      return sorted.sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
    case 'ztoa':
      return sorted.sort((a, b) => titleOf(b).localeCompare(titleOf(a)));
    case 'otn':
      return sorted.sort((a, b) => byDate(a) - byDate(b));
    case 'nto':
    default:
      return sorted.sort((a, b) => byDate(b) - byDate(a));
  }
}

async function getAtlasFilms(
  partnerId: string,
  page: number,
  limit: number,
  options: GetFilmsOptions,
  includeCampaigns: boolean
): Promise<GetFilmsResult> {
  let movies = await loadAtlasMovies(partnerId);

  const needle = options.search?.trim().toLowerCase();
  if (needle) {
    movies = movies.filter((m) =>
      [m.internationalTitle, m.originalTitle].some((t) => t?.toLowerCase().includes(needle))
    );
  }

  movies = sortAtlasMovies(movies, options.sort);

  const slice = movies.slice((page - 1) * limit, page * limit);
  const films = slice.map(mapExternalToFilm);

  if (includeCampaigns && films.length > 0) {
    const partnerDocId = await partnerDocIdFor(partnerId);
    await Promise.all(
      films.map(async (film) => {
        film.campaigns = await fetchCampaignsForPartnerFilm(film.id, partnerDocId);
        film.campaignCount = film.campaigns.length;
      })
    );
  }

  return {
    films,
    total: movies.length,
    pages: Math.ceil(movies.length / limit),
    currentPage: page,
  };
}

async function getAtlasFilmById(
  partnerId: string,
  id: string,
  includeCampaigns: boolean
): Promise<Film | undefined> {
  const movie = (await loadAtlasMovies(partnerId)).find((m) => m.muviContentUuid === id);

  if (!movie) return undefined;

  const film = mapExternalToFilm(movie);

  if (includeCampaigns) {
    film.campaigns = await fetchCampaignsForPartnerFilm(film.id, await partnerDocIdFor(partnerId));
    film.campaignCount = film.campaigns.length;
  }

  return film;
}

// ============================================================================
// PROMOTABILITY - can viewers actually watch this film?
// ============================================================================

/** What a producer reads when MUVI will not serve the film. Plain language, no jargon. */
export const FILM_NOT_AVAILABLE_MESSAGE =
  "This film isn't available to viewers yet, so we can't advertise it. Contact Pijama Films to fix it.";

/** What a producer reads when we could not find out. Different problem, different advice. */
export const FILM_CHECK_FAILED_MESSAGE =
  "We couldn't check that this film is available right now. Please try again in a few minutes.";

/** MUVI will not serve the film (blocked in our region, or no longer exists). */
export class FilmNotAvailableError extends Error {
  readonly reason: 'region' | 'gone';

  constructor(reason: 'region' | 'gone') {
    super(FILM_NOT_AVAILABLE_MESSAGE);
    this.name = 'FilmNotAvailableError';
    this.reason = reason;
  }
}

/** We could not tell: MUVI down, timing out, rejecting our credentials. NOT "blocked". */
export class FilmAvailabilityUnknownError extends Error {
  constructor() {
    super(FILM_CHECK_FAILED_MESSAGE);
    this.name = 'FilmAvailabilityUnknownError';
  }
}

/**
 * MUVI answers a region-blocked uuid with an API-level failure whose message
 * says so. Kept as one small matcher so it is the only thing to adjust if
 * MUVI rewords it. Matches the message only: an HTTP failure, a timeout or a
 * credential rejection carries no such text and must stay "unknown".
 */
function isRegionBlock(error: unknown): boolean {
  return (
    error instanceof MuviApiError && /not available in your region/i.test(error.message)
  );
}

/**
 * Throws unless MUVI will serve this film from the server's region.
 * Called when a campaign is created, so no ad money goes to a film that
 * viewers who click it cannot open.
 *
 * - served                          -> returns
 * - blocked by region / not found   -> FilmNotAvailableError
 * - anything else (outage, auth...) -> FilmAvailabilityUnknownError (fail-closed)
 */
export async function assertFilmPromotable(filmMuviUuid: string): Promise<void> {
  let movie: MuviMovieDetails | null;

  try {
    movie = await getMovieDetails(muvi, filmMuviUuid);
  } catch (error) {
    if (isRegionBlock(error)) {
      throw new FilmNotAvailableError('region');
    }
    log.error({ err: error, filmMuviUuid }, 'Could not verify film availability with MUVI');
    throw new FilmAvailabilityUnknownError();
  }

  if (!movie) {
    throw new FilmNotAvailableError('gone');
  }
}

// Results type for getFilms
export interface GetFilmsResult {
  films: Film[];
  total: number;
  pages: number;
  currentPage: number;
}

// Sort option accepted by the films list (maps directly to Muvi's sortBy)
export type FilmSortOption = NonNullable<GetMoviesOptions['sortBy']>;

// Options for filtering/sorting the films list
export type GetFilmsOptions = {
  search?: string;
  sort?: FilmSortOption;
};

/**
 * Get a paginated list of films from Muvi API
 * Optionally includes real campaign data from the database
 */
export async function getFilms(
  page: number = 1,
  limit: number = 12,
  options: GetFilmsOptions = {},
  includeCampaigns: boolean = true
): Promise<GetFilmsResult> {
  // Outside the try: an identity or configuration failure must surface as such.
  const source = await resolveCatalogueSource();

  if (source.kind === 'atlas') {
    return getAtlasFilms(source.partnerId, page, limit, options, includeCampaigns);
  }

  try {
    const { search, sort } = options;
    const result = await getMovies(muvi, {
      page,
      perPage: limit,
      ...(search ? { contentName: search } : {}),
      ...(sort ? { sortBy: sort } : {}),
    });

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
    log.error({ err: error }, 'Failed to fetch films from Muvi');
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
  const source = await resolveCatalogueSource();

  if (source.kind === 'atlas') {
    return getAtlasFilmById(source.partnerId, id, includeCampaigns);
  }

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
    log.error({ err: error, filmId: id }, 'Failed to fetch film from Muvi');
    throw error;
  }
}

/**
 * Aggregate campaign stats for ONE partner.
 *
 * `partnerDocId` is the partner's internal Firestore document id — the value
 * `campaign.partnerId` holds — not the external id carried on the session. A
 * caller holding a session gets there via `getPartnerRecordByPartnerId`.
 *
 * ## Why the argument is required
 *
 * This used to aggregate over the whole `campaigns` collection, so the KPI
 * header on /films and /campaigns reported every producer's combined
 * advertising budget and campaign counts to whoever happened to be logged in.
 * That is third-party commercial information, and it was visible to a partner
 * with no campaigns of their own.
 *
 * The argument is therefore mandatory, and an empty one throws rather than
 * defaulting: an optional partner whose absence means "all partners" is the
 * same defect with a parameter in front of it, and it would come back the first
 * time someone called this from a context where the partner was inconvenient
 * to obtain.
 *
 * Failure returns zeroes, never platform-wide figures — see the catch below.
 */
export async function getAggregateStats(partnerDocId: string) {
  // Outside the try on purpose. Inside, the catch below would turn a missing
  // partner id into a tidy set of zeroes, which reads as "this partner has no
  // campaigns" and would hide the very mistake this guard exists to catch.
  const validPartnerDocId = PartnerDocIdSchema.parse(partnerDocId);

  try {
    const campaigns = adminDb()
      .collection(COLLECTIONS.campaigns)
      .where('partnerId', '==', validPartnerDocId);

    // Server-side aggregations: these read index entries, not documents.
    // Both need the composite indexes on (partnerId, status[, budget]) declared
    // in firestore.indexes.json.
    const [published, active] = await Promise.all([
      campaigns
        .where('status', '!=', 'DRAFT')
        .aggregate({ budget: AggregateField.sum('budget'), count: AggregateField.count() })
        .get(),
      campaigns.where('status', '==', 'ACTIVE').count().get(),
    ]);

    return {
      totalBudget: published.data().budget || 0,
      totalCampaigns: published.data().count,
      activeCampaigns: active.data().count,
      // These will be populated from Meta Insights API when available
      totalSpend: 0,
      totalConversions: 0,
      totalImpressions: 0,
      costPerConversion: 0,
    };
  } catch (error) {
    log.error({ err: error, partnerDocId: validPartnerDocId }, 'Failed to get aggregate stats');

    // Zeroes, deliberately. A partner seeing 0 when the query failed is a
    // wrong number; a partner seeing the platform-wide totals would be a
    // disclosure. The fallback must never be the un-scoped figure.
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
    const snap = await adminDb().collection(COLLECTIONS.campaigns).get();

    const docs = snap.docs
      .map(docData)
      .filter((doc): doc is Record<string, unknown> => doc !== null)
      .sort((a, b) => {
        const left = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
        const right = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
        return right - left;
      });

    return (await withAds(docs)) as unknown as CampaignWithAds[];
  } catch (error) {
    log.error({ err: error }, 'Failed to get all campaigns');
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
    log.error({ err: error, filmId }, 'Failed to get ad copies for film');
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
    log.error({ err: error, filmId }, 'Failed to get all ad copies for film');
    return null;
  }
}
