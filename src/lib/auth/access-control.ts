/**
 * Ownership checks for campaigns.
 *
 * This module used to export twelve helpers covering film access, partner
 * management and Meta campaign visibility. Eleven of them had no callers, and
 * two of those — `canAccessFilm` and `getAccessibleFilmIds` — could only ever
 * return "allowed" / "all films": both short-circuit when the Pijama client is
 * absent, and `PIJAMA_CLIENT_ID` is configured in no environment, so the client
 * is always null. Dead code that fails open is worse than dead code, because it
 * is what the next person reaches for when they implement the real thing.
 *
 * What remains is the one check that is actually wired up.
 */

import type { Partner } from '@/models/partner';

export interface AccessCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Partner id that bypasses the ownership check below.
 *
 * ⚠️ Every seeded user currently carries this as their `partnerId`
 * (`scripts/provision-seed-users.ts`), so in practice the check below passes
 * for everyone today. That is not an accident of this module — it is the
 * partner-scoping work that blocks Go Live, and removing the bypass here
 * without the rest of that work would deny access without granting it
 * correctly anywhere else. Change it there, deliberately, not here.
 */
const SPECIAL_PARTNER_ID = 'pijamafilms';

/**
 * Can this partner act on a campaign owned by `campaignPartnerId`?
 *
 * Used by the Meta sync, ad update and ad preview routes. Compares the
 * partner's document id against the campaign's owner — note that is the
 * document id, while the bypass above compares the external `partnerId`.
 */
export function canManageCampaign(
  partner: Partner,
  campaignPartnerId: string
): AccessCheckResult {
  if (partner.partnerId === SPECIAL_PARTNER_ID) {
    return { allowed: true };
  }

  if (partner.id !== campaignPartnerId) {
    return {
      allowed: false,
      reason: 'No tienes permiso para modificar esta campaña',
    };
  }

  return { allowed: true };
}
