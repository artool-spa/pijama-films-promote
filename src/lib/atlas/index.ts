/**
 * Atlas Console integration.
 *
 * The upstream movies endpoint is documented but unverified - see the header of
 * `./types` before trusting any shape defined here.
 */

export {
  ATLAS_MOVIES_PATH,
  ATLAS_TIMEOUT_MS,
  getAtlasAllowedOrigins,
  getAtlasAllowedPartnerIds,
  getAtlasBaseUrl,
  getAtlasMoviesUrl,
  isAtlasLoginEnabled,
  isPartnerAllowed,
} from './config';

export { describeToken, fetchPartnerMovies, headerSafetyProblem } from './client';

export {
  callerKey,
  consumeAtlasSessionQuota,
  resetAtlasSessionQuota,
} from './rate-limit';
export type { RateLimitResult } from './rate-limit';
export type { AtlasBodyKind, AtlasCallResult } from './client';

export {
  AtlasMovieSchema,
  AtlasMoviesResponseSchema,
  AtlasPartnerSchema,
  AtlasSessionRequestSchema,
  toMovieSample,
} from './types';

export type {
  AtlasDiagnostics,
  AtlasMoviesResponse,
  AtlasPartner,
  AtlasSessionRequest,
  AtlasSessionResponse,
  AtlasSessionStage,
} from './types';
