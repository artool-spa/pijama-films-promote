/**
 * Regression guard: the full feature film must never become a promotable asset.
 *
 * A producer reported their entire movie showing up as a downloadable creative.
 * `mapMediaAssets` used to map `video_details` (the feature film) into a
 * MediaAsset alongside the poster, banner and trailer. Two exposure paths:
 *
 *   1. The asset carried a `downloadUrl` pointing at MUVI's direct file, and the
 *      asset card renders a download button.
 *   2. `uploadAdVideo` sends `file_url: <asset url>` to Meta, and Meta downloads
 *      the video from that URL, so selecting it as a creative uploads the whole
 *      feature film to Meta. The 500 MB cap only guards user uploads.
 *
 * `mapMediaAssets` is module-private, so this test drives it through the nearest
 * public entry point, `getFilmById`. `includeCampaigns: false` keeps Firestore
 * out of the picture.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MuviMovieDetails } from '#muvi';

const getMovieDetails = vi.fn();

vi.mock('#muvi', () => ({
  muvi: {},
  getMovies: vi.fn(),
  getMovieDetails: (...args: unknown[]) => getMovieDetails(...args),
}));

// Every URL below belongs to the feature film. None of them may reach an asset.
const FEATURE_FILM_URLS = {
  mpeg_path: 'https://muvi.example/feature/full-movie.mpd',
  file_url: 'https://muvi.example/feature/full-movie.mp4',
  hls_path: 'https://muvi.example/feature/full-movie.m3u8',
  third_party_url: 'https://muvi.example/feature/full-movie-third-party',
  encoded: 'https://muvi.example/feature/full-movie-1080p.mp4',
  offline: 'https://muvi.example/feature/full-movie-offline.mp4',
} as const;

const TRAILER_URL = 'https://muvi.example/trailer/trailer.mpd';
const TRAILER_DOWNLOAD_URL = 'https://muvi.example/trailer/trailer-1080p.mp4';

function buildMovie(): MuviMovieDetails {
  return {
    content_uuid: 'uuid-feature-film',
    content_name: 'La Película Completa',
    content_desc: 'A feature film that must not be advertised as an asset.',
    content_status: 2,
    posters: {
      website: [{ file_url: 'https://muvi.example/poster.jpg' }],
    },
    banners: {
      website: [{ file_url: 'https://muvi.example/banner.jpg' }],
    },
    // The trailer is legitimate promotional material and must survive.
    trailer_details: {
      mpeg_path: TRAILER_URL,
      encoded_url: [{ url: TRAILER_DOWNLOAD_URL }],
    },
    // The feature film. Every one of the four fallback sources in the old
    // `||` chain is populated, so no single source can slip through.
    video_details: {
      mpeg_path: FEATURE_FILM_URLS.mpeg_path,
      file_url: FEATURE_FILM_URLS.file_url,
      hls_path: FEATURE_FILM_URLS.hls_path,
      third_party_url: FEATURE_FILM_URLS.third_party_url,
      duration: '01:44:04',
      encoded_url: [{ url: FEATURE_FILM_URLS.encoded }],
      offline_url: [{ url: FEATURE_FILM_URLS.offline }],
    },
  } as MuviMovieDetails;
}

describe('film media assets — the feature film is never a promotable asset', () => {
  beforeEach(() => {
    getMovieDetails.mockReset();
    getMovieDetails.mockResolvedValue(buildMovie());
  });

  it('does not expose any feature-film URL as a media asset', async () => {
    const { getFilmById } = await import('@/models/film');
    const film = await getFilmById('uuid-feature-film', false);
    const assets = film?.mediaAssets ?? [];

    const featureUrls = new Set<string>(Object.values(FEATURE_FILM_URLS));
    const leaking = assets.filter(
      asset =>
        (asset.url && featureUrls.has(asset.url)) ||
        (asset.downloadUrl && featureUrls.has(asset.downloadUrl))
    );

    expect(
      leaking,
      `The full feature film was exposed as a promotable asset: ${leaking
        .map(a => `${a.name} -> url=${a.url} downloadUrl=${a.downloadUrl ?? 'none'}`)
        .join(', ')}. ` +
        'Anyone with access to the film page can download the producer\'s entire ' +
        'movie, and Meta downloads whatever URL it is given via file_url, so ' +
        'picking this asset as a creative uploads the full feature film to Meta.'
    ).toEqual([]);
  });

  it('exposes no video asset other than the trailer', async () => {
    const { getFilmById } = await import('@/models/film');
    const film = await getFilmById('uuid-feature-film', false);
    const videoAssets = (film?.mediaAssets ?? []).filter(a => a.type === 'video');

    expect(
      videoAssets.map(a => a.name),
      'A video asset other than the trailer reached the promotable set. Only the ' +
        'trailer is promotional material; anything else risks handing the full ' +
        'feature film to a downloader or to Meta via file_url.'
    ).toEqual(['Trailer']);
  });

  it('still exposes the trailer, poster and banner', async () => {
    const { getFilmById } = await import('@/models/film');
    const film = await getFilmById('uuid-feature-film', false);
    const assets = film?.mediaAssets ?? [];

    const trailer = assets.find(a => a.name === 'Trailer');
    expect(
      trailer,
      'The trailer disappeared from the promotable assets. The fix must remove ' +
        'the feature film only — the trailer is the legitimate creative.'
    ).toBeDefined();
    expect(trailer?.url).toBe(TRAILER_URL);
    expect(trailer?.downloadUrl).toBe(TRAILER_DOWNLOAD_URL);

    expect(assets.map(a => a.name).sort()).toEqual(['Banner', 'Poster Oficial', 'Trailer']);
  });
});
