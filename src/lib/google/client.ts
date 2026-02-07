import { GoogleAdsConfig, GoogleAdsConfigSchema, GoogleErrorResponseSchema } from './types';
import { GoogleAdsConfigError, GoogleAdsApiError, GoogleAdsAuthError, GoogleAdsQuotaError } from './errors';
import { refreshAccessToken } from './auth';

/**
 * GoogleAdsClient manages the Google Ads API connection.
 * Uses OAuth2 with automatic token refresh.
 */
export class GoogleAdsClient {
  private readonly config: GoogleAdsConfig;

  constructor(config: GoogleAdsConfig) {
    const result = GoogleAdsConfigSchema.safeParse(config);
    if (!result.success) {
      const missingVars = result.error.issues.map((issue) => issue.path.join('.'));
      throw new GoogleAdsConfigError(
        `Invalid Google Ads configuration: ${result.error.message}`,
        missingVars
      );
    }
    this.config = result.data;
  }

  /**
   * Get the customer ID (without hyphens)
   */
  get customerId(): string {
    return this.config.customerId.replace(/-/g, '');
  }

  /**
   * Get the login customer ID (for MCC accounts)
   */
  get loginCustomerId(): string | undefined {
    return this.config.loginCustomerId?.replace(/-/g, '');
  }

  /**
   * Get the base URL for API requests
   */
  get baseUrl(): string {
    return `${this.config.baseUrl}/${this.config.apiVersion}`;
  }

  /**
   * Build authorization headers for API requests
   */
  async getAuthHeaders(): Promise<Record<string, string>> {
    const accessToken = await refreshAccessToken(
      this.config.clientId,
      this.config.clientSecret,
      this.config.refreshToken
    );

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'developer-token': this.config.developerToken,
    };

    if (this.loginCustomerId) {
      headers['login-customer-id'] = this.loginCustomerId;
    }

    return headers;
  }

  /**
   * Build resource name for a customer
   */
  buildCustomerResourceName(): string {
    return `customers/${this.customerId}`;
  }

  /**
   * Build URL for customer-level operations
   */
  buildCustomerUrl(endpoint: string): string {
    return `${this.baseUrl}/customers/${this.customerId}/${endpoint}`;
  }

  /**
   * Build resource name for a campaign
   */
  buildCampaignResourceName(campaignId: string): string {
    return `customers/${this.customerId}/campaigns/${campaignId}`;
  }

  /**
   * Build resource name for an ad group
   */
  buildAdGroupResourceName(adGroupId: string): string {
    return `customers/${this.customerId}/adGroups/${adGroupId}`;
  }

  /**
   * Execute a Google Ads API request with error handling
   */
  async executeRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
    const headers = await this.getAuthHeaders();

    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      const errorResult = GoogleErrorResponseSchema.safeParse(data);
      if (errorResult.success) {
        const err = errorResult.data.error;

        if (err.code === 401) {
          throw new GoogleAdsAuthError(err.message, response.status);
        }
        if (err.code === 429) {
          throw new GoogleAdsQuotaError(err.message);
        }

        throw new GoogleAdsApiError(err.message, {
          statusCode: response.status,
          endpoint: url,
          errorCode: err.status,
          response: data,
        });
      }

      throw new GoogleAdsApiError(`Request failed: ${response.status}`, {
        statusCode: response.status,
        endpoint: url,
        response: data,
      });
    }

    return data as T;
  }

  /**
   * Execute a GAQL (Google Ads Query Language) query
   */
  async query<T>(gaqlQuery: string): Promise<T> {
    const url = this.buildCustomerUrl('googleAds:searchStream');
    return this.executeRequest<T>(url, {
      method: 'POST',
      body: JSON.stringify({ query: gaqlQuery }),
    });
  }

  /**
   * Execute a mutate operation
   */
  async mutate(
    resource: string,
    operations: Array<{ create?: unknown; update?: unknown; remove?: string }>
  ): Promise<{ results: Array<{ resourceName: string }> }> {
    const url = this.buildCustomerUrl(`${resource}:mutate`);
    return this.executeRequest(url, {
      method: 'POST',
      body: JSON.stringify({ operations }),
    });
  }
}
