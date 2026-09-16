/**
 * Shared vocabulary for the Atlas Console handshake.
 *
 * Everything here is pure and isomorphic: the server component uses it to
 * resolve the allowlist, the inline pre-paint script embeds the same values,
 * and the client view uses it to classify what arrived.
 *
 * Contract B (producer: Crazy Cake / Atlas Console, consumer: this page):
 *   { type: 'ATLAS_AUTH', token: string, partner?: { name: string, email: string } }
 *
 * `partner` is optional, and that is not a courtesy — it is what Console does.
 * Measured on 2026-08-28 against the deployed production bundle
 * (`dashboard.pijamafilms.com/resources/entry.js?v=d4c06ad`): `openMarketingPortal`
 * fetches `/partners/external-token` and posts `{ type: 'ATLAS_AUTH', token }`,
 * full stop. It never sends a partner. This file used to document and enforce it
 * as required, so a perfectly good handoff failed validation and the panel
 * reported a working SSO as a broken envelope.
 *
 * When it *is* present it is untrusted client data from a `postMessage`, so it is
 * strictly informational: it labels a row in the diagnostics panel and nothing
 * else. The authoritative partner identity comes from the server, in the
 * `/movies/by-partner` response that `POST /api/auth/atlas/session` reads (see
 * `AtlasDiagnostics.partner` below — a different field, from a source we trust).
 * Nothing in the authorization path may ever read the envelope's copy.
 */
import { z } from 'zod';
// The type module, not the `@/lib/atlas` barrel: the barrel re-exports
// `client.ts`, which is server code. `import type` erases at compile time and
// would not have pulled it in anyway, but pointing at the type module removes
// the question instead of relying on nobody turning this into a value import.
import type { AtlasSessionStage } from '@/lib/atlas/types';

/** Global the pre-paint inline script installs on `window`. */
export const ATLAS_BRIDGE_GLOBAL = '__atlasAuthBridge';

/** Envelope type Atlas Console posts to us. */
export const ATLAS_MESSAGE_TYPE = 'ATLAS_AUTH';

/** Envelope type we post back to `window.opener` so Console can stop waiting. */
export const PROMOTE_READY_TYPE = 'PROMOTE_READY';

/** How long we wait for a postMessage before calling it a no-show. */
export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 20_000;

/** Characters of the token we are allowed to show. A JWT header prefix is not a secret. */
export const TOKEN_PREFIX_LENGTH = 6;

/** Contract A endpoint (producer: the server-Atlas domain). */
export const ATLAS_SESSION_ENDPOINT = '/api/auth/atlas/session';

/** Crazy Cake's production Atlas Console. The origin the real handshake comes from. */
export const ATLAS_PRODUCTION_ORIGIN = 'https://dashboard.pijamafilms.com';

/** Crazy Cake's testing Atlas Console. A third party's test environment. */
export const ATLAS_LAB_ORIGIN = 'https://dashboard-lab.pijamafilms.com';

/**
 * Fallback allowlist, used only when `NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS` yields
 * nothing usable.
 *
 * Why this is a per-environment list read from an env var and not a literal
 * compared inline: Crazy Cake's own sample code validates against the *lab*
 * origin as a hardcoded string. Copying that shape rejects the production
 * handshake, which is the failure this project exists to prevent. The env var
 * is what lets an environment be re-pointed without a code change; this fallback
 * only keeps an unset variable from silently rejecting Atlas altogether. When it
 * is in use the panel says so, because "the default saved us" and "the variable
 * is configured" are different facts and must not look the same on screen.
 *
 * The fallback narrows in production, and that asymmetry is the point. An absent
 * variable must not make a working SSO look broken — but it also must not quietly
 * admit a third party's *testing* console into our production sign-in. Outside
 * production nothing is lost by accepting both; inside it, the lab origin buys
 * nothing and widens the surface, so it is not there.
 *
 * `nodeEnv` is a parameter rather than a read of `process.env` so this stays a
 * pure function: a test that flips the environment after import still exercises
 * it, instead of passing because a value was captured at module load.
 */
export function defaultAllowedOrigins(nodeEnv: string | undefined): string[] {
  return nodeEnv === 'production'
    ? [ATLAS_PRODUCTION_ORIGIN]
    : [ATLAS_PRODUCTION_ORIGIN, ATLAS_LAB_ORIGIN];
}

