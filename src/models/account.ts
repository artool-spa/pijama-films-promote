/**
 * Account Model - debit account and its ledger.
 *
 * Firestore layout:
 *
 *   accounts/{partnerId}
 *   accounts/{partnerId}/transactions/{id}
 *
 * The account document id *is* the partner id. Postgres enforced one account
 * per partner with a unique column; here the id does it, and it also makes
 * every lookup a direct read rather than a query.
 *
 * Balance changes run inside a Firestore transaction over that single account
 * document. Firestore retries a transaction whose reads were invalidated by a
 * concurrent write, so two simultaneous charges cannot both observe the same
 * starting balance — which is the property the money depends on.
 */

import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { COLLECTIONS, IdSchema as DocIdSchema, docData, sanitize } from '@/lib/firestore';
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';

// ============================================================================
// SHARED SCHEMAS
// ============================================================================

const TransactionTypeSchema = z.enum(['DEPOSIT', 'CAMPAIGN_CHARGE', 'CAMPAIGN_REFUND', 'ADJUSTMENT']);
const TransactionStatusSchema = z.enum(['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED']);

// ============================================================================
// VALIDATION SCHEMAS - OUTPUT
// ============================================================================

export const AccountSchema = z.object({
  id: DocIdSchema,
  partnerId: DocIdSchema,
  balance: z.number(),
  currency: z.string(),
  stripeCustomerId: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const AccountTransactionSchema = z.object({
  id: DocIdSchema,
  accountId: DocIdSchema,
  type: TransactionTypeSchema,
  status: TransactionStatusSchema,
  amount: z.number(),
  balanceAfter: z.number(),
  description: z.string(),
  stripeFee: z.number().nullable(),
  grossAmount: z.number().nullable(),
  stripeSessionId: z.string().nullable(),
  stripePaymentIntentId: z.string().nullable(),
  campaignId: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const AccountWithTransactionsSchema = AccountSchema.extend({
  transactions: z.array(AccountTransactionSchema),
});

export type Account = z.infer<typeof AccountSchema>;
export type AccountTransaction = z.infer<typeof AccountTransactionSchema>;
export type AccountWithTransactions = z.infer<typeof AccountWithTransactionsSchema>;

// Input validation helpers
const IdSchema = DocIdSchema;
const PartnerIdSchema = DocIdSchema;

// ============================================================================
// FIRESTORE HELPERS
// ============================================================================

type Doc = Record<string, unknown>;

function accountRef(partnerId: string): DocumentReference {
  return adminDb().collection(COLLECTIONS.accounts).doc(partnerId);
}

function transactionsRef(partnerId: string) {
  return accountRef(partnerId).collection(COLLECTIONS.transactions);
}

/** Column defaults Postgres applied to a new account. */
function newAccount(partnerId: string, now: Date) {
  return {
    partnerId,
    balance: 0,
    currency: 'usd',
    stripeCustomerId: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Column defaults for a ledger entry, so every optional field is explicit. */
function newTransaction(accountId: string, now: Date, fields: Doc) {
  return {
    accountId,
    stripeFee: null,
    grossAmount: null,
    stripeSessionId: null,
    stripePaymentIntentId: null,
    campaignId: null,
    createdAt: now,
    updatedAt: now,
    ...sanitize(fields),
  };
}

/**
 * Find a ledger entry by Stripe session across every account.
 *
 * The entries live under their account, so this is a collection-group query;
 * it replaces the unique index Postgres had on `stripeSessionId`. Uniqueness
 * itself is upheld by the callers, which only ever write one entry per session.
 */
function bySessionQuery(stripeSessionId: string) {
  return adminDb()
    .collectionGroup(COLLECTIONS.transactions)
    .where('stripeSessionId', '==', stripeSessionId)
    .limit(1);
}

function byPaymentIntentQuery(stripePaymentIntentId: string) {
  return adminDb()
    .collectionGroup(COLLECTIONS.transactions)
    .where('type', '==', 'ADJUSTMENT')
    .where('stripePaymentIntentId', '==', stripePaymentIntentId)
    .limit(1);
}

/**
 * Read the account inside a transaction, creating it if this partner has none.
 *
 * Returns the *current* balance alongside the reference so the caller can do
 * its arithmetic before issuing any write — Firestore requires every read in a
 * transaction to happen before the first write.
 */
async function readOrCreateAccount(
  tx: Transaction,
  partnerId: string,
  now: Date
): Promise<{ ref: DocumentReference; balance: number; exists: boolean }> {
  const ref = accountRef(partnerId);
  const snap = await tx.get(ref);
  const data = docData(snap);

  return {
    ref,
    balance: (data?.balance as number | undefined) ?? 0,
    exists: data !== null,
  };
}

// ============================================================================
// QUERY FUNCTIONS
// ============================================================================

/**
 * Get or create an account for a partner (lazy account creation)
 */
export async function getOrCreateAccount(partnerId: string): Promise<Account> {
  const validPartnerId = PartnerIdSchema.parse(partnerId);
  const now = new Date();

  const created = await adminDb().runTransaction(async (tx) => {
    const ref = accountRef(validPartnerId);
    const snap = await tx.get(ref);
    const existing = docData(snap);

    if (existing) return existing;

    const document = newAccount(validPartnerId, now);
    tx.set(ref, document);

    return { id: validPartnerId, ...document };
  });

  return AccountSchema.parse(created);
}

/**
 * Get account with paginated transactions
 */
export async function getAccountWithTransactions(
  partnerId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<AccountWithTransactions> {
  const validPartnerId = PartnerIdSchema.parse(partnerId);
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;

  // Ensure account exists
  const account = await getOrCreateAccount(validPartnerId);

  const snap = await transactionsRef(validPartnerId)
    .orderBy('createdAt', 'desc')
    .offset(offset)
    .limit(limit)
    .get();

  return AccountWithTransactionsSchema.parse({
    ...account,
    transactions: snap.docs.map(docData),
  });
}

/**
 * Get account balance (lightweight)
 */
export async function getAccountBalance(partnerId: string): Promise<number> {
  const validPartnerId = PartnerIdSchema.parse(partnerId);

  const snap = await accountRef(validPartnerId).get();
  const account = docData(snap);

  return (account?.balance as number | undefined) ?? 0;
}

// ============================================================================
// TRANSACTIONAL MUTATIONS
// ============================================================================

/**
 * Record a completed deposit (called by Stripe webhook after payment succeeds)
 * amount = deposit amount (what user gets credited, net of fees)
 */
export async function recordDeposit(
  partnerId: string,
  amount: number,
  stripeSessionId: string,
  stripePaymentIntentId: string,
  options?: { grossAmount?: number; stripeFee?: number }
): Promise<AccountTransaction> {
  const validPartnerId = PartnerIdSchema.parse(partnerId);
  const validAmount = z.number().positive().parse(amount);
  const validSessionId = z.string().min(1).parse(stripeSessionId);
  const validPaymentIntentId = z.string().min(1).parse(stripePaymentIntentId);
  const now = new Date();

  const written = await adminDb().runTransaction(async (tx) => {
    // ---- reads ----
    const account = await readOrCreateAccount(tx, validPartnerId, now);
    const existingSnap = await tx.get(bySessionQuery(validSessionId));
    const existing = existingSnap.empty ? null : existingSnap.docs[0];
    const existingData = existing ? docData(existing) : null;

    // Idempotency: if already completed, return without double-crediting
    if (existingData?.status === 'COMPLETED') {
      return existingData;
    }

    const newBalance = account.balance + validAmount;

    // ---- writes ----
    if (account.exists) {
      tx.update(account.ref, { balance: newBalance, updatedAt: now });
    } else {
      tx.set(account.ref, { ...newAccount(validPartnerId, now), balance: newBalance });
    }

    if (existing) {
      // Update existing pending transaction to completed
      const patch = {
        status: 'COMPLETED',
        balanceAfter: newBalance,
        stripePaymentIntentId: validPaymentIntentId,
        updatedAt: now,
      };
      tx.update(existing.ref, patch);

      return { ...existingData, ...patch };
    }

    // Create new completed transaction (fallback path)
    const ref = transactionsRef(validPartnerId).doc();
    const document = newTransaction(validPartnerId, now, {
      type: 'DEPOSIT',
      status: 'COMPLETED',
      amount: validAmount,
      balanceAfter: newBalance,
      description: `Deposit of $${validAmount.toFixed(2)}`,
      stripeFee: options?.stripeFee ?? null,
      grossAmount: options?.grossAmount ?? null,
      stripeSessionId: validSessionId,
      stripePaymentIntentId: validPaymentIntentId,
    });
    tx.set(ref, document);

    return { id: ref.id, ...document };
  });

  return AccountTransactionSchema.parse(written);
}

/**
 * Charge campaign budget from account balance
 */
export async function chargeCampaignBudget(
  partnerId: string,
  campaignId: string,
  amount: number,
  campaignName: string
): Promise<AccountTransaction> {
  const validPartnerId = PartnerIdSchema.parse(partnerId);
  const validCampaignId = IdSchema.parse(campaignId);
  const validAmount = z.number().positive().parse(amount);
  const validCampaignName = z.string().min(1).parse(campaignName);
  const now = new Date();

  const written = await adminDb().runTransaction(async (tx) => {
    const account = await readOrCreateAccount(tx, validPartnerId, now);

    if (!account.exists) {
      throw new Error('Account not found. Please add funds first.');
    }

    if (account.balance < validAmount) {
      throw new Error(
        `Insufficient balance. Available: $${account.balance.toFixed(2)}, Required: $${validAmount.toFixed(2)}`
      );
    }

    const newBalance = account.balance - validAmount;

    tx.update(account.ref, { balance: newBalance, updatedAt: now });

    // Create charge transaction (negative amount)
    const ref = transactionsRef(validPartnerId).doc();
    const document = newTransaction(validPartnerId, now, {
      type: 'CAMPAIGN_CHARGE',
      status: 'COMPLETED',
      amount: -validAmount,
      balanceAfter: newBalance,
      description: `Campaign charge: ${validCampaignName}`,
      campaignId: validCampaignId,
    });
    tx.set(ref, document);

    return { id: ref.id, ...document };
  });

  return AccountTransactionSchema.parse(written);
}

/**
 * Refund campaign budget back to account balance
 */
export async function refundCampaignBudget(
  partnerId: string,
  campaignId: string,
  amount: number,
  campaignName: string
): Promise<AccountTransaction> {
  const validPartnerId = PartnerIdSchema.parse(partnerId);
  const validCampaignId = IdSchema.parse(campaignId);
  const validAmount = z.number().positive().parse(amount);
  const validCampaignName = z.string().min(1).parse(campaignName);
  const now = new Date();

  const written = await adminDb().runTransaction(async (tx) => {
    const account = await readOrCreateAccount(tx, validPartnerId, now);

    if (!account.exists) {
      throw new Error('Account not found');
    }

    const newBalance = account.balance + validAmount;

    tx.update(account.ref, { balance: newBalance, updatedAt: now });

    // Create refund transaction (positive amount)
    const ref = transactionsRef(validPartnerId).doc();
    const document = newTransaction(validPartnerId, now, {
      type: 'CAMPAIGN_REFUND',
      status: 'COMPLETED',
      amount: validAmount,
      balanceAfter: newBalance,
      description: `Campaign refund: ${validCampaignName}`,
      campaignId: validCampaignId,
    });
    tx.set(ref, document);

    return { id: ref.id, ...document };
  });

  return AccountTransactionSchema.parse(written);
}

/**
 * Cancel a pending deposit transaction (e.g. when user cancels on Stripe)
 * Returns null if transaction not found or already completed.
 */
export async function cancelPendingDeposit(
  stripeSessionId: string
): Promise<AccountTransaction | null> {
  const validSessionId = z.string().min(1).parse(stripeSessionId);

  const snap = await bySessionQuery(validSessionId).get();

  if (snap.empty) return null;

  const existing = docData(snap.docs[0]);

  if (existing?.status !== 'PENDING') {
    return null;
  }

  const patch = { status: 'CANCELLED', updatedAt: new Date() };
  await snap.docs[0].ref.update(patch);

  return AccountTransactionSchema.parse({ ...existing, ...patch });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a pending deposit transaction before Stripe confirms payment
 */
export async function createPendingDeposit(
  partnerId: string,
  depositAmount: number,
  grossAmount: number,
  stripeFee: number,
  stripeSessionId: string
): Promise<AccountTransaction> {
  const validPartnerId = PartnerIdSchema.parse(partnerId);
  const validAmount = z.number().positive().parse(depositAmount);
  const validGrossAmount = z.number().positive().parse(grossAmount);
  const validStripeFee = z.number().nonnegative().parse(stripeFee);
  const validSessionId = z.string().min(1).parse(stripeSessionId);

  const account = await getOrCreateAccount(validPartnerId);

  const ref = transactionsRef(validPartnerId).doc();
  const document = newTransaction(account.id, new Date(), {
    type: 'DEPOSIT',
    status: 'PENDING',
    amount: validAmount,
    balanceAfter: account.balance, // Balance hasn't changed yet
    description: `Pending deposit of $${validAmount.toFixed(2)}`,
    stripeFee: validStripeFee,
    grossAmount: validGrossAmount,
    stripeSessionId: validSessionId,
  });

  await ref.set(document);

  return AccountTransactionSchema.parse({ id: ref.id, ...document });
}

/**
 * Credit a fee adjustment when actual Stripe fee is lower than estimated.
 * Idempotent: checks for existing ADJUSTMENT with the same stripePaymentIntentId.
 */
export async function creditFeeAdjustment(
  partnerId: string,
  adjustmentAmount: number,
  stripePaymentIntentId: string
): Promise<AccountTransaction | null> {
  const validPartnerId = PartnerIdSchema.parse(partnerId);
  const validAmount = z.number().positive().parse(adjustmentAmount);
  const validPaymentIntentId = z.string().min(1).parse(stripePaymentIntentId);
  const now = new Date();

  const written = await adminDb().runTransaction(async (tx) => {
    // ---- reads ----
    // Idempotency: check for existing ADJUSTMENT with this payment intent
    const existingSnap = await tx.get(byPaymentIntentQuery(validPaymentIntentId));
    const account = await readOrCreateAccount(tx, validPartnerId, now);

    if (!existingSnap.empty) {
      return docData(existingSnap.docs[0]);
    }

    if (!account.exists) {
      throw new Error('Account not found');
    }

    const newBalance = account.balance + validAmount;

    // ---- writes ----
    tx.update(account.ref, { balance: newBalance, updatedAt: now });

    const ref = transactionsRef(validPartnerId).doc();
    const document = newTransaction(validPartnerId, now, {
      type: 'ADJUSTMENT',
      status: 'COMPLETED',
      amount: validAmount,
      balanceAfter: newBalance,
      description: 'Fee adjustment: actual Stripe fee lower than estimated',
      stripePaymentIntentId: validPaymentIntentId,
    });
    tx.set(ref, document);

    return { id: ref.id, ...document };
  });

  return AccountTransactionSchema.parse(written);
}

/**
 * Update the Stripe customer ID for a partner's account
 */
export async function updateStripeCustomerId(
  partnerId: string,
  stripeCustomerId: string
): Promise<Account> {
  const validPartnerId = PartnerIdSchema.parse(partnerId);
  const validCustomerId = z.string().min(1).parse(stripeCustomerId);

  const account = await getOrCreateAccount(validPartnerId);
  const now = new Date();

  await accountRef(validPartnerId).update({
    stripeCustomerId: validCustomerId,
    updatedAt: now,
  });

  return AccountSchema.parse({ ...account, stripeCustomerId: validCustomerId, updatedAt: now });
}
