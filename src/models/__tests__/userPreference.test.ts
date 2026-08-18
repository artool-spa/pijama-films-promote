import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMock = vi.fn();
const setMock = vi.fn();
const docMock = vi.fn();
const collectionMock = vi.fn();
const runTransactionMock = vi.fn();

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: () => ({
    collection: collectionMock,
    runTransaction: runTransactionMock,
  }),
}));

import { getUserPreference, dismissHowItWorks } from '../userPreference';

function snapshot(id: string, data: Record<string, unknown> | undefined) {
  return { id, data: () => data };
}

describe('models/userPreference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    docMock.mockReturnValue({ get: getMock, set: setMock });
    collectionMock.mockReturnValue({ doc: docMock });
    runTransactionMock.mockImplementation(
      async (fn: (tx: { get: typeof getMock; set: typeof setMock }) => unknown) =>
        fn({ get: getMock, set: setMock })
    );
  });

  describe('getUserPreference', () => {
    it('keys the document by email', async () => {
      getMock.mockResolvedValue(snapshot('user@example.com', undefined));

      await getUserPreference('user@example.com');

      expect(collectionMock).toHaveBeenCalledWith('userPreferences');
      expect(docMock).toHaveBeenCalledWith('user@example.com');
    });

    it('returns null when the user has no stored preference', async () => {
      getMock.mockResolvedValue(snapshot('user@example.com', undefined));

      expect(await getUserPreference('user@example.com')).toBeNull();
    });

    it('returns the stored preference', async () => {
      const when = new Date('2026-08-01T00:00:00.000Z');
      getMock.mockResolvedValue(
        snapshot('user@example.com', {
          email: 'user@example.com',
          howItWorksDismissed: true,
          createdAt: when,
          updatedAt: when,
        })
      );

      const result = await getUserPreference('user@example.com');

      expect(result).toEqual({
        id: 'user@example.com',
        email: 'user@example.com',
        howItWorksDismissed: true,
        createdAt: when,
        updatedAt: when,
      });
    });

    it('rejects a malformed email before touching Firestore', async () => {
      await expect(getUserPreference('not-an-email')).rejects.toThrow();
      expect(collectionMock).not.toHaveBeenCalled();
    });
  });

  describe('dismissHowItWorks', () => {
    it('creates the preference when none exists', async () => {
      getMock.mockResolvedValue(snapshot('user@example.com', undefined));

      const result = await dismissHowItWorks('user@example.com');

      expect(result.howItWorksDismissed).toBe(true);
      expect(setMock).toHaveBeenCalledTimes(1);
      expect(setMock.mock.calls[0][1]).toMatchObject({ howItWorksDismissed: true });
    });

    it('keeps the original creation time when dismissing again', async () => {
      const created = new Date('2026-01-01T00:00:00.000Z');
      getMock.mockResolvedValue(
        snapshot('user@example.com', {
          email: 'user@example.com',
          howItWorksDismissed: false,
          createdAt: created,
          updatedAt: created,
        })
      );

      const result = await dismissHowItWorks('user@example.com');

      expect(result.createdAt).toEqual(created);
      expect(result.updatedAt.getTime()).toBeGreaterThanOrEqual(created.getTime());
    });

    it('runs inside a transaction so a concurrent write cannot reset createdAt', async () => {
      getMock.mockResolvedValue(snapshot('user@example.com', undefined));

      await dismissHowItWorks('user@example.com');

      expect(runTransactionMock).toHaveBeenCalledTimes(1);
    });
  });
});
