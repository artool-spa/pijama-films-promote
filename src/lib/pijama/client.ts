import {
  PijamaConfig,
  PijamaConfigSchema,
  PijamaTokenResponseSchema,
} from './types';
import { PijamaAuthError, PijamaConfigError } from './errors';

// Token expiry buffer: refresh 5 minutes before actual expiry
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/**
 * PijamaClient manages authentication and requests to the Pijama API.
 * It handles OAuth2 token acquisition and automatic refresh.
 */
export class PijamaClient {
  private readonly config: PijamaConfig;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private tokenPromise: Promise<string> | null = null;

  constructor(config: Partial<PijamaConfig>) {
    // Validate configuration
    const result = PijamaConfigSchema.safeParse(config);
    if (!result.success) {
      const missingVars = result.error.issues.map((issue) => issue.path.join('.'));
      throw new PijamaConfigError(
        `Invalid Pijama configuration: ${result.error.message}`,
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
   * Build a full API URL for a given endpoint
   */
  buildUrl(endpoint: string): string {
    const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${this.config.baseUrl}${path}`;
  }

  /**
   * Get authorization headers for API requests
   */
  async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
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

    // Try to refresh if we have a refresh token
    if (this.refreshToken && this.isTokenExpired()) {
      this.tokenPromise = this.refreshAccessToken();
    } else {
      // Start a new token fetch using client credentials
      this.tokenPromise = this.fetchClientCredentialsToken();
    }

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
   * Fetch a new token using client credentials grant
   */
  private async fetchClientCredentialsToken(): Promise<string> {
    const url = this.buildUrl('/oauth/token');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new PijamaAuthError(
          `Token fetch failed: ${errorData.error_description || response.statusText}`,
          response.status
        );
      }

      const data = await response.json();
      const result = PijamaTokenResponseSchema.safeParse(data);

      if (!result.success) {
        throw new PijamaAuthError(
          `Invalid token response: ${result.error.message}`
        );
      }

      // Store tokens
      this.accessToken = result.data.access_token;
      this.refreshToken = result.data.refresh_token || null;
      this.tokenExpiry = new Date(Date.now() + result.data.expires_in * 1000);

      return this.accessToken;
    } catch (error) {
      if (error instanceof PijamaAuthError) {
        throw error;
      }
      throw new PijamaAuthError(
        `Failed to fetch token: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Refresh the access token using the refresh token
   */
  private async refreshAccessToken(): Promise<string> {
    if (!this.refreshToken) {
      return this.fetchClientCredentialsToken();
    }

    const url = this.buildUrl('/oauth/token');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
        }),
      });

      if (!response.ok) {
        // If refresh fails, try client credentials
        this.refreshToken = null;
        return this.fetchClientCredentialsToken();
      }

      const data = await response.json();
      const result = PijamaTokenResponseSchema.safeParse(data);

      if (!result.success) {
        // If parsing fails, try client credentials
        this.refreshToken = null;
        return this.fetchClientCredentialsToken();
      }

      // Store tokens
      this.accessToken = result.data.access_token;
      this.refreshToken = result.data.refresh_token || this.refreshToken;
      this.tokenExpiry = new Date(Date.now() + result.data.expires_in * 1000);

      return this.accessToken;
    } catch {
      // If refresh fails for any reason, try client credentials
      this.refreshToken = null;
      return this.fetchClientCredentialsToken();
    }
  }

  /**
   * Force a token refresh
   */
  async forceRefresh(): Promise<string> {
    this.accessToken = null;
    this.tokenExpiry = null;
    return this.getAccessToken();
  }

  /**
   * Clear all stored tokens
   */
  clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
    this.tokenPromise = null;
  }
}
