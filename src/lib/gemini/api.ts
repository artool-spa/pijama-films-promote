import { GeminiClient } from './client';
import {
  SupportedLanguage,
  GeneratedCopy,
  GeminiCopyResponseSchema,
  FilmDataForPrompt,
} from './types';
import { GeminiApiError, GeminiValidationError } from './errors';

// Hard character limits enforced on generated copy fields. The prompt asks the
// model to respect these, but LLMs count tokens (not characters) and routinely
// overshoot, so we also clamp the parsed output as the source of truth.
const FIELD_MAX_LENGTHS = {
  headline: 40,
  primaryText: 90,
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

// ---------------------------------------------------------------------------
// Variant creative angles
// ---------------------------------------------------------------------------
// Tight character limits leave little room for creativity, so instead of always
// using the same three angles we keep a larger pool and randomly sample a fresh,
// distinct angle per variant on every generation. This makes regenerating an ad
// yield visibly different options each time.

interface VariantAngle {
  key: string;
  guideline: string;
}

const VARIANT_ANGLE_POOL: readonly VariantAngle[] = [
  { key: 'emotional', guideline: 'Emotional hook — lead with the feeling the film leaves you with and the personal stakes at its heart.' },
  { key: 'genre', guideline: 'Genre/fan appeal — lean into the tropes and thrills that fans of this genre are actively looking for.' },
  { key: 'urgency', guideline: 'Urgency/exclusivity — make it feel like a can\'t-miss title available to watch right now.' },
  { key: 'curiosity', guideline: 'Curiosity gap — open an intriguing question or hint at a mystery that makes people need to know more.' },
  { key: 'character', guideline: 'Character & conflict — spotlight the protagonist and the central dilemma that drives the story.' },
  { key: 'acclaim', guideline: 'Critical acclaim / social proof — frame it around praise, awards, or the buzz it is generating.' },
  { key: 'atmosphere', guideline: 'Mood & atmosphere — evoke the visual tone, cinematography, and the world the film pulls you into.' },
  { key: 'auteur', guideline: 'Auteur/director angle — position it around the vision and signature style of its director.' },
  { key: 'theme', guideline: 'Timely theme — connect the film to what it is really about and why it resonates now.' },
  { key: 'tension', guideline: 'Stakes & tension — build suspense around what is at risk and the moment everything could unravel.' },
  { key: 'setting', guideline: 'Setting & era — sell the time, place, and atmosphere the film transports the viewer to.' },
  { key: 'contrast', guideline: 'Unexpected contrast — surprise with a twist or juxtaposition the audience will not see coming.' },
];

// Labels assigned to variants in order. The campaign UI only renders A/B/C, so
// the default count stays at 3, but the library supports up to six.
const VARIANT_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
const DEFAULT_VARIANT_COUNT = 3;
const MAX_VARIANT_COUNT = VARIANT_LABELS.length;

/** Options controlling how copies are generated. */
export interface GenerateCopiesOptions {
  /** How many variants to generate. Clamped to [1, MAX_VARIANT_COUNT]. Defaults to 3. */
  variantCount?: number;
}

/** Clamp a requested variant count into the supported range. */
function resolveVariantCount(requested?: number): number {
  const count = requested ?? DEFAULT_VARIANT_COUNT;
  if (!Number.isFinite(count)) return DEFAULT_VARIANT_COUNT;
  return Math.max(1, Math.min(MAX_VARIANT_COUNT, Math.floor(count)));
}

/**
 * Randomly select `count` distinct creative angles from the pool. Uses a
 * Fisher–Yates shuffle so every angle has an equal chance of being picked.
 */
export function pickVariantAngles(count: number): VariantAngle[] {
  const resolved = Math.max(1, Math.min(VARIANT_ANGLE_POOL.length, Math.floor(count)));
  const pool = [...VARIANT_ANGLE_POOL];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, resolved);
}

