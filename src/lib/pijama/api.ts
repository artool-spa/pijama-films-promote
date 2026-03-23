import logger from '@/lib/logger';
import { PijamaClient } from './client';
import {
  PijamaPartner,
  PijamaPartnerSchema,
  PijamaPartnerListResponse,
  PijamaPartnerListResponseSchema,
  PijamaErrorResponseSchema,
} from './types';
import { PijamaApiError, PijamaAuthError } from './errors';

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Execute an API request with standardized error handling
 */
async function executeRequest<T>(
  client: PijamaClient,
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const authHeaders = await client.getAuthHeaders();

  const response = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders,
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    const errorResult = PijamaErrorResponseSchema.safeParse(data);
    if (errorResult.success) {
      const err = errorResult.data;

      // Handle auth errors
      if (response.status === 401) {
        throw new PijamaAuthError(err.error_description || err.error, 401);
      }

      throw new PijamaApiError(err.error_description || err.error, {
        statusCode: response.status,
        endpoint: url,
        errorCode: err.error_code,
        response: data,
      });
    }

    throw new PijamaApiError(`Request failed: ${response.status}`, {
      statusCode: response.status,
      endpoint: url,
      response: data,
    });
  }

  return data as T;
}

// ============================================================================
// PARTNER OPERATIONS
// ============================================================================

/**
 * Get a partner by their Pijama partner ID
 */
export async function getPartner(
  client: PijamaClient,
  partnerId: string
): Promise<PijamaPartner> {
  const url = client.buildUrl(`/api/v1/partners/${partnerId}`);
  const result = await executeRequest<unknown>(client, url);
  return PijamaPartnerSchema.parse(result);
}

/**
 * Get the currently authenticated partner (from token)
 */
export async function getCurrentPartner(
  client: PijamaClient
): Promise<PijamaPartner> {
  const url = client.buildUrl('/api/v1/partners/me');
  const result = await executeRequest<unknown>(client, url);
  return PijamaPartnerSchema.parse(result);
}

/**
 * List all partners (admin only)
 */
export async function listPartners(
  client: PijamaClient,
  options?: {
    page?: number;
    perPage?: number;
    status?: 'active' | 'inactive' | 'pending';
  }
): Promise<PijamaPartnerListResponse> {
  const params = new URLSearchParams();
  if (options?.page) params.append('page', String(options.page));
  if (options?.perPage) params.append('per_page', String(options.perPage));
  if (options?.status) params.append('status', options.status);

  const url = `${client.buildUrl('/api/v1/partners')}?${params.toString()}`;
  const result = await executeRequest<unknown>(client, url);
  return PijamaPartnerListResponseSchema.parse(result);
}

/**
 * Check if a partner can access a specific film
 */
export async function canPartnerAccessFilm(
  client: PijamaClient,
  partnerId: string,
  filmMuviUuid: string
): Promise<boolean> {
  try {
    const partner = await getPartner(client, partnerId);

    // If film_ids is empty, partner has no films
    if (!partner.film_ids || partner.film_ids.length === 0) {
      return false;
    }

    // Check if the film UUID is in the partner's list
    return partner.film_ids.includes(filmMuviUuid);
  } catch (error) {
    // If partner not found or other error, deny access
    logger.error({ err: error, partnerId, filmMuviUuid }, 'Error checking film access for partner');
    return false;
  }
}

/**
 * Get the list of film IDs a partner can access
 */
export async function getPartnerFilmIds(
  client: PijamaClient,
  partnerId: string
): Promise<string[]> {
  try {
    const partner = await getPartner(client, partnerId);
    return partner.film_ids || [];
  } catch (error) {
    logger.error({ err: error, partnerId }, 'Error fetching film IDs for partner');
    return [];
  }
}

// ============================================================================
// AUTHENTICATION HELPERS
// ============================================================================

/**
 * Validate a partner JWT token and return the partner data
 * Used for authenticating incoming requests with Pijama tokens
 */
export async function validatePartnerToken(
  client: PijamaClient,
  token: string
): Promise<PijamaPartner | null> {
  const url = client.buildUrl('/api/v1/auth/validate');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return PijamaPartnerSchema.parse(data.partner || data);
  } catch {
    return null;
  }
}

/**
 * Exchange a Pijama authorization code for tokens
 * Used for OAuth2 authorization code flow
 */
export async function exchangeAuthCode(
  client: PijamaClient,
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; partner: PijamaPartner }> {
  const url = client.buildUrl('/oauth/token');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new PijamaAuthError(
      `Auth code exchange failed: ${errorData.error_description || response.statusText}`,
      response.status
    );
  }

  const data = await response.json();

  // Fetch partner data using the new token
  const partnerResponse = await fetch(client.buildUrl('/api/v1/partners/me'), {
    headers: {
      Authorization: `Bearer ${data.access_token}`,
    },
  });

  if (!partnerResponse.ok) {
    throw new PijamaAuthError('Failed to fetch partner data after authentication');
  }

  const partnerData = await partnerResponse.json();

  return {
    accessToken: data.access_token,
    partner: PijamaPartnerSchema.parse(partnerData),
  };
}
