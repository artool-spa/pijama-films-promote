import { GoogleAuth } from 'google-auth-library';
import logger from '@/lib/logger';
import { GeminiConfig, GeminiConfigSchema } from './types';
import { GeminiConfigError, GeminiApiError } from './errors';

// Model to use for copy generation (fast and cost-effective)
// Gemini 3.5 Flash — served only from the Vertex AI 'global' endpoint (not regional).
const MODEL_NAME = 'gemini-3.5-flash';
// Vertex AI endpoint (supports service account authentication)
const VERTEX_AI_LOCATION = 'global';

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

    // Parse service account credentials
    let credentials: { client_email: string; private_key: string; project_id: string };
    try {
      credentials = JSON.parse(result.data.serviceAccountKeyJson);
    } catch {
      throw new GeminiConfigError(
        'Invalid GCS_SERVICE_ACCOUNT_KEY_JSON: must be valid JSON'
      );
    }

    if (!credentials.project_id) {
      throw new GeminiConfigError(
        'Service account JSON must contain project_id'
      );
    }

    this.projectId = credentials.project_id;

    // Initialize Google Auth with service account credentials for Vertex AI
    this.auth = new GoogleAuth({
      credentials,
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
  async generateContent(prompt: string): Promise<string> {
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
          maxOutputTokens: 2048,
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

    // Extract text from response
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new GeminiApiError(
        'No text content in Gemini response',
        { context: { response: JSON.stringify(data).slice(0, 500) } }
      );
    }

    return text;
  }
}
