import { GeminiClient } from './client';
import {
  SupportedLanguage,
  GeneratedCopy,
  GeminiCopyResponseSchema,
  FilmDataForPrompt,
  Variant,
} from './types';
import { GeminiApiError, GeminiValidationError } from './errors';

// Hard character limits enforced on generated copy fields. The prompt asks the
// model to respect these, but LLMs count tokens (not characters) and routinely
// overshoot, so we also clamp the parsed output as the source of truth.
const FIELD_MAX_LENGTHS = {
  headline: 40,
  primaryText: 90,
  description: 90,
} as const;

/**
 * Truncate text to a maximum length, preferring a word boundary so copy does
 * not get cut mid-word. Falls back to a hard slice when a single word is longer
 * than the limit.
 */
function truncateAtWord(text: string, maxLength: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;

  const hardSlice = trimmed.slice(0, maxLength);
  const lastSpace = hardSlice.lastIndexOf(' ');
  // Only prefer the word boundary if it keeps a reasonable amount of text.
  if (lastSpace > maxLength * 0.6) {
    return hardSlice.slice(0, lastSpace).trim();
  }
  return hardSlice.trim();
}

// Language display names for prompts
const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  es: 'Spanish (Latin America)',
  en: 'English',
  pt: 'Portuguese (Brazil)',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese (Simplified)',
};

// Call-to-action options by language
const CTA_OPTIONS: Record<SupportedLanguage, string[]> = {
  es: ['Ver ahora', 'Alquilar', 'Descubrir', 'Ver trailer'],
  en: ['Watch Now', 'Rent', 'Discover', 'Watch Trailer'],
  pt: ['Assistir agora', 'Alugar', 'Descobrir', 'Ver trailer'],
  fr: ['Regarder maintenant', 'Louer', 'Découvrir', 'Voir la bande-annonce'],
  de: ['Jetzt ansehen', 'Mieten', 'Entdecken', 'Trailer ansehen'],
  it: ['Guarda ora', 'Noleggia', 'Scopri', 'Guarda il trailer'],
  ja: ['今すぐ見る', 'レンタル', '詳しく見る', '予告編を見る'],
  ko: ['지금 보기', '대여하기', '자세히 보기', '예고편 보기'],
  zh: ['立即观看', '租借', '了解更多', '观看预告片'],
};

/**
 * Build the prompt for generating marketing copies
 */
function buildPrompt(film: FilmDataForPrompt, language: SupportedLanguage): string {
  const langName = LANGUAGE_NAMES[language];
  const ctaOptions = CTA_OPTIONS[language].join(', ');
  const genres = film.genre.join(', ') || 'Drama';

  return `You are a marketing copywriter for a film streaming platform. Generate 3 unique ad copy variants (A, B, C) for the following film to be used in social media ads (Facebook/Instagram).

FILM DETAILS:
- Title: ${film.title}
- Description: ${film.description || 'No description available'}
- Genre: ${genres}
- Director: ${film.director || 'Unknown'}
- Year: ${film.year}
- Duration: ${film.duration} minutes

REQUIREMENTS:
- Language: ${langName}
- Each variant must have:
  * headline: Short, attention-grabbing (MAXIMUM 40 characters, including spaces)
  * primaryText: Main ad copy (MAXIMUM 90 characters, including spaces) and should mention watching on Pijama Films
  * description: Supporting text (MAXIMUM 90 characters, including spaces)
  * callToAction: One of: ${ctaOptions}
  * variant: "A", "B", or "C"

VARIANT GUIDELINES:
- Variant A: Focus on the emotional hook
- Variant B: Focus on the genre/category appeal
- Variant C: Focus on urgency/exclusivity

IMPORTANT:
- Write naturally and persuasively
- Avoid clichés and generic phrases
- Make the copy specific to this film
- Respect character limits strictly: count every character (including spaces). Text longer than the limit will be cut off, so keep each field within its maximum.

Respond ONLY with valid JSON in this exact format:
{
  "copies": [
    {
      "headline": "...",
      "primaryText": "...",
      "description": "...",
      "callToAction": "...",
      "variant": "A"
    },
    {
      "headline": "...",
      "primaryText": "...",
      "description": "...",
      "callToAction": "...",
      "variant": "B"
    },
    {
      "headline": "...",
      "primaryText": "...",
      "description": "...",
      "callToAction": "...",
      "variant": "C"
    }
  ]
}`;
}

/**
 * Parse and validate the Gemini response
 */
function parseGeminiResponse(responseText: string): GeneratedCopy[] {
  // Extract JSON from the response (handle markdown code blocks)
  let jsonStr = responseText.trim();

  // Remove markdown code blocks if present
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.slice(7);
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.slice(3);
  }
  if (jsonStr.endsWith('```')) {
    jsonStr = jsonStr.slice(0, -3);
  }
  jsonStr = jsonStr.trim();

  try {
    const parsed = JSON.parse(jsonStr);

    // Validate with Zod schema
    const result = GeminiCopyResponseSchema.safeParse(parsed);
    if (!result.success) {
      throw new GeminiValidationError(
        'Invalid response structure from Gemini',
        result.error.issues
      );
    }

    // Enforce character limits regardless of what the model returned
    return result.data.copies.map((copy) => ({
      ...copy,
      headline: truncateAtWord(copy.headline, FIELD_MAX_LENGTHS.headline),
      primaryText: truncateAtWord(copy.primaryText, FIELD_MAX_LENGTHS.primaryText),
      description: truncateAtWord(copy.description, FIELD_MAX_LENGTHS.description),
    }));
  } catch (error) {
    if (error instanceof GeminiValidationError) {
      throw error;
    }
    throw new GeminiValidationError(
      `Failed to parse Gemini response: ${error instanceof Error ? error.message : String(error)}`,
      { rawResponse: responseText.slice(0, 500) }
    );
  }
}

/**
 * Generate marketing copies for a film in a specific language
 */
export async function generateCopiesForLanguage(
  client: GeminiClient,
  film: FilmDataForPrompt,
  language: SupportedLanguage
): Promise<GeneratedCopy[]> {
  const prompt = buildPrompt(film, language);

  try {
    const responseText = await client.generateContent(prompt);
    return parseGeminiResponse(responseText);
  } catch (error) {
    if (error instanceof GeminiValidationError) {
      throw error;
    }
    throw new GeminiApiError(
      `Failed to generate copies for ${language}: ${error instanceof Error ? error.message : String(error)}`,
      {
        context: {
          filmId: film.id,
          language,
        },
      }
    );
  }
}

/**
 * Generate marketing copies for a film in multiple languages
 */
export async function generateCopiesForFilm(
  client: GeminiClient,
  film: FilmDataForPrompt,
  languages: SupportedLanguage[]
): Promise<Record<SupportedLanguage, GeneratedCopy[]>> {
  const results: Partial<Record<SupportedLanguage, GeneratedCopy[]>> = {};

  // Generate copies for each language sequentially to avoid rate limits
  for (const language of languages) {
    const copies = await generateCopiesForLanguage(client, film, language);
    results[language] = copies;
  }

  return results as Record<SupportedLanguage, GeneratedCopy[]>;
}

/**
 * Get a specific variant from generated copies
 */
export function getVariant(
  copies: GeneratedCopy[],
  variant: Variant
): GeneratedCopy | undefined {
  return copies.find((copy) => copy.variant === variant);
}
