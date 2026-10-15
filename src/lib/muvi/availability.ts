/**
 * Can viewers actually watch this film? Asked of MUVI, from the server, when a
 * campaign is created: no ad money should go to a film whose link will not open.
 *
 * Response bodies MEASURED 2026-10-02 (docs/atlas-sso-integration.md, from a
 * Chilean IP with our credentials) - NOT re-measured live, and MUVI is bound to
 * the caller's IP, so a rejection seen from another machine may be about the IP
 * and not the film:
 *
 *   - region-blocked uuid -> body code 400,  "This content is not available in your region"
 *   - invented uuid       -> body code 1317, "The content you're looking for is no longer available"
 *   - served film         -> full details
 *
 * `getMovieDetails` turns a failed body into `MuviApiError("Muvi API error: <message>",
 * { statusCode: <body code> })`, so `statusCode` here is MUVI's body code.
 */

import { createLogger } from '@/lib/logger';
import { muvi, getMovieDetails, MuviApiError } from '#muvi';

const log = createLogger('muvi-availability');

/** What a producer reads when MUVI will not serve the film. Plain language, no jargon. */
export const FILM_NOT_AVAILABLE_MESSAGE =
  "This film isn't available to viewers yet, so we can't advertise it. Contact Pijama Films to fix it.";

/** What a producer reads when we could not find out. A different problem, different advice. */
export const FILM_CHECK_FAILED_MESSAGE =
  "We couldn't check that this film is available right now. Please try again in a few minutes.";

/** MUVI will not serve the film (blocked in our region, or no longer exists). */
export class FilmNotAvailableError extends Error {
  readonly reason: 'region' | 'gone';

  constructor(reason: 'region' | 'gone') {
    super(FILM_NOT_AVAILABLE_MESSAGE);
    this.name = 'FilmNotAvailableError';
    this.reason = reason;
  }
}

/** We could not tell: MUVI down, timing out, rejecting our credentials. NOT "blocked". */
export class FilmAvailabilityUnknownError extends Error {
  constructor() {
    super(FILM_CHECK_FAILED_MESSAGE);
    this.name = 'FilmAvailabilityUnknownError';
  }
}

/**
 * Region block. Matches on the MESSAGE, not on the body code 400, which can be
 * generic. An HTTP failure, a timeout or a credential rejection carries no such
 * text and stays "unknown".
 */
export function isRegionBlock(error: unknown): boolean {
  return error instanceof MuviApiError && /not available in your region/i.test(error.message);
}

/** The content no longer exists in MUVI: body code 1317 or its message. */
export function isContentGone(error: unknown): boolean {
  return (
    error instanceof MuviApiError &&
    (error.statusCode === 1317 || /no longer available/i.test(error.message))
  );
}

/**
 * Throws unless MUVI will serve this film from the server's region.
 *
 * - served                                  -> returns
 * - blocked by region / gone / empty result -> FilmNotAvailableError
 * - anything else (outage, auth, timeout)   -> FilmAvailabilityUnknownError.
 *   Fail-closed: spend is not created on something we could not verify.
 */
export async function assertFilmPromotable(filmMuviUuid: string): Promise<void> {
  let movie: unknown;

  try {
    movie = await getMovieDetails(muvi, filmMuviUuid);
  } catch (error) {
    if (isRegionBlock(error)) throw new FilmNotAvailableError('region');
    if (isContentGone(error)) throw new FilmNotAvailableError('gone');

    // Name and status only: the message may quote an upstream body.
    log.error(
      {
        filmMuviUuid,
        errName: error instanceof Error ? error.name : 'unknown',
        status: error instanceof MuviApiError ? error.statusCode : undefined,
      },
      'Could not verify film availability with MUVI'
    );
    throw new FilmAvailabilityUnknownError();
  }

  if (!movie) {
    throw new FilmNotAvailableError('gone');
  }
}

/**
 * For a route's catch block: the HTTP answer for an availability failure, or
 * null when `error` is something else. 422 = the film cannot be advertised;
 * 503 = we could not check, retry later. The message is producer-safe.
 */
export function describeAvailabilityFailure(
  error: unknown
): { status: 422 | 503; code: 'FILM_NOT_AVAILABLE' | 'FILM_CHECK_FAILED'; message: string } | null {
  if (error instanceof FilmNotAvailableError) {
    return { status: 422, code: 'FILM_NOT_AVAILABLE', message: error.message };
  }
  if (error instanceof FilmAvailabilityUnknownError) {
    return { status: 503, code: 'FILM_CHECK_FAILED', message: error.message };
  }

  return null;
}
