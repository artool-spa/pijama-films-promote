import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import stripe from '#stripe';
import { recordDeposit, creditFeeAdjustment } from '@/models/account';

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
    console.error('STRIPE_WEBHOOK_SECRET not configured');
    return NextResponse.json(
      { error: 'Webhook not configured' },
      { status: 500 }
    );
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    console.error('Stripe webhook signature verification failed:', error);
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
        console.error('Missing metadata in checkout session:', session.id);
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
        console.log(`Deposit recorded for partner ${partnerId}: $${depositAmount}`);

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
                console.log(`Fee adjustment credited for partner ${partnerId}: $${adjustment.toFixed(2)}`);
              }
            }
          } catch (feeError) {
            console.error('Fee reconciliation error (webhook):', feeError);
          }
        }
      } catch (error) {
        console.error('Error recording deposit:', error);
        return NextResponse.json(
          { error: 'Error processing deposit' },
          { status: 500 }
        );
      }
      break;
    }
    default:
      console.log(`Unhandled Stripe event type: ${event.type}`);
  }

  return NextResponse.json({ received: true });
}
