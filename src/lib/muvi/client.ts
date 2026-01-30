import {
  MuviConfig,
  MuviConfigSchema,
  MuviTokenResponseSchema,
} from './types';
import { MuviAuthError, MuviConfigError } from './errors';

// Token expiry buffer: refresh 5 minutes before actual expiry
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

// Default token validity (1 hour) - Muvi doesn't specify, so we use a conservative estimate
const DEFAULT_TOKEN_VALIDITY_MS = 60 * 60 * 1000;

/**
 * MuviTokenHandler manages authentication with the Muvi API.
 * It handles token acquisition and automatic refresh.
 */
export class MuviTokenHandler {
  private readonly config: MuviConfig;
  private accessToken: string | null = null;
  private _productKey: string | null = null;
  private _appToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private tokenPromise: Promise<string> | null = null;

  constructor(config: MuviConfig) {
    // Validate configuration
    const result = MuviConfigSchema.safeParse(config);
    if (!result.success) {
      const missingVars = result.error.issues.map((issue) => issue.path.join('.'));
      throw new MuviConfigError(
        `Invalid Muvi configuration: ${result.error.message}`,
        missingVars
      );
    }
    this.config = result.data;
  }

  /**
   * Get the base URL for API requests
   */
  get baseUrl(): string {
    return this.config.baseUrl;
  }

  /**
   * Get the product key for API requests.
   * This is obtained from the token response.
   */
  get productKey(): string {
    if (!this._productKey) {
      throw new MuviAuthError('Product key not available. Call getAccessToken() first.');
    }
    return this._productKey;
  }

  /**
   * Get the app token for API requests.
   * This is obtained from the token response.
   */
  get appToken(): string {
    if (!this._appToken) {
      throw new MuviAuthError('App token not available. Call getAccessToken() first.');
    }
    return this._appToken;
  }

  /**
   * Get a valid access token, refreshing if necessary.
   * This method is thread-safe and will only fetch tokens once
   * even if called multiple times concurrently.
   */
  async getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (this.accessToken && !this.isTokenExpired()) {
      return this.accessToken;
    }

    // If a token fetch is already in progress, wait for it
    if (this.tokenPromise) {
      return this.tokenPromise;
    }

    // Start a new token fetch
    this.tokenPromise = this.fetchTokens();

    try {
      const token = await this.tokenPromise;
      return token;
    } finally {
      this.tokenPromise = null;
    }
  }

  /**
   * Check if the current token is expired or about to expire
   */
  private isTokenExpired(): boolean {
    if (!this.tokenExpiry) {
      return true;
    }
    const now = new Date();
    const expiryWithBuffer = new Date(this.tokenExpiry.getTime() - TOKEN_EXPIRY_BUFFER_MS);
    return now >= expiryWithBuffer;
  }

  /**
   * Fetch new tokens from the Muvi API
   */
  private async fetchTokens(): Promise<string> {
    const url = `${this.config.baseUrl}/get-user-token-details`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          secret_key: this.config.secretKey,
          app_id: this.config.appId,
        }),
      });

      if (!response.ok) {
        throw new MuviAuthError(
          `Token fetch failed with status ${response.status}: ${response.statusText}`,
          response.status
        );
      }

      const data = await response.json();

      // Validate response structure
      const result = MuviTokenResponseSchema.safeParse(data);
      if (!result.success) {
        throw new MuviAuthError(
          `Invalid token response: ${result.error.message}`
        );
      }

      // Check for API-level errors
      if (result.data.status !== 'SUCCESS') {
        throw new MuviAuthError(
          `Token request failed: ${result.data.message}`,
          result.data.code
        );
      }

      // Store tokens and data from response
      this.accessToken = result.data.response.access_token;
      this._productKey = result.data.data.product_key;
      this._appToken = result.data.data.app_token;
      this.tokenExpiry = new Date(Date.now() + DEFAULT_TOKEN_VALIDITY_MS);

      return this.accessToken;
    } catch (error) {
      // Re-throw MuviAuthError as-is
      if (error instanceof MuviAuthError) {
        throw error;
      }

      // Wrap other errors
      throw new MuviAuthError(
        `Failed to fetch tokens: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Force a token refresh, even if the current token is still valid.
   * Useful for handling 401 responses from the API.
   */
  async forceRefresh(): Promise<string> {
    this.accessToken = null;
    this._productKey = null;
    this._appToken = null;
    this.tokenExpiry = null;
    return this.getAccessToken();
  }

  /**
   * Clear all stored tokens
   */
  clearTokens(): void {
    this.accessToken = null;
    this._productKey = null;
    this._appToken = null;
    this.tokenExpiry = null;
    this.tokenPromise = null;
  }
}
