/**
 * GeneratedCopy Model - Database operations for AI-generated marketing copies
 *
 * This model handles:
 * - Caching generated copies in the database
 * - Retrieving cached copies
 * - Invalidating cache when needed
 */

import prisma from '#prisma';
import { z } from 'zod';

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
  const copies = await prisma.generatedCopy.findMany({
    where: {
      filmId,
      language: { in: languages },
    },
    orderBy: [{ language: 'asc' }, { variant: 'asc' }],
  });

  // Group by language
  const result: Partial<Record<SupportedLanguage, GeneratedCopyData[]>> = {};

  for (const copy of copies) {
    const lang = copy.language as SupportedLanguage;
    if (!result[lang]) {
      result[lang] = [];
    }
    result[lang]!.push({
      filmId: copy.filmId,
      language: lang,
      headline: copy.headline,
      primaryText: copy.primaryText,
      description: copy.description,
      callToAction: copy.callToAction,
      variant: copy.variant as Variant,
    });
  }

  return result as Record<SupportedLanguage, GeneratedCopyData[]>;
}

/**
 * Check which languages have cached copies for a film
 */
export async function getCachedLanguages(
  filmId: string
): Promise<SupportedLanguage[]> {
  const copies = await prisma.generatedCopy.findMany({
    where: { filmId },
    select: { language: true },
    distinct: ['language'],
  });

  return copies.map((c) => c.language as SupportedLanguage);
}

/**
 * Save generated copies to the database
 * Uses upsert to handle re-generation
 */
export async function saveCopies(copies: GeneratedCopyData[]): Promise<void> {
  // Use transaction for atomicity
  await prisma.$transaction(
    copies.map((copy) =>
      prisma.generatedCopy.upsert({
        where: {
          filmId_language_variant: {
            filmId: copy.filmId,
            language: copy.language,
            variant: copy.variant,
          },
        },
        update: {
          headline: copy.headline,
          primaryText: copy.primaryText,
          // Columns are NOT NULL; default the optional fields when absent.
          description: copy.description ?? '',
          callToAction: copy.callToAction ?? '',
        },
        create: {
          filmId: copy.filmId,
          language: copy.language,
          headline: copy.headline,
          primaryText: copy.primaryText,
          description: copy.description ?? '',
          callToAction: copy.callToAction ?? '',
          variant: copy.variant,
        },
      })
    )
  );
}

/**
 * Invalidate (delete) cached copies for a film
 * Can optionally specify languages to invalidate
 */
export async function invalidateCopies(
  filmId: string,
  languages?: SupportedLanguage[]
): Promise<number> {
  const result = await prisma.generatedCopy.deleteMany({
    where: {
      filmId,
      ...(languages && { language: { in: languages } }),
    },
  });

  return result.count;
}

/**
 * Get a specific copy variant for a film and language
 */
export async function getCopyVariant(
  filmId: string,
  language: SupportedLanguage,
  variant: Variant
): Promise<GeneratedCopyData | null> {
  const copy = await prisma.generatedCopy.findUnique({
    where: {
      filmId_language_variant: {
        filmId,
        language,
        variant,
      },
    },
  });

  if (!copy) return null;

  return {
    filmId: copy.filmId,
    language: copy.language as SupportedLanguage,
    headline: copy.headline,
    primaryText: copy.primaryText,
    description: copy.description,
    callToAction: copy.callToAction,
    variant: copy.variant as Variant,
  };
}

/**
 * Get all copies for a film across all languages
 */
export async function getAllCopiesForFilm(
  filmId: string
): Promise<GeneratedCopyData[]> {
  const copies = await prisma.generatedCopy.findMany({
    where: { filmId },
    orderBy: [{ language: 'asc' }, { variant: 'asc' }],
  });

  return copies.map((copy) => ({
    filmId: copy.filmId,
    language: copy.language as SupportedLanguage,
    headline: copy.headline,
    primaryText: copy.primaryText,
    description: copy.description,
    callToAction: copy.callToAction,
    variant: copy.variant as Variant,
  }));
}
