import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, setSessionCookie } from '@/lib/auth/session';
import { createLogger } from '@/lib/logger';
import { getOrCreatePartner } from '@/models/partner';
import {
  AtlasSessionRequestSchema,
  AtlasMoviesResponseSchema,
  describeToken,
  fetchPartnerMovies,
  getAtlasAllowedPartnerIds,
  getAtlasMoviesUrl,
  headerSafetyProblem,
  isAtlasLoginEnabled,
  isPartnerAllowed,
  callerKey,
  consumeAtlasSessionQuota,
  toMovieSample,
  type AtlasCallResult,
  type AtlasDiagnostics,
  type AtlasMoviesResponse,
  type AtlasSessionStage,
} from '@/lib/atlas';

const log = createLogger('atlas-session');

/**
 * POST /api/auth/atlas/session
 *
 * Exchanges an Atlas Console JWT for a Pijama session (`mode: 'login'`), or
 * reports what Atlas answered without touching any state (`mode: 'probe'`).
 *
 * ## Reachability
 *
 * `/api/auth/atlas/` is listed in `PUBLIC_ROUTES` in `src/middleware.ts`. It has
 * to be: the caller is the `/auth` landing page, which by definition has no
 * session cookie yet. Leaving it out makes the middleware answer 401 before
 * this handler ever runs, and the 401 says nothing about the middleware.
 *
 * ## Two modes, one reason
 *
 * The upstream Atlas contract has never been observed working (see
 * `src/lib/atlas/types.ts`). `probe` exists so a human with a real token can
 * find out what Atlas actually returns - status, top-level keys, whether the
 * documented shape matched - without minting a session off an unverified
 * response. `login` is the same call with fail-closed authorization on top.
 *
 * ## Hard rules
 *
 * - The token is never logged, echoed or stored. Length and a 6-char prefix only.
 * - The JWT is opaque: it is never decoded to authorize. Atlas' answer is the authority.
 * - `probe` never sets a cookie and never creates a partner.
 * - The allowlist is fail-closed. Empty or absent rejects everyone.
 */
