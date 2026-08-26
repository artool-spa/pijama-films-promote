/**
 * Atlas Console integration - types and validation schemas.
 *
 * ## Status of the upstream contract (read before "fixing" a schema here)
 *
 * The movies endpoint below is documented by Crazy Cake (Atlas' vendor) but has
 * NEVER been observed answering successfully. Probes run against the lab
 * environment on 2026-08-26 returned `302 -> /auth/auth/logout` both without a
 * token and with an invalid one, contradicting the documented
 * `401 MISSING_TOKEN` / `403 TOKEN_EXPIRED` JSON errors. The endpoint also
 * sends no CORS headers, which is why this client runs server-side only.
 *
 * Consequence: everything in this file is an *expectation*, not a measurement.
 * `contractMatched` in the diagnostics exists precisely so a probe can report
 * "Atlas answered, but not in this shape" instead of pretending it did.
 */

import { z } from 'zod';

/**
 * Partner identity as documented. Kept strict: these are the fields the login
 * flow authorizes on, so a missing one must surface as a contract mismatch
 * rather than being silently defaulted.
 */
export const AtlasPartnerSchema = z
  .object({
    name: z.string().min(1),
    email: z.string().min(1),
    muviUuid: z.string(),
    partnerId: z.string().min(1),
  })
  .passthrough();

/**
 * Movie entries are deliberately loose. The documented shape has ten fields;
 * authorization depends on none of them. Requiring them all would let one
 * missing movie attribute block a login that is otherwise legitimate, so only
 * "is an object" is enforced and the sample extraction below reads defensively.
 */
export const AtlasMovieSchema = z.object({}).passthrough();

/**
 * `partner` is nullable on purpose, and it is not a shrug.
 *
 * The account available for the real test is an *administrator* account, and
 * the endpoint is scoped per partner - an admin may legitimately have no
 * `partnerId`. Keeping `partner` optional lets the diagnostics separate three
 * outcomes that would otherwise collapse into one "it didn't work":
 *
 *   1. works           -> contractMatched: true,  partner: {...}
 *   2. broken upstream -> contractMatched: false (non-2xx, or a body in another shape)
 *   3. not a partner   -> contractMatched: true,  partner: null, atlasStatus: 200
 *
 * A partner object that is *present but malformed* still fails the parse, and
 * so lands in case 2 - which is right: that is a contract mismatch, not an
 * account without a partner id.
 */
export const AtlasMoviesResponseSchema = z
  .object({
    status: z.literal('ok'),
    data: z
      .object({
        partner: AtlasPartnerSchema.nullable().optional(),
        movies: z.array(AtlasMovieSchema),
      })
      .passthrough(),
  })
  .passthrough();

export type AtlasPartner = z.infer<typeof AtlasPartnerSchema>;
export type AtlasMoviesResponse = z.infer<typeof AtlasMoviesResponseSchema>;

// ============================================================================
// CONTRACT A - request / response of POST /api/auth/atlas/session
// ============================================================================

export const AtlasSessionRequestSchema = z
  .object({
    token: z.string().min(1, 'token required'),
    mode: z.enum(['probe', 'login']),
  })
  .strict();

export type AtlasSessionRequest = z.infer<typeof AtlasSessionRequestSchema>;

/**
 * Where the exchange broke. Mandatory on every error response.
 *
 * The three authorization stages are deliberately separate rather than one
 * "rejected", because they have three different next steps:
 *
 *   - `no_partner`: Atlas authenticated the token fine, but the account has no
 *     partner attached (the account we have for the first real test is an
 *     administrator one). Fix: ask for a producer account. NOT a broken contract.
 *   - `disabled`: the environment kill switch is off. Fix: set ATLAS_LOGIN_ENABLED.
 *   - `allowlist`: this partner is simply not on the list. Fix: add the id.
 *
 * `rate_limited` is an addition to the taxonomy T0 defined. The endpoint is
 * unauthenticated and now carries a limiter, and the contract's own hard rule
 * is that EVERY error carries a stage - so returning the house
 * `{ error, code: 'RATE_LIMITED' }` shape here would have broken the envelope
 * that T2 parses. One extra enum value is the smaller deviation.
 */
export type AtlasSessionStage =
  | 'input'
  | 'rate_limited'
  | 'atlas_call'
  | 'contract'
  | 'no_partner'
  | 'disabled'
  | 'allowlist'
  | 'session';

export interface AtlasDiagnostics {
  /** The exact URL that was called. */
  atlasUrlTried: string;
  /** HTTP status Atlas returned. 0 when the request never completed. */
  atlasStatus: number;
  /** Did the body match the documented shape above? */
  contractMatched: boolean;
  partner: {
    name: string;
    email: string;
    muviUuid: string;
    partnerId: string;
  } | null;
  movieCount: number;
  /** At most 3 entries. */
  movieSample: Array<{ title: string; muviUuid: string }>;
  /** Top-level keys of whatever arrived. Empty when the body was not a JSON object. */
  responseShapeKeys: string[];
}

export type AtlasSessionResponse =
  | { ok: true; diagnostics: AtlasDiagnostics }
  | { ok: true; redirectTo: '/films' }
  | {
      ok: false;
      stage: AtlasSessionStage;
      message: string;
      diagnostics?: AtlasDiagnostics;
    };

/**
 * Pull a display sample out of loosely-typed movie entries.
 *
 * Non-string or missing fields become '' rather than throwing: the sample is
 * diagnostic output, and losing a title must not turn into a 500.
 */
export function toMovieSample(
  movies: Array<Record<string, unknown>>
): Array<{ title: string; muviUuid: string }> {
  return movies.slice(0, 3).map((movie) => ({
    title: typeof movie.title === 'string' ? movie.title : '',
    muviUuid: typeof movie.muviUuid === 'string' ? movie.muviUuid : '',
  }));
}
