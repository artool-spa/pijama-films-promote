import { GoogleAdsAuthError } from './errors';

/**
 * Token cache to avoid refreshing on every request
 */
let cachedAccessToken: string | null = null;
let tokenExpiry: number = 0;

/**
 * Refresh the OAuth2 access token using the refresh token
 */
export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<string> {
  // Return cached token if still valid (with 5 min buffer)
  const now = Date.now();
  if (cachedAccessToken && now < tokenExpiry - 5 * 60 * 1000) {
    return cachedAccessToken;
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new GoogleAdsAuthError(
      `Failed to refresh access token: ${error.error_description || response.statusText}`,
      response.status
    );
  }

  const data = await response.json();
  cachedAccessToken = data.access_token;
  tokenExpiry = now + (data.expires_in * 1000);

  return data.access_token;
}

/**
 * Clear the cached access token (useful for testing or forced refresh)
 */
export function clearTokenCache(): void {
  cachedAccessToken = null;
  tokenExpiry = 0;
}
