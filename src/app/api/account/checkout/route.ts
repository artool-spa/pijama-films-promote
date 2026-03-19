import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import Stripe from 'stripe';
import stripe from '#stripe';
import { getPartnerFromRequest } from '@/lib/auth';
import {
  getOrCreateAccount,
  updateStripeCustomerId,
  createPendingDeposit,
} from '@/models/account';
import type { Account } from '@/models/account';
import { calculateWorstCaseFee, calculateTotalCharge } from '@/lib/stripe/fees';

/**
 * Resolve a valid Stripe customer ID, recreating if the stored one no longer exists.
 */
async function resolveStripeCustomer(
  account: Account,
  partner: { id: string; name: string }
): Promise<string> {
  if (account.stripeCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(account.stripeCustomerId);
      if (!existing.deleted) {
        return account.stripeCustomerId;
      }
    } catch (error) {
      if (
        error instanceof Stripe.errors.StripeInvalidRequestError &&
        error.code === 'resource_missing'
      ) {
        // Customer no longer exists in Stripe — will recreate below
      } else {
        throw error;
      }
    }
  }

  const customer = await stripe.customers.create({
    metadata: { partnerId: partner.id, partnerName: partner.name },
  });
  await updateStripeCustomerId(partner.id, customer.id);
  return customer.id;
}

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

    // Resolve Stripe customer (validates existing or creates new)
    const stripeCustomerId = await resolveStripeCustomer(account, partner);

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
