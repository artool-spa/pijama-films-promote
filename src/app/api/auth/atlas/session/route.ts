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
  isAtlasLoginEnabled,
  isPartnerAllowed,
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

      return errorResponse(
        403,
        'allowlist',
        'Atlas login is disabled on this environment (ATLAS_LOGIN_ENABLED)'
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
  // stage: atlas_call
  // --------------------------------------------------------------------------
  const call = await fetchPartnerMovies(token);

  if (!call.ok) {
    const because = call.networkError
      ? `transport failure (${call.networkError})`
      : `HTTP ${call.status}${call.redirectedTo ? ` redirecting to ${call.redirectedTo}` : ''}`;

    return errorResponse(
      502,
      'atlas_call',
      `Atlas did not answer with 2xx: ${because}`,
      diagnosticsFrom(call, null)
    );
  }

  // --------------------------------------------------------------------------
  // stage: contract
  // --------------------------------------------------------------------------
  const shape = AtlasMoviesResponseSchema.safeParse(call.json);
  const contract = shape.success ? shape.data : null;
  const diagnostics = diagnosticsFrom(call, contract);

  if (mode === 'probe') {
    // A probe reports; it does not judge. `contractMatched: false` with a real
    // status and real top-level keys is the whole point of this mode, so a
    // shape mismatch is still a 200 here.
    log.info(
      {
        mode,
        atlasStatus: diagnostics.atlasStatus,
        contractMatched: diagnostics.contractMatched,
        responseShapeKeys: diagnostics.responseShapeKeys,
      },
      'Atlas probe completed'
    );

    return NextResponse.json({ ok: true, diagnostics }, { status: 200 });
  }

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
    // The envelope matched but carries no partner. That is the "this account is
    // not a partner" case (an Atlas admin account has no partnerId), not an
    // upstream breakage - and it is unauthorizable either way, so login stops.
    return errorResponse(
      502,
      'contract',
      'Atlas answered in the documented shape but returned no partner for this token ' +
        '(an administrator account has no partnerId to authorize against)',
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
