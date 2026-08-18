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
// One instance per process, memoised here rather than by the factory: it only
// caches outside production, so without this every property access would build
// a fresh client. That is what broke the Muvi token — `getAccessToken()` stored
// it on one instance and `productKey` read from another.
let stripeInstance: Stripe | undefined;

const stripe = new Proxy({} as Stripe, {
  // `receiver` is deliberately omitted: forwarding it would run the client's
  // getters with `this` bound to the proxy, so a getter reading internal state
  // would recurse back through this handler and see nothing.
  get(_target, prop) {
    stripeInstance ??= getStripeClient();
    const value = Reflect.get(stripeInstance, prop);
    return typeof value === 'function' ? value.bind(stripeInstance) : value;
  },
});

export default stripe;
