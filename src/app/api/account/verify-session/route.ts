import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import Stripe from 'stripe';
import stripe from '#stripe';
import logger from '@/lib/logger';
import { getPartnerFromRequest } from '@/lib/auth';
import { recordDeposit, cancelPendingDeposit, getAccountBalance, creditFeeAdjustment } from '@/models/account';

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
      // Use depositAmount (net amount credited) — fallback to amount for backwards compat
      const depositAmount = parseFloat(session.metadata?.depositAmount || session.metadata?.amount || '0');
      const estimatedFee = parseFloat(session.metadata?.stripeFee || '0');
      const paymentIntentId = session.payment_intent as string;

      await recordDeposit(
        partner.id,
        depositAmount,
        session.id,
        paymentIntentId
      );

      // Fee reconciliation: credit back difference if actual fee < estimated
      if (estimatedFee > 0 && paymentIntentId) {
        try {
          const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
            expand: ['latest_charge.balance_transaction'],
          });
          const charge = paymentIntent.latest_charge as Stripe.Charge | null;
          const balanceTransaction = charge?.balance_transaction as Stripe.BalanceTransaction | null;
          if (balanceTransaction?.fee != null) {
            const actualFee = balanceTransaction.fee / 100; // cents to dollars
            const adjustment = Math.round((estimatedFee - actualFee) * 100) / 100;
            if (adjustment > 0.01) {
              await creditFeeAdjustment(partner.id, adjustment, paymentIntentId);
            }
          }
        } catch (feeError) {
          // Non-critical: webhook will handle reconciliation if this fails
          logger.error({ err: feeError }, 'Fee reconciliation error (verify-session)');
        }
      }

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
    logger.error({ err: error }, 'Error verifying session');
    return NextResponse.json(
      { error: 'Error verifying session' },
      { status: 500 }
    );
  }
}
