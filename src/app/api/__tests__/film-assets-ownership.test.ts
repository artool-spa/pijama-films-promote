/**
 * Asset routes must act only on films in the SESSION's catalogue.
 *
 * Two Atlas partners (A, B). B names A's film or A's asset: 404, and nothing is
 * read, written, uploaded or deleted. A failing catalogue API is 503, never
 * access. Internal users keep the global catalogue (no Console call at all).
 *
 * Real: the film model, the film-access helper and every route. Faked at the
 * boundary: the session, the Console catalogue, the asset models, GCS.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/logger', () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { default: l, createLogger: () => l };
});
vi.mock('@/lib/firebase/admin', () => ({ adminDb: () => ({}) }));
vi.mock('#muvi', () => ({ muvi: {}, getMovies: vi.fn(), getMovieDetails: vi.fn(), MuviApiError: class extends Error {} }));
vi.mock('@/models/partner', () => ({ getPartnerRecordByPartnerId: vi.fn(async () => null) }));
vi.mock('@/models/campaign', () => ({ getCampaignsByFilmMuviUuid: vi.fn(async () => []) }));

type TestSession = { uid: string; partnerId: string } | null;
let session: TestSession = null;
vi.mock('@/lib/auth/session', () => ({ getSession: async () => session }));
vi.mock('@/lib/auth', () => ({
  getPartnerFromRequest: async () => (session ? { id: `doc-${session.partnerId}`, partnerId: session.partnerId } : null),
}));

const fetchPartnerCatalogue = vi.fn();
vi.mock('@/lib/atlas/external-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/atlas/external-api')>('@/lib/atlas/external-api');
  return { ...actual, fetchPartnerCatalogue: (...a: unknown[]) => fetchPartnerCatalogue(...a) };
});

const FILM_A = 'uuid-film-a';
const FILM_B = 'uuid-film-b';
const movie = (uuid: string) => ({
  _id: uuid, muviContentUuid: uuid, originalTitle: 'Same Title', genre: [], directors: [], cast: [], assets: [],
});
const CATALOGUES: Record<string, string[]> = { 'partner-a': [FILM_A], 'partner-b': [FILM_B] };

const writes = {
  updateImage: vi.fn(), deleteImage: vi.fn(), setImageArchived: vi.fn(), createImage: vi.fn(),
  updateVideo: vi.fn(), deleteVideo: vi.fn(), setVideoArchived: vi.fn(), createVideo: vi.fn(),
  deleteFile: vi.fn(), uploadImage: vi.fn(), uploadVideo: vi.fn(), revalidateAsset: vi.fn(),
  validateImageInBackground: vi.fn(), validateVideoInBackground: vi.fn(),
};
const reads = { listImages: vi.fn(), listVideos: vi.fn(), getImageById: vi.fn(), getVideoById: vi.fn() };

const asset = (id: string, film: string) => ({ id, filmMuviUuid: film, name: id, storageKey: 'k', url: 'https://x/y.png' });

vi.mock('@/models/image', () => ({
  getImageById: (...a: unknown[]) => reads.getImageById(...a),
  getImagesByFilmMuviUuid: (...a: unknown[]) => reads.listImages(...a),
  getImagesByFilmMuviUuidWithStatus: (...a: unknown[]) => reads.listImages(...a),
  updateImage: (...a: unknown[]) => writes.updateImage(...a),
  deleteImage: (...a: unknown[]) => writes.deleteImage(...a),
  setImageArchived: (...a: unknown[]) => writes.setImageArchived(...a),
  createImage: (...a: unknown[]) => writes.createImage(...a),
}));
vi.mock('@/models/video', () => ({
  getVideoById: (...a: unknown[]) => reads.getVideoById(...a),
  getVideosByFilmMuviUuid: (...a: unknown[]) => reads.listVideos(...a),
  getVideosByFilmMuviUuidWithStatus: (...a: unknown[]) => reads.listVideos(...a),
  updateVideo: (...a: unknown[]) => writes.updateVideo(...a),
  deleteVideo: (...a: unknown[]) => writes.deleteVideo(...a),
  setVideoArchived: (...a: unknown[]) => writes.setVideoArchived(...a),
  createVideo: (...a: unknown[]) => writes.createVideo(...a),
}));
vi.mock('@/lib/storage', () => ({
  deleteFile: (...a: unknown[]) => writes.deleteFile(...a),
  uploadImage: (...a: unknown[]) => writes.uploadImage(...a),
  uploadVideo: (...a: unknown[]) => writes.uploadVideo(...a),
  StorageValidationError: class extends Error {},
  StorageUploadError: class extends Error {},
}));
vi.mock('@/lib/assets', () => ({
  revalidateAsset: (...a: unknown[]) => writes.revalidateAsset(...a),
  validateImageInBackground: (...a: unknown[]) => writes.validateImageInBackground(...a),
  validateVideoInBackground: (...a: unknown[]) => writes.validateVideoInBackground(...a),
}));
vi.mock('sharp', () => ({ default: vi.fn(() => { throw new Error('sharp must not run'); }) }));

const imgList = await import('../films/[filmId]/images/route');
const imgOne = await import('../films/[filmId]/images/[id]/route');
const imgArch = await import('../films/[filmId]/images/[id]/archive/route');
const vidList = await import('../films/[filmId]/videos/route');
const vidOne = await import('../films/[filmId]/videos/[id]/route');
const vidArch = await import('../films/[filmId]/videos/[id]/archive/route');
const upImage = await import('../upload/image/route');
const upVideo = await import('../upload/video/route');
const revalidate = await import('../assets/[id]/revalidate/route');
const crop = await import('../assets/crop/route');

const url = 'http://localhost/api/x';
const json = (method: string, body?: unknown) =>
  new NextRequest(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
function upload(film: string): NextRequest {
  const fd = new FormData();
  fd.set('file', new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }));
  return new NextRequest(`${url}?filmMuviUuid=${film}&name=a`, { method: 'POST', body: fd });
}

type Case = { name: string; run: (film: string, id: string) => Promise<Response> };
const ctx = (film: string, id = 'asset-1') => ({ params: Promise.resolve({ filmId: film, id }) });
const CASES: Case[] = [
  { name: 'GET images list', run: (f) => imgList.GET(json('GET'), ctx(f)) },
  { name: 'GET image', run: (f, id) => imgOne.GET(json('GET'), ctx(f, id)) },
  { name: 'PATCH image', run: (f, id) => imgOne.PATCH(json('PATCH', { name: 'x' }), ctx(f, id)) },
  { name: 'DELETE image', run: (f, id) => imgOne.DELETE(json('DELETE'), ctx(f, id)) },
  { name: 'POST archive image', run: (f, id) => imgArch.POST(json('POST'), ctx(f, id)) },
  { name: 'DELETE archive image', run: (f, id) => imgArch.DELETE(json('DELETE'), ctx(f, id)) },
  { name: 'GET videos list', run: (f) => vidList.GET(json('GET'), ctx(f)) },
  { name: 'GET video', run: (f, id) => vidOne.GET(json('GET'), ctx(f, id)) },
  { name: 'PATCH video', run: (f, id) => vidOne.PATCH(json('PATCH', { name: 'x' }), ctx(f, id)) },
  { name: 'DELETE video', run: (f, id) => vidOne.DELETE(json('DELETE'), ctx(f, id)) },
  { name: 'POST archive video', run: (f, id) => vidArch.POST(json('POST'), ctx(f, id)) },
  { name: 'DELETE archive video', run: (f, id) => vidArch.DELETE(json('DELETE'), ctx(f, id)) },
  { name: 'POST upload image', run: (f) => upImage.POST(upload(f)) },
  { name: 'POST upload video', run: (f) => upVideo.POST(upload(f)) },
  {
    name: 'POST revalidate image',
    run: (f, id) => revalidate.POST(json('POST', { type: 'image', filmMuviUuid: f }), { params: Promise.resolve({ id }) }),
  },
  {
    name: 'POST revalidate video',
    run: (f, id) => revalidate.POST(json('POST', { type: 'video', filmMuviUuid: f }), { params: Promise.resolve({ id }) }),
  },
  {
    name: 'POST crop',
    run: (f, id) =>
      crop.POST(json('POST', { imageId: id, filmMuviUuid: f, crop: { x: 0, y: 0, width: 2000, height: 2000 }, targetAspectRatio: '1:1' })),
  },
];

// Past the ownership gate. Crop goes on to download the image, which we refuse
// (no network in tests); a 4xx/5xx other than the gate's own is fine there.
const PASSED_GATE = (status: number) => ![401, 404, 503].includes(status);

const writeSpies = () => [...Object.values(writes)];
const anyWrite = () => writeSpies().some((s) => s.mock.calls.length > 0);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
  session = { uid: 'atlas:partner-a', partnerId: 'partner-a' };
  fetchPartnerCatalogue.mockImplementation(async (partnerId: string) => ({
    partner: { partnerId, name: partnerId },
    movies: (CATALOGUES[partnerId] ?? []).map(movie),
  }));
  // Every asset exists, owned by film A, and is coherent with film A requests.
  reads.getImageById.mockImplementation(async (id: string) => asset(id, FILM_A));
  reads.getVideoById.mockImplementation(async (id: string) => asset(id, FILM_A));
  reads.listImages.mockResolvedValue([]);
  reads.listVideos.mockResolvedValue([]);
  for (const fn of [writes.updateImage, writes.setImageArchived, writes.updateVideo, writes.setVideoArchived]) {
    fn.mockResolvedValue(asset('asset-1', FILM_A));
  }
  writes.deleteImage.mockResolvedValue(asset('asset-1', FILM_A));
  writes.deleteVideo.mockResolvedValue(asset('asset-1', FILM_A));
  writes.uploadImage.mockResolvedValue({ storageKey: 'k', publicUrl: 'u', mimeType: 'image/png', size: 3 });
  writes.uploadVideo.mockResolvedValue({ storageKey: 'k', publicUrl: 'u', mimeType: 'video/mp4', size: 3 });
});

describe.each(CASES)('$name', ({ run }) => {
  it('answers 404 and touches nothing when B names A\'s film and asset', async () => {
    session = { uid: 'atlas:partner-b', partnerId: 'partner-b' };
    const res = await run(FILM_A, 'asset-1');
    expect(res.status).toBe(404);
    expect(anyWrite()).toBe(false);
    // Nothing about A's assets was even read.
    expect(reads.listImages).not.toHaveBeenCalled();
    expect(reads.listVideos).not.toHaveBeenCalled();
  });

  it('lets the owner through', async () => {
    const res = await run(FILM_A, 'asset-1');
    expect(PASSED_GATE(res.status)).toBe(true);
  });

  it('answers 401 without a session', async () => {
    session = null;
    const res = await run(FILM_A, 'asset-1');
    expect(res.status).toBe(401);
    expect(fetchPartnerCatalogue).not.toHaveBeenCalled();
    expect(anyWrite()).toBe(false);
  });

  it('answers 503 (not access) when the catalogue API is down', async () => {
    const { AtlasCatalogError } = await import('@/lib/atlas/external-api');
    fetchPartnerCatalogue.mockRejectedValue(new AtlasCatalogError('unavailable', 'down'));
    const res = await run(FILM_A, 'asset-1');
    expect(res.status).toBe(503);
    expect(anyWrite()).toBe(false);
  });

  it('answers 503 when the API key is missing', async () => {
    const { AtlasCatalogError } = await import('@/lib/atlas/external-api');
    fetchPartnerCatalogue.mockRejectedValue(new AtlasCatalogError('not_configured', 'no key'));
    expect((await run(FILM_A, 'asset-1')).status).toBe(503);
    expect(anyWrite()).toBe(false);
  });

  it('lets an internal user through without asking Console', async () => {
    session = { uid: 'firebase-uid-1', partnerId: 'pijamafilms' };
    const res = await run(FILM_A, 'asset-1');
    expect(PASSED_GATE(res.status)).toBe(true);
    expect(fetchPartnerCatalogue).not.toHaveBeenCalled();
  });
});

describe('by-asset-id routes use the STORED film, not the client claim', () => {
  it('revalidate: B claims its own film for A\'s asset -> 404, nothing revalidated', async () => {
    session = { uid: 'atlas:partner-b', partnerId: 'partner-b' };
    const res = await revalidate.POST(json('POST', { type: 'image', filmMuviUuid: FILM_B }), {
      params: Promise.resolve({ id: 'asset-of-a' }),
    });
    expect(res.status).toBe(404);
    expect(writes.revalidateAsset).not.toHaveBeenCalled();
  });

  it('crop: B claims its own film for A\'s image -> 404, no GCS upload', async () => {
    session = { uid: 'atlas:partner-b', partnerId: 'partner-b' };
    const res = await crop.POST(
      json('POST', { imageId: 'asset-of-a', filmMuviUuid: FILM_B, crop: { x: 0, y: 0, width: 2000, height: 2000 }, targetAspectRatio: '1:1' })
    );
    expect(res.status).toBe(404);
    expect(writes.uploadImage).not.toHaveBeenCalled();
    expect(writes.createImage).not.toHaveBeenCalled();
  });

  it('a stored film missing from the owner\'s catalogue is refused even if the claim matches', async () => {
    reads.getImageById.mockResolvedValue(asset('asset-1', 'uuid-not-in-catalogue'));
    const res = await revalidate.POST(json('POST', { type: 'image', filmMuviUuid: 'uuid-not-in-catalogue' }), {
      params: Promise.resolve({ id: 'asset-1' }),
    });
    expect(res.status).toBe(404);
    expect(writes.revalidateAsset).not.toHaveBeenCalled();
  });
});

describe('ownership is by exact uuid', () => {
  it('a same-title film with another uuid is not the owner\'s', async () => {
    // Both movies are titled "Same Title" (see movie()); only the uuid differs.
    session = { uid: 'atlas:partner-b', partnerId: 'partner-b' };
    expect((await imgList.GET(json('GET'), ctx(FILM_A))).status).toBe(404);
    expect((await imgList.GET(json('GET'), ctx(FILM_B))).status).toBe(200);
  });
});
