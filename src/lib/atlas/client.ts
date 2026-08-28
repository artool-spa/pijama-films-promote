/**
 * Atlas Console integration - server-side HTTP client.
 *
 * ## Why this cannot live in the browser
 *
 * Atlas sends no CORS headers: an `OPTIONS` preflight to the movies endpoint
 * with our origin answered `302` and no `Access-Control-Allow-Origin`
 * (measured 2026-08-26). The `fetch` that Crazy Cake's integration note
 * documents therefore cannot run from our origin. This call is server-side by
 * necessity, not by preference.
 *
 * ## Why redirects are not followed
 *
 * Every unauthenticated Atlas route answers `302 -> /auth/auth/logout`.
 * Following that would replace a legible "Atlas rejected the token" with an
 * HTML login page and a `200`, which reads as success. `redirect: 'manual'`
 * keeps the `302` visible so the diagnostics can report it.
 */

import { createLogger } from '@/lib/logger';
import {
  ATLAS_TIMEOUT_MS,
  getAtlasMoviesUrl,
} from './config';

const log = createLogger('atlas');

/** Longest body we keep in memory. Atlas serves an SPA, so a redirect can carry a full HTML page. */
const MAX_BODY_CHARS = 100_000;

export type AtlasBodyKind = 'json' | 'text' | 'empty' | 'none';

export interface AtlasCallResult {
  /** The exact URL called, or the unresolved base when configuration is missing. */
  url: string;
  /** HTTP status, or 0 when the request never completed (DNS, timeout, TLS). */
  status: number;
  /** True only for 2xx. A 302 is not success here. */
  ok: boolean;
  /** Parsed JSON body when the body was JSON, otherwise null. */
  json: unknown | null;
  /** What kind of body arrived. Distinguishes "not JSON" from "no body at all". */
  bodyKind: AtlasBodyKind;
  /** Top-level keys of the JSON body when it was an object; empty otherwise. */
  responseShapeKeys: string[];
  /** Redirect target with its query string stripped, when Atlas redirected. */
  redirectedTo: string | null;
  /** Transport-level failure description, when there was one. */
  networkError: string | null;
  /**
   * Set when the call was never attempted because this deployment has no Atlas
   * address configured. Like `inputError` and unlike `networkError`: the
   * request does not exist, so nothing is known about the upstream.
   */
  configError: string | null;
  /**
   * Set when the call was never attempted because the token we were handed
   * cannot travel in an HTTP header. Distinct from `networkError` on purpose:
   * this is our own input problem, and nothing whatsoever is known about the
   * upstream when it is set.
   */
  inputError: string | null;
}

/**
 * Token fingerprint safe to log and to render.
 *
 * The JWT is opaque and is never decoded to authorize; it is also never
 * echoed. Length plus a short prefix is enough to tell "no token arrived" from
 * "a token arrived and Atlas rejected it", which is the only question the
 * diagnostics need to answer.
 */
export function describeToken(token: string): { length: number; prefix: string } {
  return { length: token.length, prefix: token.slice(0, 6) };
}

/**
 * Characters a bearer token may contain if it is to survive being put in a
 * header: printable ASCII with no space, i.e. 0x21..0x7E.
 *
 * ## Why we validate this ourselves instead of letting `fetch` do it
 *
 * MEASURED (node 26.7 / undici, 2026-08-28), varying only the Authorization
 * value on a real `fetch`:
 *
 *   - LF, CR, NUL           -> TypeError: `Headers.append: "Bearer <the WHOLE
 *                              value>" is an invalid header value.` The message
 *                              quotes the credential, and this client turns a
 *                              thrown error into `networkError`, which the route
 *                              interpolates into the HTTP response. A user who
 *                              pasted a real token would have had it echoed back
 *                              and written to Cloud Logging.
 *   - beyond U+00FF         -> TypeError: Cannot convert argument to a ByteString.
 *   - TAB, SPACE, DEL, VT,
 *     U+0080..U+00FF        -> ACCEPTED and actually sent upstream.
 *
 * So `fetch` is not a validator: it leaks on half of these and forwards the
 * other half. Both are ours to prevent before the request exists.
 *
 * ## What this deliberately does NOT check
 *
 * The token stays opaque. No decoding, no three-segment JWT shape, no length
 * floor: whether the credential is valid is Atlas' answer to give, and this
 * project exists to find out what that answer is. The only judgement passed
 * here is physical - can these bytes go in a header at all.
 */
const HEADER_UNSAFE = /[^\x21-\x7E]/u;

/** Name the offending character by class. Never reproduces the character. */
function classifyUnsafe(code: number): string {
  if (code < 0x20 || code === 0x7f) return 'a control character';
  if (code === 0x20) return 'a space';

  return 'a non-ASCII character';
}

/** Escape anything unprintable so a raw control character cannot ride out inside the message. */
function maskPrefix(prefix: string): string {
  return prefix.replace(
    /[^\x20-\x7E]/gu,
    (c) => `\\u${(c.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`
  );
}

/**
 * `null` when the token can travel in an HTTP header; otherwise a message
 * naming what is wrong with the value.
 *
 * The message describes the value by class, index and fingerprint (length plus
 * a 6-char prefix, the same masking the rest of this module uses) - never by
 * content, because the rejected value may well be a live credential. It also
 * says nothing about Atlas: at this point nothing has been sent anywhere, so
 * there is nothing to report about the upstream.
 */