/**
 * `partner` is `.optional()` and deliberately *not* `.nullable()` or loosened to
 * `z.unknown()`.
 *
 * Optional, because Console omits the key entirely (see the contract note above).
 * Still strictly shaped when present, because "optional" must not become "any
 * object shape is fine": a `partner` of `"texto"` or `{ name: 123 }` is a real
 * contract violation worth reporting, and letting it through would put
 * `123 <undefined>` on the diagnostics panel — a fabricated identity, which is
 * exactly the kind of quiet nonsense this panel exists to expose.
 *
 * Not nullable, because `undefined` and `null` are different claims from the
 * producer: "I did not send this" versus "I looked and there is none". The panel
 * renders them differently, so the schema keeps them apart instead of flattening
 * both into one silent blank.
 */
export const atlasAuthEnvelopeSchema = z.object({
  type: z.literal(ATLAS_MESSAGE_TYPE),
  token: z.string().min(1),
  partner: z
    .object({
      name: z.string(),
      email: z.string(),
    })
    .optional(),
});

export type AtlasAuthEnvelope = z.infer<typeof atlasAuthEnvelopeSchema>;

/** One message as the pre-paint script recorded it. */
export interface BridgeMessage {
  origin: string;
  type: string;
  allowed: boolean;
  receivedAt: number;
  /** True when the message landed before the view mounted and had to be buffered. */
  buffered: boolean;
  /** Raw `event.data`. Holds the token, so it never reaches state or the DOM. */
  payload: unknown;
}

/** Shape of the global the inline script installs. Implemented in `bridge-script.ts`. */
export interface AtlasBridge {
  version: number;
  startedAt: number;
  allowedOrigins: string[];
  buffer: BridgeMessage[];
  ignoredCount: number;
  readySignal: {
    hasOpener: boolean;
    postedTo: string[];
    failedFor: string[];
    at: number;
  };
  subscribe(listener: (message: BridgeMessage) => void): () => void;
  /**
   * Removes the token from a message the view has already consumed. Optional so
   * a page served before this existed still type-checks against the global.
   */
  scrub?(message: BridgeMessage): void;
}

export function readBridge(): AtlasBridge | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as Record<string, unknown>)[ATLAS_BRIDGE_GLOBAL];
  if (!candidate || typeof candidate !== 'object') return null;
  const bridge = candidate as Partial<AtlasBridge>;
  return typeof bridge.subscribe === 'function' ? (bridge as AtlasBridge) : null;
}

/**
 * An origin literal is `scheme://host[:port]` and nothing else. Wildcards, paths
 * and credentials are rejected rather than normalised away: a silently repaired
 * allowlist entry is how a too-wide match gets shipped.
 */
export function isValidOriginLiteral(candidate: string): boolean {
  if (!candidate || candidate.includes('*') || candidate.includes(' ')) return false;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password) return false;
  return url.origin === candidate;
}

/**
 * Parses `NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS`. Per-environment by construction:
 * the lab origin is never hardcoded, so promoting the build does not carry the
 * lab allowlist into production.
 */
export function parseAllowedOrigins(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (isValidOriginLiteral(trimmed)) seen.add(trimmed);
  }
  return Array.from(seen);
}

/** Exact match only. No prefix matching, no wildcards, no reflecting `event.origin`. */
export function isOriginAllowed(origin: string, allowedOrigins: readonly string[]): boolean {
  return allowedOrigins.includes(origin);
}

export interface TokenFingerprint {
  present: boolean;
  length: number;
  prefix: string;
}

/** The only representation of the token allowed on screen or in a log. */
export function describeToken(token: unknown): TokenFingerprint {
  if (typeof token !== 'string' || token.length === 0) {
    return { present: false, length: 0, prefix: '' };
  }
  return {
    present: true,
    length: token.length,
    prefix: token.slice(0, TOKEN_PREFIX_LENGTH),
  };
}

export function formatTokenFingerprint(fingerprint: TokenFingerprint): string {
  if (!fingerprint.present) return 'absent';
  return `present · ${fingerprint.length} chars · starts with "${fingerprint.prefix}…"`;
}

