/**
 * SYNTHETIC fixtures for the external partner API. Shapes follow what the API
 * really returns (measured 2026-10-15), including its deviations from the docs;
 * every name, title and id is invented.
 */

export const PARTNER_A_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
export const PARTNER_B_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';

export function movieFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: '111111111111111111111111',
    muviContentUuid: 'uuid-film-a1',
    originalTitle: 'The Synthetic Garden',
    internationalTitle: 'The Synthetic Garden',
    description: 'A made-up story used only by tests.',
    // The docs say string[]; the API sends a string.
    genre: 'Drama',
    year: 2026,
    duration: 94,
    // May be "".
    language: '',
    ageRating: 'ATP',
    price: 3.99,
    // Always "" in practice: the real trailer lives in `assets`.
    trailerUrl: '',
    directors: ['Dana Director'],
    // May be empty.
    cast: [],
    publishedAt: '2026-03-11T13:46:54.811Z',
    updatedAt: '2026-03-11T13:46:54.811Z',
    assets: [
      // The docs say duration is a number; the API sends "HH:MM:SS" or null.
      { type: 'trailer', key: null, url: 'https://cdn.example/a1/trailer.mp4', width: null, height: null, duration: '00:01:10' },
      { type: 'poster', key: null, url: 'https://cdn.example/a1/poster.jpg', width: null, height: null, duration: null },
      { type: 'banner', key: 'web', url: 'https://cdn.example/a1/banner.jpg', width: 1920, height: 1080, duration: null },
      { type: 'short', key: null, url: 'https://cdn.example/a1/short.mp4', width: null, height: null, duration: '00:00:30' },
    ],
    ...overrides,
  };
}

export function catalogueFixture(
  partnerId: string,
  movies: Array<Record<string, unknown>>,
  partner: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    status: 'ok',
    data: {
      // `productionCompany` is absent for some partners: omitted here on purpose.
      partner: { partnerId, name: `Partner ${partnerId.slice(0, 1)}`, ...partner },
      movies,
    },
  };
}