export function headerSafetyProblem(token: string): string | null {
  const index = token.search(HEADER_UNSAFE);

  if (index === -1) return null;

  const { length, prefix } = describeToken(token);

  return (
    'The token contains characters that cannot travel in an HTTP header: ' +
    `${classifyUnsafe(token.charCodeAt(index))} at index ${index} ` +
    `(token length ${length}, starts with "${maskPrefix(prefix)}").`
  );
}

/** Top-level keys of a parsed JSON body. Arrays and scalars have none worth reporting. */
function shapeKeysOf(json: unknown): string[] {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return [];

  return Object.keys(json as Record<string, unknown>);
}

/**
 * Anything that looks like a JWT: the "eyJ" prefix is base64url for '{"', which
 * is how every JSON-header token starts.
 */
const JWT_SHAPED = /eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)*/g;

/**
 * Reduce a redirect target to the part that is safe to log and to show.
 *
 * Cutting at `?` alone is not enough, and this is not hypothetical: Atlas is a
 * hash-routed SPA (`dashboard.pijamafilms.com/#/`), and in a hash-routed SPA
 * the fragment is exactly where session parameters live. A Location of
 * `/#/auth#token=eyJ...` or `/#/session/eyJ...` would have carried a live
 * credential into Cloud Logging and into the message the caller reads.
 *
 * So: cut at the first `?` or `#`, whichever comes first. Then redact anything
 * still JWT-shaped, which covers the remaining case truncation cannot - a token
 * sitting in a plain path segment (`/session/eyJ...`). The redaction is the
 * second line of defence, not the first; the truncation above is what carries
 * the guarantee.
 */
function sanitizeLocation(location: string | null): string | null {
  if (!location) return null;

  const cut = location.search(/[?#]/);
  const truncated = (cut === -1 ? location : location.slice(0, cut)).slice(0, 200);

  return truncated.replace(JWT_SHAPED, '[redacted]');
}

/**
 * GET {ATLAS_API_BASE_URL}/movies/by-partner with the Atlas JWT as a bearer.
 *
 * Never throws: a transport failure comes back as `status: 0` with
 * `networkError` set, so the caller reports one shape for every outcome.
 */
export async function fetchPartnerMovies(token: string): Promise<AtlasCallResult> {
  const url = getAtlasMoviesUrl();
  const fingerprint = describeToken(token);

  // Before the URL check: a token we cannot put in a header is the caller's
  // problem, and it stays true whether or not this environment is configured.
  const inputError = headerSafetyProblem(token);

  if (inputError) {
    log.warn(
      { tokenLength: fingerprint.length, tokenPrefix: fingerprint.prefix },
      'Atlas call not attempted: the token cannot travel in an HTTP header'
    );

    return {
      url: url ?? '',
      status: 0,
      ok: false,
      json: null,
      bodyKind: 'none',
      responseShapeKeys: [],
      redirectedTo: null,
      networkError: null,
      inputError,
      configError: null,
    };
  }

  if (!url) {
    log.warn(
      { tokenLength: fingerprint.length },
      'ATLAS_API_BASE_URL is not configured'
    );

    return {
      url: '',
      status: 0,
      ok: false,
      json: null,
      bodyKind: 'none',
      responseShapeKeys: [],
      redirectedTo: null,
      // NOT `networkError`: a transport failure says Atlas did not answer, and
      // we never had an address to ask. See `configError` above.
      networkError: null,
      inputError: null,
      configError: 'ATLAS_API_BASE_URL is not configured on this deployment',
    };
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      // See the file header: a followed redirect would look like success.
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(ATLAS_TIMEOUT_MS),
    });
  } catch (error) {
    const networkError =
      error instanceof Error ? `${error.name}: ${error.message}` : 'unknown transport error';

    log.error(
      { url, tokenLength: fingerprint.length, tokenPrefix: fingerprint.prefix, networkError },
      'Atlas call failed at the transport level'
    );

    return {
      url,
      status: 0,
      ok: false,
      json: null,
      bodyKind: 'none',
      responseShapeKeys: [],
      redirectedTo: null,
      networkError,
      inputError: null,
      configError: null,
    };
  }

  const redirectedTo = sanitizeLocation(response.headers.get('location'));

  let bodyText = '';

  try {
    bodyText = (await response.text()).slice(0, MAX_BODY_CHARS);
  } catch {
    bodyText = '';
  }

  let json: unknown | null = null;
  let bodyKind: AtlasBodyKind = 'empty';

  if (bodyText.length > 0) {
    try {
      json = JSON.parse(bodyText);
      bodyKind = 'json';
    } catch {
      bodyKind = 'text';
    }
  }

  const responseShapeKeys = shapeKeysOf(json);

  log.info(
    {
      url,
      status: response.status,
      bodyKind,
      responseShapeKeys,
      redirectedTo,
      tokenLength: fingerprint.length,
      tokenPrefix: fingerprint.prefix,
    },
    'Atlas call completed'
  );

  return {
    url,
    status: response.status,
    ok: response.status >= 200 && response.status < 300,
    json,
    bodyKind,
    responseShapeKeys,
    redirectedTo,
    networkError: null,
    inputError: null,
    configError: null,
  };
}
