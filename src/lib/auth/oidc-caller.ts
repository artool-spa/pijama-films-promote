import { OAuth2Client } from 'google-auth-library';

import { createLogger } from '@/lib/logger';

const log = createLogger('oidc-caller');

/**
 * Authorization for the internal trigger endpoints (Cloud Scheduler jobs and
 * Cloud Tasks queues, both dispatched by the functions codebase).
 *
 * The App Hosting backend serves the public site, so it cannot be locked down
 * with an IAM invoker binding: anyone can reach `/api/cron/*`. Authorization
 * therefore has to happen in the route.
 *
 * Rather than a shared secret, each caller presents a Google-signed OIDC token
 * minted for its own service account and scoped to this backend's URL. Nothing
 * secret is stored on either side, the token expires on its own, and it cannot
 * be replayed against a different audience.
 */

/** Service accounts allowed to invoke the internal endpoints. */
function allowedInvokers(): string[] {
  return (process.env.CRON_INVOKER_SERVICE_ACCOUNTS ?? '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);
}

/** The URL the token must have been minted for. */
function expectedAudience(): string | undefined {
  return process.env.INTERNAL_TRIGGER_AUDIENCE;
}

let client: OAuth2Client | undefined;

function oauthClient(): OAuth2Client {
  if (!client) client = new OAuth2Client();
  return client;
}

export interface OidcCaller {
  serviceAccount: string;
}

/**
 * Verify the OIDC bearer token on an internal trigger request.
 *
 * Returns the caller on success and `null` on every failure. Callers respond
 * with a bare 401: the reason is logged, never returned, and the token itself
 * is never logged.
 */
export async function verifyOidcCaller(
  authorization: string | null
): Promise<OidcCaller | null> {
  const audience = expectedAudience();
  const invokers = allowedInvokers();

  if (!audience || invokers.length === 0) {
    log.error(
      'Internal triggers are not configured: set INTERNAL_TRIGGER_AUDIENCE and ' +
        'CRON_INVOKER_SERVICE_ACCOUNTS'
    );
    return null;
  }

  if (!authorization?.startsWith('Bearer ')) return null;
  const idToken = authorization.slice('Bearer '.length);

  let payload;
  try {
    const ticket = await oauthClient().verifyIdToken({ idToken, audience });
    payload = ticket.getPayload();
  } catch (error) {
    // The message can quote the token, so only the error type is recorded.
    log.warn(
      { err: error instanceof Error ? error.name : 'unknown' },
      'OIDC token rejected'
    );
    return null;
  }

  if (!payload?.email || payload.email_verified !== true) {
    log.warn('OIDC token carries no verified email');
    return null;
  }

  if (!invokers.includes(payload.email)) {
    log.warn({ serviceAccount: payload.email }, 'Service account not allowed');
    return null;
  }

  return { serviceAccount: payload.email };
}

/**
 * Authorize an internal trigger request.
 *
 * Accepts an OIDC token, and — while the Cloud Scheduler/Tasks cutover is in
 * flight — the legacy `CRON_SECRET` bearer. Drop the secret branch once the
 * functions are live and the logs confirm they authenticate (see the plan's
 * two-step cutover); the endpoints would be unreachable if it went first.
 */
export async function authorizeInternalRequest(
  authorization: string | null
): Promise<boolean> {
  if (await verifyOidcCaller(authorization)) return true;

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authorization === `Bearer ${cronSecret}`) {
    log.warn('Authorized with the legacy CRON_SECRET; migrate this caller to OIDC');
    return true;
  }

  return false;
}
