/**
 * Atlas Console integration - configuration.
 *
 * Every value is read from the environment at call time, never captured at
 * module load: App Hosting injects env vars into the running instance, and the
 * tests flip them between cases.
 *
 * `ATLAS_API_BASE_URL` is configurable on purpose. The real base URL of the
 * Atlas API is not known - Atlas is a hash-routed SPA and four candidate paths
 * probed on 2026-08-26 all answered `302`. Keeping it in the environment means
 * re-pointing the integration is a config change, not a code deploy.
 */

/** Documented path of the movies endpoint, appended to the configured base. */
export const ATLAS_MOVIES_PATH = '/movies/by-partner';

/** Upstream call budget. Atlas redirects rather than answering, so this is a ceiling, not a target. */
export const ATLAS_TIMEOUT_MS = 10_000;

/**
 * Base URL for the Atlas API, without a trailing slash. `null` when unset,
 * which the route reports as `stage: 'atlas_call'` - a missing base URL is
 * indistinguishable, from the caller's point of view, from an unreachable one.
 */
export function getAtlasBaseUrl(): string | null {
  const raw = process.env.ATLAS_API_BASE_URL?.trim();

  if (!raw) return null;

  return raw.replace(/\/+$/, '');
}

/** Full URL of the movies endpoint, or `null` when no base URL is configured. */
export function getAtlasMoviesUrl(): string | null {
  const base = getAtlasBaseUrl();

  return base ? `${base}${ATLAS_MOVIES_PATH}` : null;
}

/**
 * Is the `login` mode allowed to mint a session?
 *
 * Fail-closed: only the exact string `true` enables it. Anything else -
 * unset, empty, '1', 'yes', 'TRUE ' with junk around it - keeps login off.
 * `probe` mode is unaffected; it never mints anything.
 */
export function isAtlasLoginEnabled(): boolean {
  return process.env.ATLAS_LOGIN_ENABLED?.trim().toLowerCase() === 'true';
}

/**
 * Partner ids allowed to log in through Atlas SSO, from a comma-separated list.
 *
 * An empty result means NOBODY is allowed - see `isPartnerAllowed`. This is the
 * only containment for a known hole: `getFilms()` does not filter by partner,
 * so any partner holding a session sees the whole catalogue.
 */
export function getAtlasAllowedPartnerIds(): string[] {
  const raw = process.env.ATLAS_LOGIN_ALLOWED_PARTNER_IDS ?? '';

  const ids = raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  return [...new Set(ids)];
}

/**
 * Fail-closed allowlist check.
 *
 * An empty or absent allowlist rejects everyone. It must never be read as
 * "empty means all": that would turn a forgotten env var into an open door for
 * every partner Atlas can mint a token for.
 */
export function isPartnerAllowed(partnerId: string): boolean {
  const allowed = getAtlasAllowedPartnerIds();

  if (allowed.length === 0) return false;

  return allowed.includes(partnerId.trim());
}

/**
 * Origins allowed to postMessage into `/auth`. Read here only so the value has
 * a single parser; the landing page (T2 domain) is its actual consumer.
 */
export function getAtlasAllowedOrigins(): string[] {
  const raw = process.env.NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS ?? '';

  const origins = raw
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin.length > 0);

  return [...new Set(origins)];
}
