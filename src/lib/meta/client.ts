import { MetaConfig, MetaConfigSchema } from './types';
import { MetaConfigError } from './errors';

/**
 * MetaClient manages the Meta Ads API connection.
 * Uses a long-lived access token (60 days) that needs manual refresh.
 */
export class MetaClient {
  private readonly config: MetaConfig;

  constructor(config: MetaConfig) {
    const result = MetaConfigSchema.safeParse(config);
    if (!result.success) {
      const missingVars = result.error.issues.map((issue) => issue.path.join('.'));
      throw new MetaConfigError(
        `Invalid Meta configuration: ${result.error.message}`,
        missingVars
      );
    }
    this.config = result.data;
  }

  /**
   * Get the base URL for API requests (includes version)
   */
  get baseUrl(): string {
    return `${this.config.baseUrl}/${this.config.apiVersion}`;
  }

  /**
   * Get the access token
   */
  get accessToken(): string {
    return this.config.accessToken;
  }

  /**
   * Get the ad account ID (with act_ prefix)
   */
  get adAccountId(): string {
    const id = this.config.adAccountId;
    return id.startsWith('act_') ? id : `act_${id}`;
  }

  /**
   * Get the pixel ID (if configured)
   */
  get pixelId(): string | undefined {
    return this.config.pixelId;
  }

  /**
   * Get the page ID (if configured)
   */
  get pageId(): string | undefined {
    return this.config.pageId;
  }

  /**
   * Build authorization headers for API requests
   */
  getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Build URL for ad account endpoints
   * @example buildAdAccountUrl('campaigns') => 'https://graph.facebook.com/v19.0/act_123/campaigns'
   */
  buildAdAccountUrl(endpoint: string): string {
    return `${this.baseUrl}/${this.adAccountId}/${endpoint}`;
  }

  /**
   * Build URL for a specific object (campaign, adset, ad, etc.)
   * @example buildObjectUrl('123', 'insights') => 'https://graph.facebook.com/v19.0/123/insights'
   */
  buildObjectUrl(objectId: string, endpoint?: string): string {
    const base = `${this.baseUrl}/${objectId}`;
    return endpoint ? `${base}/${endpoint}` : base;
  }
}
