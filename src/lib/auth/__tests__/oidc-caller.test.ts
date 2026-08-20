import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const verifyIdToken = vi.fn();

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    verifyIdToken = verifyIdToken;
  },
}));

const { verifyOidcCaller, authorizeInternalRequest } = await import('../oidc-caller');

const AUDIENCE = 'https://backend.example.app';
const INVOKER = 'triggers@pijama-promote-firebase.iam.gserviceaccount.com';

/** Shape of what google-auth-library hands back on a successful verify. */
function ticketFor(payload: Record<string, unknown>) {
  return { getPayload: () => payload };
}

describe('verifyOidcCaller', () => {
  beforeEach(() => {
    verifyIdToken.mockReset();
    process.env.INTERNAL_TRIGGER_AUDIENCE = AUDIENCE;
    process.env.CRON_INVOKER_SERVICE_ACCOUNTS = INVOKER;
  });

  afterEach(() => {
    delete process.env.INTERNAL_TRIGGER_AUDIENCE;
    delete process.env.CRON_INVOKER_SERVICE_ACCOUNTS;
    delete process.env.CRON_SECRET;
  });

  it('accepts a token from an allowed service account', async () => {
    verifyIdToken.mockResolvedValue(
      ticketFor({ email: INVOKER, email_verified: true })
    );

    await expect(verifyOidcCaller(`Bearer tok`)).resolves.toEqual({
      serviceAccount: INVOKER,
    });
  });

  it('pins the audience to this backend', async () => {
    verifyIdToken.mockResolvedValue(
      ticketFor({ email: INVOKER, email_verified: true })
    );

    await verifyOidcCaller('Bearer tok');

    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: 'tok',
      audience: AUDIENCE,
    });
  });

  it('rejects a token minted for another audience', async () => {
    // This is what google-auth-library does on an audience mismatch.
    verifyIdToken.mockRejectedValue(new Error('Wrong recipient'));

    await expect(verifyOidcCaller('Bearer tok')).resolves.toBeNull();
  });

  it('rejects a service account that is not on the list', async () => {
    verifyIdToken.mockResolvedValue(
      ticketFor({ email: 'someone-else@example.com', email_verified: true })
    );

    await expect(verifyOidcCaller('Bearer tok')).resolves.toBeNull();
  });

  it('rejects an unverified email', async () => {
    verifyIdToken.mockResolvedValue(
      ticketFor({ email: INVOKER, email_verified: false })
    );

    await expect(verifyOidcCaller('Bearer tok')).resolves.toBeNull();
  });

  it('rejects a missing or malformed header without calling out', async () => {
    await expect(verifyOidcCaller(null)).resolves.toBeNull();
    await expect(verifyOidcCaller('tok')).resolves.toBeNull();
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('rejects everything when the invoker list is unset', async () => {
    delete process.env.CRON_INVOKER_SERVICE_ACCOUNTS;

    await expect(verifyOidcCaller('Bearer tok')).resolves.toBeNull();
    expect(verifyIdToken).not.toHaveBeenCalled();
  });
});

describe('authorizeInternalRequest', () => {
  beforeEach(() => {
    verifyIdToken.mockReset();
    process.env.INTERNAL_TRIGGER_AUDIENCE = AUDIENCE;
    process.env.CRON_INVOKER_SERVICE_ACCOUNTS = INVOKER;
  });

  afterEach(() => {
    delete process.env.INTERNAL_TRIGGER_AUDIENCE;
    delete process.env.CRON_INVOKER_SERVICE_ACCOUNTS;
    delete process.env.CRON_SECRET;
  });

  it('accepts a valid OIDC caller', async () => {
    verifyIdToken.mockResolvedValue(
      ticketFor({ email: INVOKER, email_verified: true })
    );

    await expect(authorizeInternalRequest('Bearer tok')).resolves.toBe(true);
  });

  // The legacy branch exists only for the cutover window and is dropped once
  // the functions are confirmed to authenticate with OIDC.
  it('still accepts the legacy CRON_SECRET while it is configured', async () => {
    verifyIdToken.mockRejectedValue(new Error('not a token'));
    process.env.CRON_SECRET = 'legacy-value';

    await expect(authorizeInternalRequest('Bearer legacy-value')).resolves.toBe(true);
  });

  it('rejects the legacy secret once it is removed', async () => {
    verifyIdToken.mockRejectedValue(new Error('not a token'));

    await expect(authorizeInternalRequest('Bearer legacy-value')).resolves.toBe(false);
  });

  it('rejects an unauthorized caller', async () => {
    verifyIdToken.mockResolvedValue(
      ticketFor({ email: 'someone-else@example.com', email_verified: true })
    );
    process.env.CRON_SECRET = 'legacy-value';

    await expect(authorizeInternalRequest('Bearer tok')).resolves.toBe(false);
  });
});
