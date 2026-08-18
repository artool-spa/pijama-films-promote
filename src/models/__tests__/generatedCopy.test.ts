import { describe, it, expect, vi, beforeEach } from 'vitest';

const whereMock = vi.fn();
const queryGetMock = vi.fn();
const docMock = vi.fn();
const docGetMock = vi.fn();
const collectionMock = vi.fn();
const getAllMock = vi.fn();
const batchSetMock = vi.fn();
const batchDeleteMock = vi.fn();
const batchCommitMock = vi.fn();

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: () => ({
    collection: collectionMock,
    getAll: getAllMock,
    batch: () => ({
      set: batchSetMock,
      delete: batchDeleteMock,
      commit: batchCommitMock,
    }),
  }),
}));

import {
  saveCopies,
  getCachedCopies,
  getCachedLanguages,
  invalidateCopies,
  getCopyVariant,
} from '../generatedCopy';

function snapshot(id: string, data: Record<string, unknown> | undefined) {
  return { id, data: () => data };
}

function storedCopy(language: string, variant: string, overrides: Record<string, unknown> = {}) {
  return snapshot(`film-1__${language}__${variant}`, {
    filmId: 'film-1',
    language,
    variant,
    headline: `headline-${language}-${variant}`,
    primaryText: 'body',
    description: '',
    callToAction: '',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

describe('models/generatedCopy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    whereMock.mockReturnValue({ get: queryGetMock });
    docMock.mockImplementation((id: string) => ({ id, get: docGetMock }));
    collectionMock.mockReturnValue({ where: whereMock, doc: docMock });
    queryGetMock.mockResolvedValue({ docs: [] });
    getAllMock.mockResolvedValue([]);
  });

  describe('saveCopies', () => {
    it('addresses each copy by its composite key', async () => {
      getAllMock.mockResolvedValue([snapshot('film-1__es__A', undefined)]);

      await saveCopies([
        {
          filmId: 'film-1',
          language: 'es',
          headline: 'Headline',
          primaryText: 'Body',
          variant: 'A',
        },
      ]);

      expect(docMock).toHaveBeenCalledWith('film-1__es__A');
      expect(batchCommitMock).toHaveBeenCalledTimes(1);
    });

    it('defaults the optional fields to empty strings', async () => {
      getAllMock.mockResolvedValue([snapshot('film-1__es__A', undefined)]);

      await saveCopies([
        {
          filmId: 'film-1',
          language: 'es',
          headline: 'Headline',
          primaryText: 'Body',
          variant: 'A',
        },
      ]);

      expect(batchSetMock.mock.calls[0][1]).toMatchObject({ description: '', callToAction: '' });
    });

    it('keeps the original creation time when a variant is regenerated', async () => {
      const created = new Date('2026-01-01T00:00:00.000Z');
      getAllMock.mockResolvedValue([storedCopy('es', 'A')]);

      await saveCopies([
        {
          filmId: 'film-1',
          language: 'es',
          headline: 'New headline',
          primaryText: 'New body',
          variant: 'A',
        },
      ]);

      expect(batchSetMock.mock.calls[0][1].createdAt).toEqual(created);
    });

    it('writes nothing when given no copies', async () => {
      await saveCopies([]);

      expect(getAllMock).not.toHaveBeenCalled();
      expect(batchCommitMock).not.toHaveBeenCalled();
    });
  });

  describe('getCachedCopies', () => {
    it('groups by language and ignores languages that were not asked for', async () => {
      queryGetMock.mockResolvedValue({
        docs: [storedCopy('es', 'A'), storedCopy('es', 'B'), storedCopy('en', 'A')],
      });

      const result = await getCachedCopies('film-1', ['es']);

      expect(Object.keys(result)).toEqual(['es']);
      expect(result.es).toHaveLength(2);
      expect(result.es.map((copy) => copy.variant)).toEqual(['A', 'B']);
    });

    it('queries by film', async () => {
      await getCachedCopies('film-1', ['es']);

      expect(collectionMock).toHaveBeenCalledWith('generatedCopies');
      expect(whereMock).toHaveBeenCalledWith('filmId', '==', 'film-1');
    });
  });

  describe('getCachedLanguages', () => {
    it('returns each language once', async () => {
      queryGetMock.mockResolvedValue({
        docs: [storedCopy('es', 'A'), storedCopy('es', 'B'), storedCopy('en', 'A')],
      });

      expect(await getCachedLanguages('film-1')).toEqual(['en', 'es']);
    });
  });

  describe('invalidateCopies', () => {
    it('deletes every copy of the film when no language is given', async () => {
      queryGetMock.mockResolvedValue({ docs: [storedCopy('es', 'A'), storedCopy('en', 'A')] });

      expect(await invalidateCopies('film-1')).toBe(2);
      expect(batchDeleteMock).toHaveBeenCalledTimes(2);
    });

    it('deletes only the requested languages', async () => {
      queryGetMock.mockResolvedValue({ docs: [storedCopy('es', 'A'), storedCopy('en', 'A')] });

      expect(await invalidateCopies('film-1', ['en'])).toBe(1);
      expect(batchDeleteMock).toHaveBeenCalledTimes(1);
      expect(docMock).toHaveBeenCalledWith('film-1__en__A');
    });

    it('does not commit an empty batch', async () => {
      queryGetMock.mockResolvedValue({ docs: [] });

      expect(await invalidateCopies('film-1')).toBe(0);
      expect(batchCommitMock).not.toHaveBeenCalled();
    });
  });

  describe('getCopyVariant', () => {
    it('returns null when the variant was never generated', async () => {
      docGetMock.mockResolvedValue(snapshot('film-1__es__A', undefined));

      expect(await getCopyVariant('film-1', 'es', 'A')).toBeNull();
    });

    it('returns the stored variant', async () => {
      docGetMock.mockResolvedValue(storedCopy('es', 'A'));

      const result = await getCopyVariant('film-1', 'es', 'A');

      expect(result).toMatchObject({ filmId: 'film-1', language: 'es', variant: 'A' });
    });
  });
});
