export { getPartnerFromRequest, getPartnerByPijamaIdFromRequest } from './middleware';

// Access control exports
export {
  isSpecialPartner,
  isSpecialPartnerId,
  canAccessFilm,
  getAccessibleFilmIds,
  canManageCampaign,
  canViewCampaign,
  canManagePartners,
  canViewAllPartners,
  canViewMetaCampaigns,
  accessDeniedResponse,
  requireAccess,
  SPECIAL_PARTNER_ID,
} from './access-control';

export type { AccessCheckResult } from './access-control';

// Session management exports
export {
  getSession,
  createSessionToken,
  verifySessionToken,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE_NAME,
} from './session';

export type { SessionPayload } from './session';
