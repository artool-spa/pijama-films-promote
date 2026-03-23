import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { getPartnerFromRequest } from '@/lib/auth';
import { getAccountBalance } from '@/models/account';

/**
 * GET /api/account/balance
 * Get just the account balance (lightweight endpoint for campaign creation flow)
 */
export async function GET(req: NextRequest) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const balance = await getAccountBalance(partner.id);
    return NextResponse.json({ balance });
  } catch (error) {
    logger.error({ err: error }, 'Error fetching balance');
    return NextResponse.json(
      { error: 'Error fetching balance' },
      { status: 500 }
    );
  }
}
