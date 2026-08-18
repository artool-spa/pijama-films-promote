/**
 * Access Control Module
 *
 * Handles permission checks for partners including:
 * - Film access (which films a partner can manage ads for)
 * - Special partner access (pijamafilms has full access)
 * - Admin operations
 */

import type { Partner } from '@/models/partner';
import { pijama, canPartnerAccessFilm, getPartnerFilmIds } from '../pijama';

// ============================================================================
// CONSTANTS
// ============================================================================

// Special partner ID that has full access to all films
export const SPECIAL_PARTNER_ID = 'pijamafilms';

// ============================================================================
// TYPES
// ============================================================================

export interface AccessCheckResult {
  allowed: boolean;
  reason?: string;
}

// ============================================================================
// SPECIAL PARTNER CHECKS
// ============================================================================

/**
 * Check if a partner is the special "pijamafilms" partner with full access
 */
export function isSpecialPartner(partner: Partner): boolean {
  return partner.partnerId === SPECIAL_PARTNER_ID;
}

/**
 * Check if a partner ID is the special partner
 */
export function isSpecialPartnerId(partnerId: string): boolean {
  return partnerId === SPECIAL_PARTNER_ID;
}

// ============================================================================
// FILM ACCESS CONTROL
// ============================================================================

/**
 * Check if a partner can access a specific film
 *
 * Access rules:
 * 1. Special partner (pijamafilms) has access to ALL films
 * 2. Regular partners only have access to films in their Pijama account
 * 3. If Pijama is not configured, allow access (development mode)
 */
export async function canAccessFilm(
  partner: Partner,
  filmMuviUuid: string
): Promise<AccessCheckResult> {
  // Special partner has full access
  if (isSpecialPartner(partner)) {
    return { allowed: true };
  }

  // If Pijama is not configured, allow access (development mode)
  if (!pijama) {
    return { allowed: true };
  }

  // Check with Pijama API
  const canAccess = await canPartnerAccessFilm(pijama, partner.partnerId, filmMuviUuid);

  if (!canAccess) {
    return {
      allowed: false,
      reason: 'No tienes acceso a esta película',
    };
  }

  return { allowed: true };
}

/**
 * Get list of film UUIDs a partner can access
 *
 * Returns:
 * - null for special partner (means ALL films)
 * - Empty array if no films configured
 * - Array of film UUIDs otherwise
 */
export async function getAccessibleFilmIds(
  partner: Partner
): Promise<string[] | null> {
  // Special partner has access to all films (return null to indicate "all")
  if (isSpecialPartner(partner)) {
    return null;
  }

  // If Pijama is not configured, return null (allow all in dev mode)
  if (!pijama) {
    return null;
  }

  // Get films from Pijama API
  return getPartnerFilmIds(pijama, partner.partnerId);
}

// ============================================================================
// CAMPAIGN ACCESS CONTROL
// ============================================================================

/**
 * Check if a partner can manage a Campaign
 *
 * Rules:
 * 1. Partner must own the Campaign (partnerId matches)
 * 2. Special partner can manage ALL Campaigns
 */
export function canManageCampaign(
  partner: Partner,
  campaignPartnerId: string
): AccessCheckResult {
  // Special partner can manage any Campaign
  if (isSpecialPartner(partner)) {
    return { allowed: true };
  }

  // Regular partners can only manage their own Campaigns
  if (partner.id !== campaignPartnerId) {
    return {
      allowed: false,
      reason: 'No tienes permiso para modificar esta campaña',
    };
  }

  return { allowed: true };
}

/**
 * Check if a partner can view a Campaign
 *
 * Rules:
 * 1. Partner must own the Campaign OR
 * 2. Partner is the special partner
 */
export function canViewCampaign(
  partner: Partner,
  campaignPartnerId: string
): AccessCheckResult {
  return canManageCampaign(partner, campaignPartnerId);
}

// ============================================================================
// PARTNER MANAGEMENT ACCESS
// ============================================================================

/**
 * Check if a partner can manage other partners
 * Only the special partner can do this
 */
export function canManagePartners(partner: Partner): AccessCheckResult {
  if (!isSpecialPartner(partner)) {
    return {
      allowed: false,
      reason: 'Solo administradores pueden gestionar partners',
    };
  }

  return { allowed: true };
}

/**
 * Check if a partner can view all partners
 * Only the special partner can do this
 */
export function canViewAllPartners(partner: Partner): AccessCheckResult {
  return canManagePartners(partner);
}

// ============================================================================
// META CAMPAIGN ACCESS
// ============================================================================

/**
 * Check if a partner can view Meta campaign settings
 * All partners can view their own campaigns
 * Special partner can view all campaigns
 */
export function canViewMetaCampaigns(
  partner: Partner,
  targetPartnerId?: string
): AccessCheckResult {
  // Special partner can view all campaigns
  if (isSpecialPartner(partner)) {
    return { allowed: true };
  }

  // Regular partners can only view their own campaigns
  if (targetPartnerId && partner.id !== targetPartnerId) {
    return {
      allowed: false,
      reason: 'No tienes acceso a las campañas de este partner',
    };
  }

  return { allowed: true };
}

// ============================================================================
// MIDDLEWARE HELPER
// ============================================================================

/**
 * Create an access denied response
 */
export function accessDeniedResponse(result: AccessCheckResult): Response {
  return new Response(
    JSON.stringify({
      error: 'Acceso denegado',
      message: result.reason || 'No tienes permiso para esta acción',
    }),
    {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

/**
 * Require access check to pass, otherwise throw/return error
 */
export function requireAccess(result: AccessCheckResult): void {
  if (!result.allowed) {
    throw new Error(result.reason || 'Access denied');
  }
}
