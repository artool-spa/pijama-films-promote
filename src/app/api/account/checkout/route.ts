import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import stripe from '#stripe';
import { getPartnerFromRequest } from '@/lib/auth';
import {
  getOrCreateAccount,
  updateStripeCustomerId,
  createPendingDeposit,
} from '@/models/account';
import { calculateWorstCaseFee, calculateTotalCharge } from '@/lib/stripe/fees';

const CheckoutSchema = z.object({
  amount: z.number().min(5, 'Minimum amount is $5'),
  returnUrl: z.string().optional(),
});

/**
 * POST /api/account/checkout
 * Create a Stripe Checkout session for adding funds
 */
export async function POST(req: NextRequest) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const result = CheckoutSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid data', details: result.error.flatten() },
        { status: 400 }
      );
    }

    const { amount, returnUrl } = result.data;

    // Calculate fees (fee added on top of deposit)
    const stripeFee = calculateWorstCaseFee(amount);
    const grossAmount = calculateTotalCharge(amount);

    // Get or create account
    const account = await getOrCreateAccount(partner.id);

    // Get or create Stripe customer
    let stripeCustomerId = account.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        metadata: {
          partnerId: partner.id,
          partnerName: partner.name,
        },
      });
      stripeCustomerId = customer.id;
      await updateStripeCustomerId(partner.id, stripeCustomerId);
    }

    // Determine base URL from request
    const origin = req.headers.get('origin') || 'http://localhost:3000';

    // Create Checkout Session — charge gross amount (deposit + fee)
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'payment',
      currency: 'usd',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Campaign Funds',
              description: `Deposit of $${amount.toFixed(2)} USD (+ $${stripeFee.toFixed(2)} processing fee)`,
            },
            unit_amount: Math.round(grossAmount * 100), // Stripe uses cents
          },
          quantity: 1,
        },
      ],
      metadata: {
        partnerId: partner.id,
        amount: amount.toString(),
        depositAmount: amount.toString(),
        stripeFee: stripeFee.toString(),
        grossAmount: grossAmount.toString(),
      },
      success_url: returnUrl
        ? `${origin}${returnUrl}${returnUrl.includes('?') ? '&' : '?'}payment=success&session_id={CHECKOUT_SESSION_ID}`
        : `${origin}/account?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: returnUrl
        ? `${origin}${returnUrl}${returnUrl.includes('?') ? '&' : '?'}payment=cancelled&session_id={CHECKOUT_SESSION_ID}`
        : `${origin}/account?payment=cancelled&session_id={CHECKOUT_SESSION_ID}`,
    });

    // Create pending deposit transaction
    await createPendingDeposit(partner.id, amount, grossAmount, stripeFee, session.id);

    return NextResponse.json({
      sessionId: session.id,
      url: session.url,
    });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return NextResponse.json(
      { error: 'Error creating checkout session' },
      { status: 500 }
    );
  }
}
