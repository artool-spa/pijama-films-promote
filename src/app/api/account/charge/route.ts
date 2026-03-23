import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import logger from '@/lib/logger';
import { getPartnerFromRequest } from '@/lib/auth';
import { chargeCampaignBudget } from '@/models/account';

const ChargeSchema = z.object({
  campaignId: z.string().cuid(),
  amount: z.number().positive(),
  campaignName: z.string().min(1),
});

/**
 * POST /api/account/charge
 * Charge campaign budget from account balance
 */
export async function POST(req: NextRequest) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const result = ChargeSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid data', details: result.error.flatten() },
        { status: 400 }
      );
    }

    const { campaignId, amount, campaignName } = result.data;

    const transaction = await chargeCampaignBudget(
      partner.id,
      campaignId,
      amount,
      campaignName
    );

    return NextResponse.json(transaction);
  } catch (error) {
    logger.error({ err: error }, 'Error charging campaign budget');

    const message =
      error instanceof Error ? error.message : 'Error charging budget';

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
