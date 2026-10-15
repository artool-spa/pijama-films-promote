/**
 * Console (Atlas) external API - the per-partner catalogue.
 *
 * Server-to-server, read-only, one bearer key that can see EVERY partner. That
 * last fact is the whole security story of this module: the key is not scoped,
 * so the only thing standing between a producer and the other 64 catalogues is
 * the `partnerId` we pass. Callers must therefore take it from the verified
 * session and from nowhere else - never from a query, body or route param.
 * Contract: docs/contracts/C2-external-partner-api.md.
 *
 * Configuration is read at call time, never at module load.
 * The key is never logged and never appears in an error message.
 */

import { z } from 'zod';
import { createLogger } from '@/lib/logger';

const log = createLogger('atlas-external');

/** Upstream call budget (ms). */
export const ATLAS_EXTERNAL_TIMEOUT_MS = 10_000;

// ============================================================================
// Errors
// ============================================================================

export type AtlasCatalogErrorCode =
  /** ATLAS_SERVER_API_KEY or the base URL is missing in this deployment. */
  | 'not_configured'
  /** The API rejected our key (401). A deployment problem, not the producer's. */
  | 'unauthorized'
  /** The partnerId we hold is not acceptable to the API (400). */
  | 'invalid_partner'
  /** The partner does not exist in Console (404). The catalogue is EMPTY, not global. */
  | 'partner_not_found'
  /** Network failure, timeout, 5xx, redirect. */
  | 'unavailable'
  /** The answer arrived but does not have the documented shape. */
  | 'bad_response';

/**
 * Internal error. `message` is safe to log; it never contains the key, a
 * header, or an upstream body. It is not meant to be shown to a producer.
 */
export class AtlasCatalogError extends Error {
  readonly code: AtlasCatalogErrorCode;

  constructor(code: AtlasCatalogErrorCode, message: string) {
    super(message);
    this.name = 'AtlasCatalogError';
    this.code = code;
  }
}

// ============================================================================
// Schemas - tolerant on purpose, see C2 "Differences from the documentation"
// ============================================================================

/** `"00:01:00"`, a number of seconds, or null. The doc says number; it is a string. */
const AssetDurationSchema = z.union([z.string(), z.number()]).nullish();

export const ExternalAssetSchema = z.object({
  type: z.string(),
  key: z.string().nullish(),
  url: z.string().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  duration: AssetDurationSchema,
});

/** `genre` is documented as string[] and arrives as a string; accept both. */
const GenreSchema = z
  .union([z.string(), z.array(z.string())])
  .nullish()
  .transform((value): string[] => {
    const parts = Array.isArray(value) ? value : (value ?? '').split(',');

    return parts.map((part) => part.trim()).filter((part) => part.length > 0);
  });

export const ExternalMovieSchema = z.object({
  _id: z.string(),
  muviContentUuid: z.string().min(1),
  originalTitle: z.string().nullish(),
  internationalTitle: z.string().nullish(),
  description: z.string().nullish(),
  genre: GenreSchema,
  year: z.number().nullish(),
  /** Minutes, integer. 0 happens. */
  duration: z.number().nullish(),
  /** May be "". */
  language: z.string().nullish(),
  ageRating: z.string().nullish(),
  price: z.number().nullish(),
  /** Always "" in practice: the real trailer is in `assets`. */
  trailerUrl: z.string().nullish(),
  directors: z.array(z.string()).nullish().transform((v) => v ?? []),
  /** May be empty. */
  cast: z.array(z.string()).nullish().transform((v) => v ?? []),
  publishedAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
  assets: z.array(ExternalAssetSchema).nullish().transform((v) => v ?? []),
});

export const ExternalPartnerSchema = z.object({
  partnerId: z.string().min(1),
  name: z.string(),
  /** Absent for some partners. */
  productionCompany: z.string().nullish(),
});

export const ExternalPartnerMoviesResponseSchema = z.object({
  status: z.string().optional(),
  data: z.object({
    partner: ExternalPartnerSchema,
    movies: z.array(ExternalMovieSchema),
  }),
});

export type ExternalAsset = z.infer<typeof ExternalAssetSchema>;
export type ExternalMovie = z.infer<typeof ExternalMovieSchema>;
export type ExternalPartner = z.infer<typeof ExternalPartnerSchema>;

export type PartnerCatalogue = {
  partner: ExternalPartner;
  movies: ExternalMovie[];
};

// ============================================================================
// Configuration (call time)
// ============================================================================

function readConfig(): { baseUrl: string; apiKey: string } {
  const apiKey = process.env.ATLAS_SERVER_API_KEY?.trim();
  const baseUrl = process.env.ATLAS_SERVER_API_BASE_URL?.trim().replace(/\/+$/, '');

  if (!apiKey || !baseUrl) {
    // Names which variable is missing, never what it holds. No fallback: without
    // the key there is no catalogue to show, and the global one is not a substitute.
    throw new AtlasCatalogError(
      'not_configured',
      `External partner API is not configured (missing ${[
        !apiKey ? 'ATLAS_SERVER_API_KEY' : null,
        !baseUrl ? 'ATLAS_SERVER_API_BASE_URL' : null,
      ]
        .filter(Boolean)
        .join(', ')})`
    );
  }

  return { baseUrl, apiKey };
}

/** Console ids are 24-hex ObjectIds; allow a safe charset so nothing can inject into the query. */
const PartnerIdParamSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

// ============================================================================
// Client
// ============================================================================

/**
 * `GET /external/partner-movies?partnerId=`.
 *
 * @param partnerId MUST come from the verified session, never from the client.
 */
export async function fetchPartnerCatalogue(partnerId: string): Promise<PartnerCatalogue> {
  const { baseUrl, apiKey } = readConfig();

  const parsedId = PartnerIdParamSchema.safeParse(partnerId);
  if (!parsedId.success) {
    throw new AtlasCatalogError('invalid_partner', 'partnerId is not acceptable');
  }

  const url = `${baseUrl}/external/partner-movies?partnerId=${encodeURIComponent(parsedId.data)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(ATLAS_EXTERNAL_TIMEOUT_MS),
    });
  } catch (error) {
    // Only the error NAME is logged: a fetch TypeError can quote header values.
    log.error({ errName: error instanceof Error ? error.name : 'unknown' }, 'External API call failed');
    throw new AtlasCatalogError('unavailable', 'External partner API did not answer');
  }

  if (response.status === 401) {
    log.error({ status: 401 }, 'External API rejected the server key');
    throw new AtlasCatalogError('unauthorized', 'External partner API rejected the key');
  }
  if (response.status === 400) {
    throw new AtlasCatalogError('invalid_partner', 'External partner API rejected the partnerId');
  }
  if (response.status === 404) {
    throw new AtlasCatalogError('partner_not_found', 'Partner does not exist in the external API');
  }
  if (!response.ok) {
    log.error({ status: response.status }, 'External API answered with an error');
    throw new AtlasCatalogError('unavailable', `External partner API answered ${response.status}`);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new AtlasCatalogError('bad_response', 'External partner API did not answer JSON');
  }

  const parsed = ExternalPartnerMoviesResponseSchema.safeParse(json);
  if (!parsed.success) {
    log.error({ issues: parsed.error.issues.map((i) => i.path.join('.')) }, 'External API shape mismatch');
    throw new AtlasCatalogError('bad_response', 'External partner API answer has an unexpected shape');
  }

  return parsed.data.data;
}
