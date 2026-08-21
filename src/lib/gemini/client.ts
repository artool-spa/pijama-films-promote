import { GoogleAuth } from 'google-auth-library';
import logger from '@/lib/logger';
import { GeminiConfig, GeminiConfigSchema } from './types';
import { GeminiConfigError, GeminiApiError } from './errors';

// Model to use for copy generation (fast and cost-effective)
// Gemini 3.5 Flash — served only from the Vertex AI 'global' endpoint (not regional).
const MODEL_NAME = 'gemini-3.5-flash';
// Vertex AI endpoint (supports service account authentication)
const VERTEX_AI_LOCATION = 'global';

// Reasoning tokens are billed against maxOutputTokens. Gemini 3 thinks before
// answering, and at 2048 it routinely spent ~1960 tokens reasoning and got cut
// off mid-JSON (finishReason MAX_TOKENS), so the parser received a fragment.
// 8192 leaves ample room for the answer even on a long reasoning pass.
const MAX_OUTPUT_TOKENS = 8192;

// Copy generation is a short, well-specified task: minimal reasoning is enough,
// and it roughly halves both latency and the risk of exhausting the budget.
const THINKING_LEVEL = 'LOW';

/** A single `part` of a Gemini candidate's content. */
interface GeminiResponsePart {
  text?: string;
  /** True when the part holds the model's internal reasoning, not the answer. */
  thought?: boolean;
}

/** Options for a single generateContent call. */
export interface GenerateContentOptions {
  /**
   * Vertex-flavoured JSON schema the output must conform to. When provided the
   * model is put in JSON mode, so the response is parseable JSON with no
   * markdown fences or surrounding prose.
   */
  responseSchema?: Record<string, unknown>;
}

/**
 * GeminiClient manages the connection to Google's Generative AI API
 * using service account authentication via Vertex AI.
 */
export class GeminiClient {
  private readonly auth: GoogleAuth;
  private readonly projectId: string;

  constructor(config: GeminiConfig) {
    // Validate configuration
    const result = GeminiConfigSchema.safeParse(config);
    if (!result.success) {
      const missingVars = result.error.issues.map((issue) => issue.path.join('.'));
      throw new GeminiConfigError(
        `Invalid Gemini configuration: ${result.error.message}`,
        missingVars
      );
    }

    // Application Default Credentials only: the runtime service account on App
    // Hosting, `gcloud auth application-default login` locally. No static key
    // is accepted, so there is none to leak or rotate.
    this.projectId = result.data.projectId;
    this.auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }

  /**
   * Get an access token for API requests
   */
  private async getAccessToken(): Promise<string> {
    const client = await this.auth.getClient();
    const tokenResponse = await client.getAccessToken();
    if (!tokenResponse.token) {
      throw new GeminiApiError('Failed to obtain access token');
    }
    return tokenResponse.token;
  }

  /**
   * Generate content using the model via Vertex AI
   */
  async generateContent(
    prompt: string,
    options?: GenerateContentOptions
  ): Promise<string> {
    const accessToken = await this.getAccessToken();

    // Vertex AI endpoint format.
    // Global endpoint has no region prefix; regional endpoints do.
    const host =
      VERTEX_AI_LOCATION === 'global'
        ? 'aiplatform.googleapis.com'
        : `${VERTEX_AI_LOCATION}-aiplatform.googleapis.com`;
    const url = `https://${host}/v1/projects/${this.projectId}/locations/${VERTEX_AI_LOCATION}/publishers/google/models/${MODEL_NAME}:generateContent`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          thinkingConfig: { thinkingLevel: THINKING_LEVEL },
          ...(options?.responseSchema
            ? {
                responseMimeType: 'application/json',
                responseSchema: options.responseSchema,
              }
            : {}),
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ statusCode: response.status, url, body: errorBody }, 'Gemini API error');
      throw new GeminiApiError(
        `Gemini API error: ${response.status} ${response.statusText}`,
        { context: { responseBody: errorBody } }
      );
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];

    // A truncated or filtered candidate still carries text, but it is a
    // fragment (often mid-reasoning). Fail loudly here instead of handing an
    // unparseable partial to the caller.
    const finishReason: string | undefined = candidate?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      logger.error(
        { finishReason, usage: data.usageMetadata },
        'Gemini did not finish normally'
      );
      throw new GeminiApiError(
        `Gemini stopped before completing the response (finishReason: ${finishReason})`,
        { context: { finishReason, usage: data.usageMetadata } }
      );
    }

    // Gemini 3 may return internal reasoning as extra `parts`; only the
    // non-thought part holds the answer.
    const parts: GeminiResponsePart[] = candidate?.content?.parts ?? [];
    const text = parts.find(
      (part) => !part.thought && typeof part.text === 'string' && part.text.length > 0
    )?.text;

    if (!text) {
      throw new GeminiApiError(
        'No text content in Gemini response',
        { context: { response: JSON.stringify(data).slice(0, 500) } }
      );
    }

    return text;
  }
}
