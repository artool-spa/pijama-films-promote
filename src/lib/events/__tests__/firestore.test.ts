import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const addMock = vi.fn();
const setMock = vi.fn();
const collectionMock = vi.fn();
const docMock = vi.fn();

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    arrayUnion: (...values: string[]) => ({ __arrayUnion: values }),
  },
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: () => ({ collection: collectionMock }),
}));

import { publish, grantFilmEventAccess } from '../firestore';

describe('events/firestore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FIREBASE_PROJECT_ID = 'test-project';

    docMock.mockReturnValue({
      collection: () => ({ add: addMock }),
      set: setMock,
    });
    collectionMock.mockReturnValue({ doc: docMock });
  });

  afterEach(() => {
    delete process.env.FIREBASE_PROJECT_ID;
  });

  describe('publish', () => {
    it('writes the event under the film document', async () => {
      await publish('film-uuid-1', {
        type: 'image_validated',
        imageId: 'img-1',
        status: 'READY',
        errors: [],
        aspectRatio: '1:1',
      });

      expect(collectionMock).toHaveBeenCalledWith('filmEvents');
      expect(docMock).toHaveBeenCalledWith('film-uuid-1');

      const written = addMock.mock.calls[0][0];
      expect(written.type).toBe('image_validated');
      expect(written.imageId).toBe('img-1');
      expect(written.createdAt).toBe('SERVER_TIMESTAMP');
      expect(written.expiresAt).toBeInstanceOf(Date);
    });

    it('sets a future expiry so the TTL policy can reap the event', async () => {
      await publish('film-uuid-1', { type: 'heartbeat' });

      const { expiresAt } = addMock.mock.calls[0][0];
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('never throws when the write fails', async () => {
      addMock.mockRejectedValueOnce(new Error('firestore unavailable'));

      await expect(
        publish('film-uuid-1', { type: 'heartbeat' })
      ).resolves.toBeUndefined();
    });

    it('is a no-op when Firebase is not configured', async () => {
      delete process.env.FIREBASE_PROJECT_ID;

      await publish('film-uuid-1', { type: 'heartbeat' });

      expect(addMock).not.toHaveBeenCalled();
    });
  });

  describe('grantFilmEventAccess', () => {
    it('adds the partner to the allow list without clobbering others', async () => {
      await grantFilmEventAccess('film-uuid-1', 'pijamafilms');

      expect(docMock).toHaveBeenCalledWith('film-uuid-1');

      const [payload, options] = setMock.mock.calls[0];
      expect(payload.allowedPartnerIds).toEqual({
        __arrayUnion: ['pijamafilms'],
      });
      expect(options).toEqual({ merge: true });
    });

    it('never throws when the write fails', async () => {
      setMock.mockRejectedValueOnce(new Error('permission denied'));

      await expect(
        grantFilmEventAccess('film-uuid-1', 'pijamafilms')
      ).resolves.toBeUndefined();
    });
  });
});
