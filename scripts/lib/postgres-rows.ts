/**
 * Postgres row -> Firestore document transforms.
 *
 * Pure functions, no I/O: `scripts/firestore-import.ts` supplies the rows and
 * performs the writes, and `scripts/__tests__/postgres-rows.test.ts` exercises
 * every transform against fixtures without a database.
 *
 * Two decisions shape everything here.
 *
 * 1. **Ids are preserved.** A row keeps its cuid as the document id, which is
 *    what `src/lib/firestore/index.ts` documents ("Rows migrated from Postgres
 *    keep their cuid"). Every foreign key is therefore already a valid document
 *    id and needs no rewriting — with two exceptions, both noted below.
 *
 * 2. **Every column the read schemas require is written explicitly.** Postgres
 *    filled defaults on insert; Firestore stores exactly what it is handed, so
 *    a missing field turns into a validation error on the next read rather than
 *    a default. The row schemas below therefore mirror the *table*, and the
 *    transforms mirror the model's `createDefaults()`.
 */

import { z } from 'zod';

// ============================================================================
// SCALARS
// ============================================================================

/**
 * Prisma maps `DateTime` to `timestamp(3)` — no time zone — and writes UTC into
 * it. `row_to_json` renders that as `2026-02-01T14:14:31.431`, which `new Date`
 * would read as *local* time, silently shifting every timestamp by the offset
 * of whoever runs the import. Appending `Z` when no offset is present pins the
 * value to the UTC it was stored as.
 */
