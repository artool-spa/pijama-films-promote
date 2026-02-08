import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import Stripe from 'stripe';
import stripe from '#stripe';
import { getPartnerFromRequest } from '@/lib/auth';
import { recordDeposit, cancelPendingDeposit, getAccountBalance } from '@/models/account';

const VerifySessionSchema = z.object({
  sessionId: z.string().min(1),
});

/**
 * POST /api/account/verify-session
 * Verify a Stripe Checkout session and update transaction status
 */
export async function POST(req: NextRequest) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const result = VerifySessionSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid data', details: result.error.flatten() },
        { status: 400 }
      );
    }

    const { sessionId } = result.data;

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // Verify session belongs to this partner
    if (session.metadata?.partnerId !== partner.id) {
      return NextResponse.json(
        { error: 'Session does not belong to this account' },
        { status: 403 }
      );
    }

    if (session.status === 'complete' && session.payment_status === 'paid') {
      const amount = parseFloat(session.metadata?.amount || '0');
      await recordDeposit(
        partner.id,
        amount,
        session.id,
        session.payment_intent as string
      );
      const balance = await getAccountBalance(partner.id);
      return NextResponse.json({ status: 'completed', balance });
    }

    // Session not completed — cancel the pending deposit
    await cancelPendingDeposit(session.id);
    return NextResponse.json({ status: 'cancelled' });
  } catch (error) {
    if (error instanceof Stripe.errors.StripeInvalidRequestError) {
      return NextResponse.json(
        { error: 'Invalid session ID' },
        { status: 400 }
      );
    }
    console.error('Error verifying session:', error);
    return NextResponse.json(
      { error: 'Error verifying session' },
      { status: 500 }
    );
  }
}
