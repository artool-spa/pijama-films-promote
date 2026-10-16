import { NextRequest } from 'next/server';
import { getPartnerRecordByPartnerId } from '@/models/partner';
import type { SessionOrigin, SessionPartner } from './access-control';

/**
 * Extract and validate the partner from request headers.
 *
 * The ONLY accepted source is `x-pijama-partner-id`, which the Edge middleware
 * derives from the signed session cookie (`src/middleware.ts`). There is
 * deliberately no second source.
 *
 * ## Why there is no `x-partner-id` branch any more
 *
 * This function used to read `x-partner-id` — the internal document id — and to
 * prefer it over the session-derived header. Nothing in this repository, in
 * `proxy/nginx.conf` or in `apphosting.yaml` ever set that header, so its only
 * possible source was the caller. The Edge middleware clones the incoming
 * headers (it has to, or the cookie and user-agent would be stripped) and
 * overrides only `x-pijama-partner-id`, so a caller-supplied `x-partner-id`
 * arrived here intact and won.
 *
 * The consequence was total: anyone could name any partner and become it for
 * the whole request — including `pijamafilms`, which every seeded user shares
 * and which the access-control module of the time granted unrestricted access
 * by design (that module has since been reduced to the single check that is
 * actually wired up, `canManageCampaign`; the helpers it lost could only ever
 * return "allowed"). The victim ids are not even secret; `GET /api/partners` hands
 * them to any caller. Every correctly written ownership check in the codebase
 * was bypassable with one header, which is why this was fixed before any of
 * them were added.
 *
 * Do not reintroduce a second source. A genuine server-to-server caller must
 * authenticate as itself — see `@/lib/auth/oidc-caller` — and name the partner
 * inside a verified payload, never in a bare request header.
 *
 * @param req - The Next.js request object
 * @returns The partner if found and valid, null otherwise
 */
export async function getPartnerFromRequest(
  req: NextRequest
): Promise<SessionPartner | null> {
  return getPartnerByPijamaIdFromRequest(req);
}

/**
 * Extract and validate partner from request headers using Pijama partner ID.
 *
 * @param req - The Next.js request object
 * @returns The partner if found and valid, null otherwise
 */
export async function getPartnerByPijamaIdFromRequest(
  req: NextRequest
): Promise<SessionPartner | null> {
  const pijamaPartnerId = req.headers.get('x-pijama-partner-id');

  if (!pijamaPartnerId) {
    return null;
  }

  try {
    const partner = await getPartnerRecordByPartnerId(pijamaPartnerId);
    if (!partner) return null;

    // Set by the Edge middleware from the verified cookie. Anything but the
    // exact value 'internal' (absent, garbled) is SSO: fail closed.
    const sessionOrigin: SessionOrigin =
      req.headers.get('x-pijama-session-origin') === 'internal' ? 'internal' : 'sso';

    return { ...partner, sessionOrigin };
  } catch {
    return null;
  }
}
