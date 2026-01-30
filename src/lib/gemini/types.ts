import { z } from 'zod';

// Supported languages for copy generation
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

// Copy generation request schema
export const CopyGenerationRequestSchema = z.object({
  filmId: z.string().min(1, 'filmId is required'),
  languages: z
    .array(SupportedLanguageSchema)
    .default(['es', 'en', 'pt'])
    .refine((arr) => arr.length > 0, 'At least one language is required'),
});

export type CopyGenerationRequest = z.infer<typeof CopyGenerationRequestSchema>;

// Variant schema
export const VariantSchema = z.enum(['A', 'B', 'C']);
export type Variant = z.infer<typeof VariantSchema>;

// Single generated copy schema
export const GeneratedCopySchema = z.object({
  headline: z.string().min(1),
  primaryText: z.string().min(1),
  description: z.string().min(1),
  callToAction: z.string().min(1),
  variant: VariantSchema,
});

export type GeneratedCopy = z.infer<typeof GeneratedCopySchema>;

// Response from Gemini (3 variants per language)
export const GeminiCopyResponseSchema = z.object({
  copies: z.array(GeneratedCopySchema).length(3),
});

export type GeminiCopyResponse = z.infer<typeof GeminiCopyResponseSchema>;

// Full API response with all languages
export interface CopyGenerationResponse {
  copies: {
    [language: string]: GeneratedCopy[];
  };
  cached: boolean;
}

// Film data needed for prompt generation (from MUVI API)
export interface FilmDataForPrompt {
  id: string;
  title: string;
  description: string;
  genre: string[];
  director: string;
  year: number;
  duration: number;
}

// Configuration schema
export const GeminiConfigSchema = z.object({
  serviceAccountKeyJson: z.string().min(1, 'GCS_SERVICE_ACCOUNT_KEY_JSON is required'),
});

export type GeminiConfig = z.infer<typeof GeminiConfigSchema>;
