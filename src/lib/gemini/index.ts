import { GeminiClient } from './client';
import { GeminiConfigError } from './errors';

// Declare global type for singleton pattern (prevents multiple instances in dev)
const globalForGemini = global as unknown as { gemini: GeminiClient | undefined };

/**
 * Create and validate Gemini configuration from environment variables.
 * Authenticates with Application Default Credentials.
 */
function createGeminiConfig() {
  // Vertex AI needs to know which project to bill; with ADC that has to come
  // from the environment.
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;

  if (!projectId) {
    throw new GeminiConfigError(
      'Missing project configuration: set FIREBASE_PROJECT_ID so Vertex AI ' +
        'knows which project to bill.',
      ['FIREBASE_PROJECT_ID']
    );
  }

  return { projectId };
}

/**
 * Get or create the Gemini singleton instance.
 * Throws GeminiConfigError if required environment variables are missing.
 */
export function getGeminiClient(): GeminiClient {
  if (globalForGemini.gemini) {
    return globalForGemini.gemini;
  }

  const config = createGeminiConfig();
  const client = new GeminiClient(config);

  if (process.env.NODE_ENV !== 'production') {
    globalForGemini.gemini = client;
  }

  return client;
}

/**
 * Lazy-initialized Gemini client getter.
 * Use this instead of direct `gemini` export to avoid build-time errors.
 */
export const gemini = {
  get client(): GeminiClient {
    return getGeminiClient();
  },
};

// Re-export API functions
export {
  generateCopiesForLanguage,
  generateCopiesForFilm,
  pickVariantAngles,
} from './api';
export type { GenerateCopiesOptions } from './api';

// Re-export types for consumers
export type {
  GeminiConfig,
  CopyGenerationRequest,
  CopyGenerationResponse,
  GeneratedCopy,
  SupportedLanguage,
  Variant,
  FilmDataForPrompt,
} from './types';

export { CopyGenerationRequestSchema, SupportedLanguageSchema, VariantSchema } from './types';

// Re-export error classes
export {
  GeminiError,
  GeminiConfigError,
  GeminiApiError,
  GeminiValidationError,
} from './errors';

// Re-export the client class for advanced usage
export { GeminiClient } from './client';
