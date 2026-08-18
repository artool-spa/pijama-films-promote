/**
 * GeneratedCopy Model - Firestore operations for AI-generated marketing copies
 *
 * This model handles:
 * - Caching generated copies in Firestore
 * - Retrieving cached copies
 * - Invalidating cache when needed
 *
 * The `(filmId, language, variant)` uniqueness that Postgres enforced with a
 * composite constraint is expressed here as the document id, so re-generating a
 * variant overwrites it instead of duplicating it.
 *
 * A film has at most `languages x variants` copies (a few dozen), so the
 * queries filter on `filmId` only and sort in memory. That keeps the collection
 * free of composite indexes without any practical cost.
 */

import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { COLLECTIONS, compositeId, docData, sanitize } from '@/lib/firestore';

// ============================================================================
// SCHEMAS
// ============================================================================

export const SupportedLanguageSchema = z.enum([
  'es', // Spanish (Latin America)
  'en', // English
  'pt', // Portuguese (Brazil)
  'fr', // French
  'de', // German
  'it', // Italian
  'ja', // Japanese
  'ko', // Korean
  'zh', // Chinese (Simplified)
]);
export type SupportedLanguage = z.infer<typeof SupportedLanguageSchema>;

export const VariantSchema = z.enum(['A', 'B', 'C', 'D', 'E', 'F']);
export type Variant = z.infer<typeof VariantSchema>;

// `description` and `callToAction` are optional: the generator no longer asks the
// model for them, and the ad pipeline hardcodes the call-to-action.
export const GeneratedCopyDataSchema = z.object({
  filmId: z.string().min(1),
  language: SupportedLanguageSchema,
  headline: z.string().min(1),
  primaryText: z.string().min(1),
  description: z.string().min(1).optional(),
  callToAction: z.string().min(1).optional(),
  variant: VariantSchema,
});

export type GeneratedCopyData = z.infer<typeof GeneratedCopyDataSchema>;

// Shape stored in Firestore, before the id is merged back in.
const StoredCopySchema = z.object({
  id: z.string(),
  filmId: z.string(),
  language: z.string(),
  headline: z.string(),
  primaryText: z.string(),
  description: z.string(),
  callToAction: z.string(),
  variant: z.string(),
  createdAt: z.coerce.date(),
});

type StoredCopy = z.infer<typeof StoredCopySchema>;

// ============================================================================
// HELPERS
// ============================================================================

function copies() {
  return adminDb().collection(COLLECTIONS.generatedCopies);
}

function copyId(filmId: string, language: string, variant: string): string {
  return compositeId(filmId, language, variant);
}

function toCopyData(stored: StoredCopy): GeneratedCopyData {
  return {
    filmId: stored.filmId,
    language: stored.language as SupportedLanguage,
    headline: stored.headline,
    primaryText: stored.primaryText,
    description: stored.description,
    callToAction: stored.callToAction,
    variant: stored.variant as Variant,
  };
}

// Reproduces the `orderBy: [{ language: 'asc' }, { variant: 'asc' }]` the
// Postgres queries used.
function byLanguageThenVariant(a: StoredCopy, b: StoredCopy): number {
  return a.language.localeCompare(b.language) || a.variant.localeCompare(b.variant);
}

async function copiesForFilm(filmId: string): Promise<StoredCopy[]> {
  const snap = await copies().where('filmId', '==', filmId).get();

  return snap.docs
    .map((doc) => StoredCopySchema.parse(docData(doc)))
    .sort(byLanguageThenVariant);
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

/**
 * Get cached copies for a film in specific languages
 * Returns copies grouped by language
 */
export async function getCachedCopies(
  filmId: string,
  languages: SupportedLanguage[]
): Promise<Record<SupportedLanguage, GeneratedCopyData[]>> {
  const wanted = new Set<string>(languages);
  const stored = (await copiesForFilm(filmId)).filter((copy) => wanted.has(copy.language));

  // Group by language
  const result: Partial<Record<SupportedLanguage, GeneratedCopyData[]>> = {};

  for (const copy of stored) {
    const lang = copy.language as SupportedLanguage;
    if (!result[lang]) {
      result[lang] = [];
    }
    result[lang]!.push(toCopyData(copy));
  }

  return result as Record<SupportedLanguage, GeneratedCopyData[]>;
}

/**
 * Check which languages have cached copies for a film
 */
export async function getCachedLanguages(filmId: string): Promise<SupportedLanguage[]> {
  const stored = await copiesForFilm(filmId);

  return [...new Set(stored.map((copy) => copy.language))] as SupportedLanguage[];
}

/**
 * Save generated copies to Firestore
 * Overwrites the matching variant to handle re-generation
 */
export async function saveCopies(copiesToSave: GeneratedCopyData[]): Promise<void> {
  if (copiesToSave.length === 0) return;

  const refs = copiesToSave.map((copy) =>
    copies().doc(copyId(copy.filmId, copy.language, copy.variant))
  );

  // Read first so an overwrite keeps the original creation time.
  const existing = await adminDb().getAll(...refs);

  // A single batch keeps the write atomic, as the Postgres transaction did.
  const batch = adminDb().batch();
  const now = new Date();

  copiesToSave.forEach((copy, index) => {
    const previous = docData(existing[index]);

    batch.set(
      refs[index],
      sanitize({
        filmId: copy.filmId,
        language: copy.language,
        headline: copy.headline,
        primaryText: copy.primaryText,
        // Stored as empty strings when absent, matching the NOT NULL columns
        // the rest of the app was written against.
        description: copy.description ?? '',
        callToAction: copy.callToAction ?? '',
        variant: copy.variant,
        createdAt: (previous?.createdAt as Date | undefined) ?? now,
      })
    );
  });

  await batch.commit();
}

/**
 * Invalidate (delete) cached copies for a film
 * Can optionally specify languages to invalidate
 */
export async function invalidateCopies(
  filmId: string,
  languages?: SupportedLanguage[]
): Promise<number> {
  const stored = await copiesForFilm(filmId);
  const wanted = languages ? new Set<string>(languages) : null;
  const doomed = wanted ? stored.filter((copy) => wanted.has(copy.language)) : stored;

  if (doomed.length === 0) return 0;

  const batch = adminDb().batch();
  for (const copy of doomed) {
    batch.delete(copies().doc(copy.id));
  }
  await batch.commit();

  return doomed.length;
}

/**
 * Get a specific copy variant for a film and language
 */
export async function getCopyVariant(
  filmId: string,
  language: SupportedLanguage,
  variant: Variant
): Promise<GeneratedCopyData | null> {
  const snap = await copies().doc(copyId(filmId, language, variant)).get();
  const data = docData(snap);

  if (!data) return null;

  return toCopyData(StoredCopySchema.parse(data));
}

/**
 * Get all copies for a film across all languages
 */
export async function getAllCopiesForFilm(filmId: string): Promise<GeneratedCopyData[]> {
  const stored = await copiesForFilm(filmId);

  return stored.map(toCopyData);
}
