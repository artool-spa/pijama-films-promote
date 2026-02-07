import { NextRequest, NextResponse } from 'next/server';
import stripe from '#stripe';
import { recordDeposit } from '@/models/account';

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
      const amount = session.metadata?.amount;

      if (!partnerId || !amount) {
        console.error('Missing metadata in checkout session:', session.id);
        return NextResponse.json(
          { error: 'Missing session metadata' },
          { status: 400 }
        );
      }

      try {
        await recordDeposit(
          partnerId,
          parseFloat(amount),
          session.id,
          session.payment_intent as string
        );
        console.log(`Deposit recorded for partner ${partnerId}: $${amount}`);
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