/**
 * Build the prompt for generating marketing copies. Each requested variant is
 * assigned a distinct, randomly-sampled creative angle.
 */
function buildPrompt(
  film: FilmDataForPrompt,
  language: SupportedLanguage,
  angles: VariantAngle[]
): string {
  const langName = LANGUAGE_NAMES[language];
  const genres = film.genre.join(', ') || 'Drama';

  const variantCount = angles.length;
  const labels = VARIANT_LABELS.slice(0, variantCount);

  const guidelineLines = angles
    .map((angle, i) => `- Variant ${labels[i]}: ${angle.guideline}`)
    .join('\n');

  return `You are a marketing copywriter for a film streaming platform. Generate ${variantCount} unique ad copy variants (${labels.join(', ')}) for the following film to be used in social media ads (Facebook/Instagram).

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
  * headline: Short, attention-grabbing (MAXIMUM 32 characters, including spaces)
  * primaryText: Main ad copy (MAXIMUM 80 characters, including spaces) and should mention watching on Pijama Films
  * variant: ${labels.map((l) => `"${l}"`).join(', ')}

VARIANT GUIDELINES (each variant takes a different creative angle):
${guidelineLines}

IMPORTANT:
- Write naturally and persuasively
- Make each variant distinct from the others, following its assigned angle
- Avoid clichés and generic phrases
- Make the copy specific to this film
- Keep every field within its limit by writing short and tight. Do not count characters one by one — that wastes the response budget, and anything over the limit is trimmed automatically.

Return one entry per variant (${labels.join(', ')}) in the required JSON format.`;
}

/**
 * Build the Vertex-flavoured JSON schema the model must conform to. Putting the
 * model in JSON mode is what guarantees a parseable body: no markdown fences,
 * no preamble, no trailing commentary.
 */
function buildResponseSchema(labels: readonly string[]): Record<string, unknown> {
  return {
    type: 'OBJECT',
    properties: {
      copies: {
        type: 'ARRAY',
        minItems: labels.length,
        maxItems: labels.length,
        items: {
          type: 'OBJECT',
          properties: {
            headline: { type: 'STRING' },
            primaryText: { type: 'STRING' },
            variant: { type: 'STRING', enum: [...labels] },
          },
          required: ['headline', 'primaryText', 'variant'],
        },
      },
    },
    required: ['copies'],
  };
}

/**
 * Parse and validate the Gemini response
 */
function parseGeminiResponse(
  responseText: string,
  expectedCount: number
): GeneratedCopy[] {
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

    // Enforce character limits regardless of what the model returned, and cap to
    // the number of variants we asked for in case the model overshoots.
    return result.data.copies.slice(0, expectedCount).map((copy) => ({
      ...copy,
      headline: truncateAtWord(copy.headline, FIELD_MAX_LENGTHS.headline),
      primaryText: truncateAtWord(copy.primaryText, FIELD_MAX_LENGTHS.primaryText),
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
  language: SupportedLanguage,
  options?: GenerateCopiesOptions
): Promise<GeneratedCopy[]> {
  const variantCount = resolveVariantCount(options?.variantCount);
  const angles = pickVariantAngles(variantCount);
  const prompt = buildPrompt(film, language, angles);
  const responseSchema = buildResponseSchema(VARIANT_LABELS.slice(0, variantCount));

  try {
    const responseText = await client.generateContent(prompt, { responseSchema });
    return parseGeminiResponse(responseText, variantCount);
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
  languages: SupportedLanguage[],
  options?: GenerateCopiesOptions
): Promise<Record<SupportedLanguage, GeneratedCopy[]>> {
  const results: Partial<Record<SupportedLanguage, GeneratedCopy[]>> = {};

  // Generate copies for each language sequentially to avoid rate limits
  for (const language of languages) {
    const copies = await generateCopiesForLanguage(client, film, language, options);
    results[language] = copies;
  }

  return results as Record<SupportedLanguage, GeneratedCopy[]>;
}
