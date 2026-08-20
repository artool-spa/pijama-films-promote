import { GoogleAuth } from 'google-auth-library';
import { defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';

/**
 * Base URL of the App Hosting backend these functions dispatch to, e.g.
 * https://pijama-promote--pijama-promote-firebase.us-central1.hosted.app
 *
 * It doubles as the OIDC audience: the backend verifies that each token was
 * minted for exactly this URL, so a token leaked from here cannot be replayed
 * anywhere else.
 */
export const BACKEND_URL = defineString('BACKEND_URL', {
  // Defaulted so the emulator and any non-interactive deploy start without
  // prompting. An unset value is caught at call time instead, where the error
  // names the variable.
  default: '',
  description: 'Base URL of the App Hosting backend; also the OIDC audience',
});

const auth = new GoogleAuth();

/**
 * Call an endpoint on the App Hosting backend with an OIDC token.
 *
 * The backend serves the public site, so it cannot be closed off with an IAM
 * invoker binding — its internal routes authorize the caller themselves by
 * verifying this token against the function's service account. No shared
 * secret is involved in either direction.
 *
 * Throws on a non-2xx response so the caller (a queue, a schedule) can apply
 * its own retry policy.
 */
export async function callBackend(
  path: string,
  init?: { method?: 'GET' | 'POST'; body?: unknown }
): Promise<unknown> {
  const baseUrl = BACKEND_URL.value();
  if (!baseUrl) {
    throw new Error('BACKEND_URL is not configured');
  }

  const client = await auth.getIdTokenClient(baseUrl);
  const method = init?.method ?? 'GET';

  const response = await client.request({
    url: new URL(path, baseUrl).toString(),
    method,
    ...(init?.body !== undefined && {
      data: init.body,
      headers: { 'Content-Type': 'application/json' },
    }),
    // Surface the status instead of throwing, so the message can be logged.
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    logger.error(`${method} ${path} failed`, { status: response.status });
    throw new Error(`${method} ${path} responded ${response.status}`);
  }

  return response.data;
}