export async function POST(req: NextRequest) {
  // --------------------------------------------------------------------------
  // stage: rate_limited
  //
  // First, before parsing anything: a flood of malformed bodies costs the same
  // as a flood of valid ones. The limiter is a noise buffer for an endpoint
  // that must stay unauthenticated and public - never an authorization
  // control. That job belongs to the fail-closed allowlist below.
  // --------------------------------------------------------------------------
  const quota = consumeAtlasSessionQuota(callerKey(req.headers));

  if (!quota.allowed) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'rate_limited' as const,
        message: `Too many Atlas session requests. Retry in ${quota.retryAfterSeconds}s.`,
      },
      { status: 429, headers: { 'Retry-After': String(quota.retryAfterSeconds) } }
    );
  }

  // --------------------------------------------------------------------------
  // stage: input
  // --------------------------------------------------------------------------
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'input', 'Request body is not valid JSON');
  }

  const parsed = AtlasSessionRequestSchema.safeParse(body);

  if (!parsed.success) {
    // Built from issue paths rather than the raw Zod message so no submitted
    // value - the token above all - can ride out in the error text.
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`)
      .join('; ');

    return errorResponse(400, 'input', `Invalid request: ${detail}`);
  }

  const { token, mode } = parsed.data;
  const fingerprint = describeToken(token);

  log.info(
    { mode, tokenLength: fingerprint.length, tokenPrefix: fingerprint.prefix },
    'Atlas session exchange requested'
  );

  // A token that cannot go in an HTTP header is rejected HERE, as input, before
  // anything is sent and before the login pre-flight below.
  //
  // REGRESSION, measured 2026-08-28: a user pasted a JavaScript fragment with
  // newlines into the token field. `fetch` threw
  // `Headers.append: "Bearer <the whole pasted value>" is an invalid header
  // value`, the catch in the client turned that into a transport failure, and
  // this route answered `502 stage:'atlas_call'` - which /auth renders as
  // "Atlas could not be reached at all". We blamed the third party whose SSO
  // this project exists to evaluate for a hole in our own validation, and
  // echoed the pasted value back in the message while doing it.
  //
  // The check is physical only - see `headerSafetyProblem`. The token stays
  // opaque: its validity is Atlas' answer to give, never our inference from its
  // shape.
  const headerProblem = headerSafetyProblem(token);

  if (headerProblem) {
    log.warn(
      { mode, tokenLength: fingerprint.length, tokenPrefix: fingerprint.prefix },
      'Atlas session rejected at input: the token cannot travel in an HTTP header'
    );

    return errorResponse(400, 'input', headerProblem);
  }

  // --------------------------------------------------------------------------
  // stage: allowlist (pre-flight)
  //
  // Checked before calling Atlas on purpose. If login can never succeed, there
  // is no reason to forward the token upstream at all, and the caller gets the
  // real reason instead of an upstream failure that hides it.
  // --------------------------------------------------------------------------
  if (mode === 'login') {
    if (!isAtlasLoginEnabled()) {
      log.warn({ mode }, 'Atlas login rejected: ATLAS_LOGIN_ENABLED is not "true"');

      // Its own stage, not `allowlist`: an environment kill switch and an
      // unlisted partner are two different problems with two different fixes,
      // and a stage is read where a message has to be parsed.
      return errorResponse(
        403,
        'disabled',
        'Atlas login is disabled on this environment (ATLAS_LOGIN_ENABLED is not "true")'
      );
    }

    if (getAtlasAllowedPartnerIds().length === 0) {
      // Fail-closed. An empty allowlist must never be read as "everyone":
      // getFilms() does not filter by partner, so one unintended session sees
      // the entire catalogue.
      log.warn({ mode }, 'Atlas login rejected: allowlist is empty or absent');

      return errorResponse(
        403,
        'allowlist',
        'Atlas login allowlist is empty or absent (ATLAS_LOGIN_ALLOWED_PARTNER_IDS)'
      );
    }
  }

  // --------------------------------------------------------------------------
  // The upstream call. What counts as failure from here on depends on the mode.
  // --------------------------------------------------------------------------
  const call = await fetchPartnerMovies(token);

  // Structural guarantee, not a second validator: `stage: 'atlas_call'` must
  // never carry a fault of ours. The client refuses a header-unsafe token on
  // its own (it owns the header), and if it ever did so for a token the check
  // above let through, that is still `input` - the request was never made, so
  // nothing is known about Atlas. Unreachable while both checks share
  // `headerSafetyProblem`; cheap insurance if one of them moves.
  if (call.inputError) {
    return errorResponse(400, 'input', call.inputError);
  }

  const shape = AtlasMoviesResponseSchema.safeParse(call.json);
  // A contract only counts as matched when Atlas actually answered 2xx: a
  // documented-looking body attached to a 302 or a 500 is not a usable answer.
  const contract = call.ok && shape.success ? shape.data : null;
  const diagnostics = diagnosticsFrom(call, contract);

  // --------------------------------------------------------------------------
  // mode: probe - reports, does not judge
  //
  // Any HTTP response from Atlas is a reportable result, including a 302. The
  // only measurement ever taken against the real Atlas IS a 302, so answering
  // that with a 502 and `ok:false` would bury the diagnostics - the one thing
  // the probe exists to produce - inside an error envelope, and the real test
  // would read as "it failed" when it had in fact measured something.
  //
  // `stage: 'atlas_call'` in probe mode therefore means one thing only: Atlas
  // produced no HTTP response at all (DNS, timeout, refused connection, or no
  // base URL configured).
  // --------------------------------------------------------------------------
  if (mode === 'probe') {
    if (call.status === 0) {
      return errorResponse(
        502,
        'atlas_call',
        `Atlas produced no HTTP response: ${call.networkError ?? 'unknown transport failure'}`,
        diagnostics
      );
    }

    log.info(
      {
        mode,
        atlasStatus: diagnostics.atlasStatus,
        contractMatched: diagnostics.contractMatched,
        responseShapeKeys: diagnostics.responseShapeKeys,
        redirectedTo: call.redirectedTo,
      },
      'Atlas probe completed'
    );

    return NextResponse.json({ ok: true, diagnostics }, { status: 200 });
  }

  // --------------------------------------------------------------------------
  // stage: atlas_call - login DOES judge, so a non-2xx stops here
  // --------------------------------------------------------------------------
  if (!call.ok) {
    const because = call.networkError
      ? `transport failure (${call.networkError})`
      : `HTTP ${call.status}${call.redirectedTo ? ` redirecting to ${call.redirectedTo}` : ''}`;

    return errorResponse(502, 'atlas_call', `Atlas did not answer with 2xx: ${because}`, diagnostics);
  }

  // --------------------------------------------------------------------------
  // stage: contract
  // --------------------------------------------------------------------------
  if (!contract) {
    return errorResponse(
      502,
      'contract',
      `Atlas answered ${call.status} but the body does not match the documented contract ` +
        `(body kind: ${call.bodyKind}, top-level keys: ${
          call.responseShapeKeys.length > 0 ? call.responseShapeKeys.join(', ') : 'none'
        })`,
      diagnostics
    );
  }

  const partner = contract.data.partner ?? null;

  if (!partner) {
    // Its own stage. The envelope matched, so the contract is NOT broken: Atlas
    // authenticated this token and told us, correctly, that no partner hangs
    // off it - which is what an administrator account looks like. Collapsing
    // this into `contract` would send whoever reads it to Crazy Cake, when the
    // actual fix is to ask JP for a producer account.
    log.warn({ mode }, 'Atlas login rejected: the token authenticates an account with no partner');

    // 422, not 403: the request was well-formed and the caller authenticated
    // fine. What is unusable is the content Atlas returned for it.
    return errorResponse(
      422,
      'no_partner',
      'Atlas answered in the documented shape but this account has no partner associated ' +
        '(no partnerId to authorize against - an administrator account looks like this). ' +
        'The Atlas contract is working; this token just does not belong to a partner.',
      diagnostics
    );
  }

  // --------------------------------------------------------------------------
  // stage: allowlist (identity)
  // --------------------------------------------------------------------------
  if (!isPartnerAllowed(partner.partnerId)) {
    log.warn(
      { mode, partnerId: partner.partnerId },
      'Atlas login rejected: partner is not on the allowlist'
    );

    return errorResponse(
      403,
      'allowlist',
      `Partner ${partner.partnerId} is not on the Atlas login allowlist`,
      diagnostics
    );
  }

  // --------------------------------------------------------------------------
  // stage: session
  // --------------------------------------------------------------------------
  try {
    // `session.partnerId` is the *external* partner id everywhere in this app
    // (see getPartnerByPartnerId callers), so Atlas' partnerId goes in as-is;
    // the upsert only guarantees the local record exists.
    await getOrCreatePartner(partner.partnerId, partner.name);

    const sessionToken = await createSessionToken({
      // Synthetic uid: this identity came from Atlas, not from Firebase Auth.
      // Nothing downstream resolves it against Firebase - the middleware only
      // verifies the cookie signature.
      uid: `atlas:${partner.partnerId}`,
      email: partner.email,
      name: partner.name,
      partnerId: partner.partnerId,
    });

    await setSessionCookie(sessionToken);
  } catch (error) {
    log.error(
      { err: error, partnerId: partner.partnerId },
      'Atlas login failed while establishing the session'
    );

    return errorResponse(
      500,
      'session',
      'Could not establish a session for this partner',
      diagnostics
    );
  }

  log.info({ partnerId: partner.partnerId }, 'Atlas login succeeded');

  return NextResponse.json({ ok: true, redirectTo: '/films' }, { status: 200 });
}

