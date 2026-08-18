/**
 * Firestore data-access foundation (server-only).
 *
 * The model layer (src/models/*) talks to Firestore through these helpers so
 * that the Prisma-to-Firestore port does not leak into controllers or views:
 * every model keeps its exported signature and its Zod output schema.
 *
 * Three impedance mismatches are handled here, in one place:
 *
 * 1. Firestore returns `Timestamp`, the Zod schemas expect `Date`.
 * 2. Firestore rejects `undefined` in writes, while optional TypeScript fields
 *    produce it constantly. Prisma treated `undefined` as "leave alone".
 * 3. The document id lives outside the document data, so it has to be merged
 *    back in to reproduce the row shape the schemas validate.
 */

import { Timestamp, type DocumentSnapshot, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';

// ============================================================================
// COLLECTIONS
// ============================================================================

export const COLLECTIONS = {
  userPreferences: 'userPreferences',
  partners: 'partners',
  campaigns: 'campaigns',
  ads: 'ads',
  images: 'images',
  videos: 'videos',
  generatedCopies: 'generatedCopies',
  accounts: 'accounts',
  /** Subcollection of `accounts`. */
  transactions: 'transactions',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

export function collection(name: CollectionName) {
  return adminDb().collection(name);
}

// ============================================================================
// IDS
// ============================================================================

/**
 * Ids were cuids under Prisma and are Firestore auto-ids (or deterministic
 * composites) from here on, so the models validate "non-empty string" rather
 * than a specific format. Rows migrated from Postgres keep their cuid.
 */
export const IdSchema = z.string().min(1);

/**
 * Build a deterministic document id from its parts. Firestore has no unique
 * constraints, so a composite key is expressed as the id itself: writing the
 * same parts twice overwrites instead of duplicating.
 *
 * `/` is the only character forbidden in a document id; it is escaped rather
 * than dropped so two different keys cannot collide into one id.
 */
export function compositeId(...parts: string[]): string {
  return parts.map((part) => part.replace(/_/g, '__').replace(/\//g, '_s_')).join('__');
}

// ============================================================================
// READ CONVERSION
// ============================================================================

function convertValue(value: unknown): unknown {
  if (value instanceof Timestamp) {
    return value.toDate();
  }
  if (Array.isArray(value)) {
    return value.map(convertValue);
  }
  if (value !== null && typeof value === 'object' && value.constructor === Object) {
    return convertObject(value as Record<string, unknown>);
  }
  return value;
}

function convertObject(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = convertValue(value);
  }
  return out;
}

/**
 * Turn a snapshot into the plain object the Zod schemas validate: document data
 * with `Timestamp`s converted to `Date` and the document id merged in.
 *
 * Returns null for a missing document so callers can keep their
 * `if (!result) return null` shape.
 */
export function docData(
  snap: DocumentSnapshot | QueryDocumentSnapshot
): Record<string, unknown> | null {
  const data = snap.data();
  if (!data) return null;
  return { id: snap.id, ...convertObject(data) };
}

// ============================================================================
// WRITE CONVERSION
// ============================================================================

/**
 * Drop `undefined` recursively. Firestore rejects it outright, and the intent
 * at every call site is "this field was not provided", which for a partial
 * update means "leave it alone" — exactly what omitting the key does.
 *
 * `null` is preserved: the schemas use it for "explicitly empty".
 */
export function sanitize<T extends Record<string, unknown>>(data: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      out[key] = value.filter((item) => item !== undefined);
      continue;
    }
    if (value !== null && typeof value === 'object' && value.constructor === Object) {
      out[key] = sanitize(value as Record<string, unknown>);
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Timestamps for a freshly created document.
 *
 * Deliberately a client-side `Date` rather than `FieldValue.serverTimestamp()`:
 * the models return the written entity without re-reading it, and a sentinel
 * value cannot be returned or validated. Prisma's `now()` had the same
 * property — the value came from the process issuing the write.
 */
export function createdTimestamps(now: Date = new Date()): { createdAt: Date; updatedAt: Date } {
  return { createdAt: now, updatedAt: now };
}
