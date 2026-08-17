import { describe, it, expect } from 'vitest';
import { Timestamp, type DocumentSnapshot } from 'firebase-admin/firestore';
import { compositeId, docData, sanitize, createdTimestamps } from '../index';

function snapshot(id: string, data: Record<string, unknown> | undefined): DocumentSnapshot {
  return { id, data: () => data } as unknown as DocumentSnapshot;
}

describe('firestore/compositeId', () => {
  it('joins the parts into a single id', () => {
    expect(compositeId('film-1', 'es', 'A')).toBe('film-1__es__A');
  });

  it('escapes the path separator, which is illegal in a document id', () => {
    expect(compositeId('a/b', 'es', 'A')).not.toContain('/');
  });

  it('does not let different keys collide into the same id', () => {
    // Without escaping the underscore, ('a', 'b__c') and ('a__b', 'c') would
    // both produce "a__b__c" and one copy would silently overwrite the other.
    expect(compositeId('a', 'b__c')).not.toBe(compositeId('a__b', 'c'));
  });
});

describe('firestore/docData', () => {
  it('returns null for a document that does not exist', () => {
    expect(docData(snapshot('missing', undefined))).toBeNull();
  });

  it('merges the document id into the data', () => {
    expect(docData(snapshot('abc', { name: 'Film' }))).toEqual({ id: 'abc', name: 'Film' });
  });

  it('converts timestamps to dates, including nested ones', () => {
    const when = new Date('2026-08-17T12:00:00.000Z');

    const result = docData(
      snapshot('abc', {
        createdAt: Timestamp.fromDate(when),
        details: { seenAt: Timestamp.fromDate(when) },
        history: [{ at: Timestamp.fromDate(when) }],
      })
    );

    expect(result?.createdAt).toBeInstanceOf(Date);
    expect(result?.createdAt).toEqual(when);
    expect((result?.details as { seenAt: Date }).seenAt).toEqual(when);
    expect((result?.history as { at: Date }[])[0].at).toEqual(when);
  });
});

describe('firestore/sanitize', () => {
  it('drops undefined, which Firestore rejects', () => {
    expect(sanitize({ a: 1, b: undefined })).toEqual({ a: 1 });
  });

  it('keeps null, which means "explicitly empty"', () => {
    expect(sanitize({ a: null })).toEqual({ a: null });
  });

  it('recurses into nested objects', () => {
    expect(sanitize({ outer: { keep: 'x', drop: undefined } })).toEqual({ outer: { keep: 'x' } });
  });

  it('preserves dates instead of flattening them into plain objects', () => {
    const when = new Date('2026-08-17T12:00:00.000Z');
    expect(sanitize({ createdAt: when }).createdAt).toBe(when);
  });
});

describe('firestore/createdTimestamps', () => {
  it('stamps both fields with the same instant', () => {
    const { createdAt, updatedAt } = createdTimestamps();
    expect(createdAt).toEqual(updatedAt);
  });
});
