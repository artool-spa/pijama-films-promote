import { NextRequest } from 'next/server';
import prisma from '#prisma';
import type { Partner } from '@prisma/client';

/**
 * Extract and validate partner from request headers.
 *
 * Checks headers in order:
 * 1. x-partner-id - internal database ID
 * 2. x-pijama-partner-id - external Pijama partner ID (set by auth middleware)
 *
 * @param req - The Next.js request object
 * @returns The partner if found and valid, null otherwise
 */
export async function getPartnerFromRequest(
  req: NextRequest
): Promise<Partner | null> {
  // First try internal database ID
  const partnerId = req.headers.get('x-partner-id');
  if (partnerId) {
    try {
      const partner = await prisma.partner.findUnique({
        where: { id: partnerId },
      });
      if (partner) return partner;
    } catch {
      // Continue to fallback
    }
  }

  // Fallback to Pijama partner ID (set by session middleware)
  const pijamaPartnerId = req.headers.get('x-pijama-partner-id');
  if (pijamaPartnerId) {
    try {
      const partner = await prisma.partner.findUnique({
        where: { partnerId: pijamaPartnerId },
      });
      return partner;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Extract and validate partner from request headers using Pijama partner ID.
 *
 * @param req - The Next.js request object
 * @returns The partner if found and valid, null otherwise
 */
export async function getPartnerByPijamaIdFromRequest(
  req: NextRequest
): Promise<Partner | null> {
  const pijamaPartnerId = req.headers.get('x-pijama-partner-id');

  if (!pijamaPartnerId) {
    return null;
  }

  try {
    const partner = await prisma.partner.findUnique({
      where: { partnerId: pijamaPartnerId },
    });
    return partner;
  } catch {
    return null;
  }
}
