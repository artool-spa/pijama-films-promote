import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import stripe from '#stripe';
import { createLogger } from '@/lib/logger';
import { recordDeposit, creditFeeAdjustment } from '@/models/account';

const log = createLogger('stripe-webhook');

/**
 * POST /api/webhooks/stripe
 * Handle Stripe webhook events
 * NO auth middleware - called directly by Stripe
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json(
      { error: 'Missing stripe-signature header' },
      { status: 400 }
    );
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    log.error('STRIPE_WEBHOOK_SECRET not configured');
    return NextResponse.json(
      { error: 'Webhook not configured' },
      { status: 500 }
    );
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    log.error({ err: error }, 'Stripe webhook signature verification failed');
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 400 }
    );
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;

      const partnerId = session.metadata?.partnerId;
      // Use depositAmount (net amount credited) — fallback to amount for backwards compat
      const depositAmount = session.metadata?.depositAmount || session.metadata?.amount;
      const estimatedFee = parseFloat(session.metadata?.stripeFee || '0');

      if (!partnerId || !depositAmount) {
        log.error({ sessionId: session.id }, 'Missing metadata in checkout session');
        return NextResponse.json(
          { error: 'Missing session metadata' },
          { status: 400 }
        );
      }

      const paymentIntentId = session.payment_intent as string;

      try {
        await recordDeposit(
          partnerId,
          parseFloat(depositAmount),
          session.id,
          paymentIntentId
        );
        log.info({ partnerId, depositAmount }, 'Deposit recorded');

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
                await creditFeeAdjustment(partnerId, adjustment, paymentIntentId);
                log.info({ partnerId, adjustment: adjustment.toFixed(2) }, 'Fee adjustment credited');
              }
            }
          } catch (feeError) {
            log.error({ err: feeError }, 'Fee reconciliation error');
          }
        }
      } catch (error) {
        log.error({ err: error }, 'Error recording deposit');
        return NextResponse.json(
          { error: 'Error processing deposit' },
          { status: 500 }
        );
      }
      break;
    }
    default:
      log.info({ eventType: event.type }, 'Unhandled Stripe event type');
  }

  return NextResponse.json({ received: true });
}