/** Only same-site absolute paths. Blocks `//evil.com` and scheme-bearing targets. */
export function isSafeRedirect(target: unknown): target is string {
  if (typeof target !== 'string') return false;
  if (!target.startsWith('/')) return false;
  if (target.startsWith('//') || target.startsWith('/\\')) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Contract A — POST /api/auth/atlas/session                           */
/* ------------------------------------------------------------------ */

export type AtlasSessionMode = 'probe' | 'login';

/**
 * The stage taxonomy is **derived from the server domain's type**, not copied.
 *
 * This used to be a hand-maintained duplicate of `AtlasSessionStage`, and it fell
 * behind three times in a single day. The failure mode was not a crash: a
 * legitimate stage rendered as though the server were violating the contract,
 * which is the exact false negative this project exists to prevent.
 *
 * Now `STAGE_CONCLUSION` is keyed by the imported type, so adding a stage in
 * `src/lib/atlas/types.ts` breaks *this* build until someone writes what it means.
 * Divergence stopped depending on anyone remembering.
 *
 * The runtime array below still has to exist — a type cannot validate a string
 * that arrives at runtime — and it is annotated with the derived type so an entry
 * that is not a real stage fails to compile. What the type cannot catch is the
 * array being *short*, so a test asserts it holds exactly the keys of
 * `STAGE_CONCLUSION`. Type covers one direction, test covers the other.
 *
 * And `describeStage` still degrades gracefully, because a deployed server can be
 * newer than the bundle running in someone's browser.
 */
export type AtlasErrorStage = AtlasSessionStage;

export const ATLAS_ERROR_STAGES: readonly AtlasErrorStage[] = [
  'input',
  'rate_limited',
  'config',
  'atlas_call',
  'contract',
  'no_partner',
  'disabled',
  'allowlist',
  'session',
];

/**
 * What each stage means for the question this project exists to answer: is the
 * SSO working? Written as a conclusion rather than an error code, because the
 * person reading this panel is deciding whether to ship, not debugging a trace.
 */
export const STAGE_CONCLUSION: Record<AtlasErrorStage, string> = {
  input: 'Our own request was malformed. This is a bug on our side, not a problem with the integration.',
  rate_limited:
    'Too many attempts in a short window — wait a minute and try again. The integration is fine; this is our own limiter.',
  config:
    'This deployment is missing its own configuration (ATLAS_API_BASE_URL), so nothing was sent anywhere. Set the variable and try again — this result says nothing about the token or about the integration.',
  // The no-diagnostics default, and it claims nothing about reachability on
  // purpose: without a status, whether Atlas answered is not visible from here.
  // With diagnostics the text is chosen per status — see `atlasCallConclusion`.
  atlas_call:
    'The call to Atlas failed, and this response carries no diagnostics, so whether Atlas was reached is not visible from here. Nothing can be concluded about the token or the account.',
  contract:
    'Atlas answered, so the token was delivered, but the response does not match what Crazy Cake documented.',
  no_partner:
    'The SSO works. The token was accepted by Atlas and identified the account — that account simply has no partner attached, which is expected for an administrator rather than a producer.',
  disabled: 'Sign-in is switched off by configuration. The handshake itself was not the problem.',
  allowlist: 'The partner was identified but is not on the list allowed to sign in.',
  session: 'Everything up to the last step worked; issuing our own session cookie failed.',
};

/**
 * `no_partner` is a finding, not a failure: it is the most likely outcome of the
 * first real test, because the account we have is an administrator's. Showing it
 * in red would report a working SSO as broken.
 */
export function isInformationalStage(stage: string | undefined): boolean {
  return stage === 'no_partner';
}

export function stageConclusion(stage: string | undefined): string | null {
  if (!stage) return null;
  return (STAGE_CONCLUSION as Record<string, string>)[stage] ?? null;
}

/**
 * The conclusion for `atlas_call`, which is the one stage whose meaning cannot be
 * written down in advance.
 *
 * The stage covers two situations that share nothing: the request never completed,
 * and Atlas answered something that was not a 2xx. The fixed text used to assert
 * the first for both, so on 2026-09-16 a real run showed
 *
 *   banner  "Atlas could not be reached at all. Nothing can be concluded…"
 *   message "Atlas did not answer with 2xx: HTTP 401"
 *
 * on the same screen. Both sentences passed their own tests. Worse than the
 * contradiction: that 401 carried `INVALID_TOKEN`, so the token HAD been evaluated
 * — the banner's "nothing can be concluded" hid the finding the run existed to
 * produce, which was that the lab and production environments do not share a
 * signing key.
 *
 * So this states only what is observable — reached or not, and with what status —
 * and deliberately makes no claim about the token. The per-status reading lives in
 * `describeAtlasOutcome`, which already weighs each status separately; duplicating
 * it here is how the two got to disagree in the first place.
 *
 * Three cases, not two. The first draft of this fix collapsed "no diagnostics" into
 * "never completed", which is the same overclaim pointed the other way: with no
 * status, whether Atlas answered is exactly what we do not know.
 */
export function atlasCallConclusion(diagnostics: AtlasDiagnostics | undefined): string {
  const status = diagnostics?.atlasStatus;

  if (status === undefined) {
    return STAGE_CONCLUSION.atlas_call;
  }

  if (status === 0) {
    return 'The call to Atlas never completed — DNS, timeout or a refused connection. Nothing can be concluded about the token or the account.';
  }

  return `Atlas was reached and answered HTTP ${status}, which is not a 2xx, so no Contract C response was produced. What that implies for the token depends on the status — see "What Atlas did" below.`;
}

export interface StageDescription {
  label: string;
  /** What to show under "what this means". Never empty when there is anything to say. */
  meaning: string | null;
  known: boolean;
}

/**
 * Turns whatever `stage` arrived into something readable.
 *
 * The failure mode being avoided: this contract has grown three times in a day,
 * and an unrecognised value used to render as "not a Contract A stage" — which
 * reads as *the server is broken* when the truth is *this page is older than the
 * server*. An unknown stage now degrades to the server's own message.
 */
export function describeStage(
  stage: string | undefined,
  message: string | undefined,
  diagnostics?: AtlasDiagnostics
): StageDescription {
  if (!stage) {
    return {
      label: 'MISSING — Contract A requires a stage on every error',
      meaning: message ?? null,
      known: false,
    };
  }

  if (stage === 'atlas_call') {
    return { label: stage, meaning: atlasCallConclusion(diagnostics), known: true };
  }

  const conclusion = (STAGE_CONCLUSION as Record<string, string>)[stage];
  if (conclusion) return { label: stage, meaning: conclusion, known: true };

  return {
    label: `${stage} (newer than this page — showing the server's own message)`,
    meaning: message ?? 'The server sent no message alongside it.',
    known: false,
  };
}

/**
 * Reads the Atlas half of the diagnostics and says what to do about it.
 *
 * The measured behaviour of the real Atlas is a `302`: every unauthenticated
 * route there redirects to `/auth/auth/logout` rather than answering the `401`
 * its documentation promises. Rendering that as a bare number leaves the reader
 * to guess; naming it is the difference between a diagnosis and a status code.
 *
 * **Every branch here reports what was observed and never why.** That rule is not
 * stylistic. This text renders in the "What Atlas did" row of `/auth`, and that
 * screen gets screenshotted and sent to Crazy Cake — so a sentence here is a claim
 * we make to the counterparty about their system.
 *
 * Two branches used to break the rule in opposite directions. The 3xx one said
 * "either the token was rejected or ATLAS_API_BASE_URL points at the wrong host",
 * and the non-contract one opened with "Atlas answered normally, so the token was
 * accepted". Neither is observable from here: a redirect and a 200-with-an-error-body
 * both tell us what came back, never whether Atlas examined the credential before
 * producing it.
 *
 * What is measured, as of 2026-08-28: the same token that gets a 302 from our server
 * (Bearer only) returns 200 with a well-formed Contract C body from a browser
 * carrying session cookie + Bearer. So the token is valid and the route works, and
 * the only variable that moves the result is the cookie. That still does not reveal
 * whether the token is read before the redirect — which is the whole reason no
 * branch may assign it a cause, in either direction. An unfounded exoneration is not
 * better than an unfounded accusation; it is the same error wearing a friendlier face.
 */
export function describeAtlasOutcome(diagnostics: AtlasDiagnostics | undefined): string | null {
  if (!diagnostics) return null;
  const status = diagnostics.atlasStatus;
  if (status === undefined) return null;

  if (status === 0) {
    return 'The request to Atlas never completed — DNS, timeout or a refused connection. Nothing can be concluded about the token.';
  }
  if (status >= 300 && status < 400) {
    return `Atlas redirected (HTTP ${status}) instead of answering, so no Contract C body was produced and the call never reached the endpoint that returns one. That is what every unauthenticated request looks like there. Nothing follows from it about the token or the account — whether Atlas examined the token before redirecting is not visible from our side. Check whether ATLAS_API_BASE_URL points at the right host and whether the call carries the credentials Atlas expects.`;
  }
  if (status === 401 || status === 403) {
    return 'Atlas rejected the token outright.';
  }
  if (status >= 500) {
    return 'Atlas answered with a server error. The token cannot be judged from this.';
  }
  if (diagnostics.contractMatched === false) {
    return `Atlas answered HTTP ${status}, but the body does not match Contract C. What that means for the token is not established either way — a success status carrying an unexpected body is not proof the credential was accepted. Compare the response keys below with what Crazy Cake documented.`;
  }
  return null;
}

export type NonContractBodyKind = 'not-json' | 'middleware' | 'json-wrong-shape';

/**
 * Explains a response that never became a Contract A envelope.
 *
 * These three cases send a reader to three different places, and collapsing them
 * into "the endpoint is missing or returned non-JSON" actively misleads: the
 * session middleware answers `401 {"error":"Unauthorized"}`, which is valid JSON
 * from a route that exists. Saying "missing endpoint" there points at the wrong
 * file entirely.
 */
export function describeNonContractBody(args: {
  httpStatus: number | null;
  bodyWasJson: boolean;
  bodyKeys: string[];
}): { kind: NonContractBodyKind; message: string } {
  const status = args.httpStatus ?? 0;
  const shown = args.httpStatus === null ? '?' : String(args.httpStatus);

  if (!args.bodyWasJson) {
    return {
      kind: 'not-json',
      message: `HTTP ${shown} with a body that is not JSON. A missing route is the usual cause — Next answers one with an HTML 404.`,
    };
  }

  if ((status === 401 || status === 403) && args.bodyKeys.includes('error')) {
    return {
      kind: 'middleware',
      message: `HTTP ${shown} with {"error": …}. That is the session middleware refusing the request before the route ran, not ${ATLAS_SESSION_ENDPOINT} itself — the route exists but is not on the public list.`,
    };
  }

  return {
    kind: 'json-wrong-shape',
    message: `HTTP ${shown} with valid JSON that is not a Contract A envelope (keys: ${
      args.bodyKeys.length > 0 ? args.bodyKeys.join(', ') : 'none'
    }). The endpoint answered; its response shape is wrong.`,
  };
}

export interface AtlasDiagnostics {
  atlasUrlTried?: string;
  atlasStatus?: number;
  contractMatched?: boolean;
  partner?: { name?: string; email?: string; muviUuid?: string; partnerId?: string } | null;
  movieCount?: number;
  movieSample?: Array<{ title?: string; muviUuid?: string }>;
  responseShapeKeys?: string[];
}

const diagnosticsSchema = z
  .object({
    atlasUrlTried: z.string().optional(),
    atlasStatus: z.number().optional(),
    contractMatched: z.boolean().optional(),
    partner: z
      .object({
        name: z.string().optional(),
        email: z.string().optional(),
        muviUuid: z.string().optional(),
        partnerId: z.string().optional(),
      })
      .nullable()
      .optional(),
    movieCount: z.number().optional(),
    movieSample: z
      .array(z.object({ title: z.string().optional(), muviUuid: z.string().optional() }))
      .optional(),
    responseShapeKeys: z.array(z.string()).optional(),
  })
  .passthrough();

const sessionResponseSchema = z
  .object({
    ok: z.boolean(),
    redirectTo: z.string().optional(),
    stage: z.string().optional(),
    message: z.string().optional(),
    diagnostics: diagnosticsSchema.optional(),
  })
  .passthrough();

export interface ParsedSessionResponse {
  ok: boolean;
  redirectTo?: string;
  /** Stage as reported. Kept as a plain string so an unknown value still shows. */
  stage?: string;
  /** True when `stage` is one of the five the contract defines. */
  stageIsContractual: boolean;
  message?: string;
  diagnostics?: AtlasDiagnostics;
}

/**
 * Reads Contract A's body without ever throwing. If the server domain ships a
 * shape we do not recognise, that is a finding to display, not a crash.
 */
export function parseSessionResponse(body: unknown): ParsedSessionResponse | null {
  const parsed = sessionResponseSchema.safeParse(body);
  if (!parsed.success) return null;
  const { ok, redirectTo, stage, message, diagnostics } = parsed.data;
  return {
    ok,
    redirectTo,
    stage,
    stageIsContractual:
      typeof stage === 'string' &&
      (ATLAS_ERROR_STAGES as readonly string[]).includes(stage),
    message,
    diagnostics: diagnostics as AtlasDiagnostics | undefined,
  };
}