/**
 * Contract A error envelope. `stage` is mandatory - it is what lets the caller
 * say *where* the exchange broke instead of "it failed".
 */
function errorResponse(
  status: number,
  stage: AtlasSessionStage,
  message: string,
  diagnostics?: AtlasDiagnostics
) {
  return NextResponse.json(
    diagnostics ? { ok: false, stage, message, diagnostics } : { ok: false, stage, message },
    { status }
  );
}

/**
 * Build the diagnostics block from the raw call plus the parsed contract when
 * it matched. Reports what arrived, never what was expected to arrive.
 */
function diagnosticsFrom(
  call: AtlasCallResult,
  contract: AtlasMoviesResponse | null
): AtlasDiagnostics {
  const movies = contract?.data.movies ?? [];

  return {
    atlasUrlTried: call.url || (getAtlasMoviesUrl() ?? ''),
    atlasStatus: call.status,
    contractMatched: contract !== null,
    partner: contract?.data.partner
      ? {
          name: contract.data.partner.name,
          email: contract.data.partner.email,
          muviUuid: contract.data.partner.muviUuid,
          partnerId: contract.data.partner.partnerId,
        }
      : null,
    movieCount: movies.length,
    movieSample: toMovieSample(movies as Array<Record<string, unknown>>),
    responseShapeKeys: call.responseShapeKeys,
  };
}
