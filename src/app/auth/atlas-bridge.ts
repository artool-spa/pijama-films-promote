/**
 * Shared vocabulary for the Atlas Console handshake.
 *
 * Everything here is pure and isomorphic: the server component uses it to
 * resolve the allowlist, the inline pre-paint script embeds the same values,
 * and the client view uses it to classify what arrived.
 *
 * Contract B (producer: Crazy Cake / Atlas Console, consumer: this page):
 *   { type: 'ATLAS_AUTH', token: string, partner: { name: string, email: string } }
 */
import { z } from 'zod';

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

export const atlasAuthEnvelopeSchema = z.object({
  type: z.literal(ATLAS_MESSAGE_TYPE),
  token: z.string().min(1),
  partner: z.object({
    name: z.string(),
    email: z.string(),
  }),
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

export const ATLAS_ERROR_STAGES = [
  'input',
  'atlas_call',
  'contract',
  'allowlist',
  'session',
] as const;

export type AtlasErrorStage = (typeof ATLAS_ERROR_STAGES)[number];

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
