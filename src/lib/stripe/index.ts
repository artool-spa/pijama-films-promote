import Stripe from 'stripe';

// Singleton pattern for Stripe client (lazy initialization)
const globalForStripe = global as unknown as { stripe: Stripe | undefined };

function getStripeClient(): Stripe {
  if (globalForStripe.stripe) {
    return globalForStripe.stripe;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error(
      'Missing required STRIPE_SECRET_KEY environment variable. ' +
        'Please configure it in your .env file.'
    );
  }

  const client = new Stripe(secretKey, {
    typescript: true,
  });

  if (process.env.NODE_ENV !== 'production') {
    globalForStripe.stripe = client;
  }

  return client;
}

// Export a proxy that lazily initializes Stripe on first property access
const stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    const client = getStripeClient();
    const value = Reflect.get(client, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
});

export default stripe;