export function pgDate(value: string | Date): Date {
  if (value instanceof Date) return value;

  const hasOffset = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(value);
  const parsed = new Date(hasOffset ? value : `${value}Z`);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Not a timestamp: ${value}`);
  }

  return parsed;
}

const Timestamp = z.union([z.string(), z.date()]).transform(pgDate);
const NullableTimestamp = z
  .union([z.string(), z.date()])
  .nullable()
  .transform((value) => (value === null ? null : pgDate(value)));

/**
 * Firestore stores no `undefined` and no nested arrays. JSON columns
 * (`draftFormState`, `rejectionDetails`, `lastSyncErrorDetails`) hold whatever
 * the application put there, so they are checked rather than trusted: a value
 * Firestore would reject is reported against its row instead of failing the
 * whole batch with a stack trace from deep inside the SDK.
 */
export function findNestedArray(value: unknown, path = ''): string | null {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      if (Array.isArray(item)) return `${path}[${index}]`;
      const nested = findNestedArray(item, `${path}[${index}]`);
      if (nested) return nested;
    }
    return null;
  }

  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const nested = findNestedArray(item, path ? `${path}.${key}` : key);
      if (nested) return nested;
    }
  }

  return null;
}

const Json = z.unknown().nullable().transform((value) => value ?? null);

/**
 * Deterministic document id for a composite key.
 *
 * Duplicated from `src/lib/firestore/index.ts` because the scripts run under
 * tsx without the `@/` alias, and importing the real module would pull in the
 * Admin SDK singleton. `postgres-rows.test.ts` imports both and asserts they
 * agree, so the copy cannot drift.
 */
export function compositeId(...parts: string[]): string {
  return parts.map((part) => part.replace(/_/g, '__').replace(/\//g, '_s_')).join('__');
}

// ============================================================================
// ROW SCHEMAS
// ============================================================================

const Id = z.string().min(1);

export const UserPreferenceRow = z.object({
  id: Id,
  email: z.string().email(),
  howItWorksDismissed: z.boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export const PartnerRow = z.object({
  id: Id,
  partnerId: z.string().min(1),
  name: z.string(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export const CampaignRow = z.object({
  id: Id,
  platforms: z.array(z.string()),
  metaCampaignId: z.string().nullable(),
  imageAdSetId: z.string().nullable(),
  videoAdSetId: z.string().nullable(),
  googleCampaignId: z.string().nullable(),
  googleAdGroupId: z.string().nullable(),
  googleEntityStatus: z.string().nullable(),
  googleBidStrategy: z.string().nullable(),
  targetCpvMicros: z.union([z.number(), z.string()]).nullable(),
  name: z.string(),
  status: z.string(),
  objective: z.string(),
  budget: z.number(),
  budgetType: z.string(),
  startDate: Timestamp,
  endDate: NullableTimestamp,
  language: z.string(),
  targetCountries: z.array(z.string()),
  targetAgeMin: z.number().int(),
  targetAgeMax: z.number().int(),
  targetGenders: z.array(z.number().int()),
  includeBaseAudiences: z.boolean(),
  filmGenres: z.array(z.string()),
  includeLgbtAudience: z.boolean(),
  pixelId: z.string().nullable(),
  conversionEvent: z.string(),
  optimizationGoal: z.string(),
  billingEvent: z.string(),
  bidStrategy: z.string(),
  filmMuviUuid: z.string(),
  partnerId: Id,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  syncedAt: NullableTimestamp,
  draftFormState: Json,
  approvalSummary: z.string().nullable(),
  lastSyncError: z.string().nullable(),
  lastSyncErrorAt: NullableTimestamp,
  lastSyncErrorDetails: Json,
});

export const AdRow = z.object({
  id: Id,
  metaAdId: z.string().nullable(),
  googleAdId: z.string().nullable(),
  youtubeAdFormat: z.string().nullable(),
  name: z.string(),
  status: z.string(),
  adSetType: z.string(),
  headlines: z.array(z.string()),
  bodies: z.array(z.string()),
  descriptions: z.array(z.string()),
  callToAction: z.string(),
  linkUrl: z.string(),
  campaignId: Id,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  syncedAt: NullableTimestamp,
  approvalStatus: z.string(),
  approvalCheckedAt: NullableTimestamp,
  rejectionReason: z.string().nullable(),
  rejectionDetails: Json,
  suggestedCorrection: z.string().nullable(),
  reviewSeenAt: NullableTimestamp,
});

export const ImageRow = z.object({
  id: Id,
  filmMuviUuid: z.string(),
  name: z.string(),
  originalUrl: z.string(),
  storageKey: z.string(),
  url: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  archived: z.boolean(),
  createdAt: Timestamp,
  status: z.string(),
  validatedAt: NullableTimestamp,
  validationError: z.string().nullable(),
  aspectRatio: z.string().nullable(),
  metaImageHash: z.string().nullable(),
  facebookEligible: z.boolean(),
  instagramEligible: z.boolean(),
  googleEligible: z.boolean(),
  eligibilityError: z.string().nullable(),
});

export const VideoRow = z.object({
  id: Id,
  filmMuviUuid: z.string(),
  name: z.string(),
  originalUrl: z.string(),
  storageKey: z.string(),
  url: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
  duration: z.number().int().nullable(),
  thumbnailUrl: z.string().nullable(),
  metaVideoId: z.string().nullable(),
  archived: z.boolean(),
  createdAt: Timestamp,
  status: z.string(),
  validatedAt: NullableTimestamp,
  validationError: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  aspectRatio: z.string().nullable(),
  facebookEligible: z.boolean(),
  instagramEligible: z.boolean(),
  youtubeEligible: z.boolean(),
  youtubeVideoId: z.string().nullable(),
  eligibilityError: z.string().nullable(),
});

export const GeneratedCopyRow = z.object({
  id: Id,
  filmId: z.string().min(1),
  language: z.string(),
  headline: z.string(),
  primaryText: z.string(),
  description: z.string(),
  callToAction: z.string(),
  variant: z.string(),
  createdAt: Timestamp,
});

export const AccountRow = z.object({
  id: Id,
  partnerId: Id,
  balance: z.number(),
  currency: z.string(),
  stripeCustomerId: z.string().nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export const AccountTransactionRow = z.object({
  id: Id,
  accountId: Id,
  type: z.string(),
  status: z.string(),
  amount: z.number(),
  balanceAfter: z.number(),
  description: z.string(),
  stripeFee: z.number().nullable(),
  grossAmount: z.number().nullable(),
  stripeSessionId: z.string().nullable(),
  stripePaymentIntentId: z.string().nullable(),
  campaignId: z.string().nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

/** Prisma's implicit m2m table: `A` is the Ad id, `B` the Image/Video id. */
export const RelationRow = z.object({ A: Id, B: Id });

export type AdRowData = z.infer<typeof AdRow>;
export type AccountRowData = z.infer<typeof AccountRow>;
export type RelationRowData = z.infer<typeof RelationRow>;

// ============================================================================
// TRANSFORMS
// ============================================================================

export interface Document {
  id: string;
  data: Record<string, unknown>;
}

export function userPreferenceDoc(row: z.infer<typeof UserPreferenceRow>): Document {
  // The email is the document id, as it was the unique key in Postgres.
  return {
    id: row.email,
    data: {
      email: row.email,
      howItWorksDismissed: row.howItWorksDismissed,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  };
}

export function partnerDoc(row: z.infer<typeof PartnerRow>): Document {
  return {
    id: row.id,
    data: {
      partnerId: row.partnerId,
      name: row.name,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  };
}

export function campaignDoc(row: z.infer<typeof CampaignRow>): Document {
  const { id, targetCpvMicros, ...rest } = row;

  return {
    id,
    data: {
      ...rest,
      // Firestore has no BigInt. Micros of currency stay far below 2^53, and
      // `CampaignSchema` coerces the number back to a bigint on read.
      targetCpvMicros: targetCpvMicros === null ? null : Number(targetCpvMicros),
    },
  };
}

/**
 * The `_AdImages` / `_AdVideos` join rows become `imageIds` / `videoIds` arrays
 * on the ad, which is how `src/models/hydrate.ts` resolves media.
 */
export function adDoc(
  row: AdRowData,
  imageIds: string[] = [],
  videoIds: string[] = []
): Document {
  const { id, ...rest } = row;

  return { id, data: { ...rest, imageIds, videoIds } };
}

export function imageDoc(row: z.infer<typeof ImageRow>): Document {
  const { id, ...rest } = row;
  return { id, data: rest };
}

export function videoDoc(row: z.infer<typeof VideoRow>): Document {
  const { id, ...rest } = row;
  return { id, data: rest };
}

/**
 * The `(filmId, language, variant)` unique constraint became the document id,
 * so the cuid is dropped: the model looks copies up by the composite id and
 * would never find a document stored under the old key.
 */
export function generatedCopyDoc(row: z.infer<typeof GeneratedCopyRow>): Document {
  const { id: _cuid, ...rest } = row;

  return {
    id: compositeId(row.filmId, row.language, row.variant),
    data: rest,
  };
}

/**
 * `accounts/{partnerId}` — the account document id is the partner id, which is
 * one of the two places a foreign key is rewritten. Postgres kept a separate
 * cuid for the account and a unique `partnerId` column; the id now carries the
 * constraint, and every model lookup is a direct read.
 */
export function accountDoc(row: AccountRowData): Document {
  return {
    id: row.partnerId,
    data: {
      partnerId: row.partnerId,
      balance: row.balance,
      currency: row.currency,
      stripeCustomerId: row.stripeCustomerId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  };
}

/**
 * The second rewrite: a ledger entry's `accountId` pointed at the account cuid,
 * and the model now writes the partner id there (see `newTransaction` in
 * src/models/account.ts). `accountPartnerId` maps the old value to the new one.
 */
export function transactionDoc(
  row: z.infer<typeof AccountTransactionRow>,
  accountPartnerId: string
): Document {
  const { id, ...rest } = row;

  return {
    id,
    // The entry lives at accounts/{accountPartnerId}/transactions/{id}; the
    // parent path is applied by the importer.
    data: { ...rest, accountId: accountPartnerId },
  };
}

/** Group join rows by ad id, preserving a stable order. */
export function groupRelations(rows: RelationRowData[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();

  for (const row of rows) {
    const existing = grouped.get(row.A);
    if (existing) {
      existing.push(row.B);
    } else {
      grouped.set(row.A, [row.B]);
    }
  }

  for (const ids of grouped.values()) ids.sort();

  return grouped;
}
