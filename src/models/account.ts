import prisma from '#prisma';
import { z } from 'zod';

// ============================================================================
// SHARED SCHEMAS
// ============================================================================

const TransactionTypeSchema = z.enum(['DEPOSIT', 'CAMPAIGN_CHARGE', 'CAMPAIGN_REFUND', 'ADJUSTMENT']);
const TransactionStatusSchema = z.enum(['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED']);

// ============================================================================
// VALIDATION SCHEMAS - OUTPUT
// ============================================================================

export const AccountSchema = z.object({
  id: z.string().cuid(),
  partnerId: z.string().cuid(),
  balance: z.number(),
  currency: z.string(),
  stripeCustomerId: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const AccountTransactionSchema = z.object({
  id: z.string().cuid(),
  accountId: z.string().cuid(),
  type: TransactionTypeSchema,
  status: TransactionStatusSchema,
  amount: z.number(),
  balanceAfter: z.number(),
  description: z.string(),
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
const IdSchema = z.string().cuid();
const PartnerIdSchema = z.string().cuid();

// ============================================================================
// QUERY FUNCTIONS
// ============================================================================

/**
 * Get or create an account for a partner (lazy account creation)
 */
export async function getOrCreateAccount(partnerId: string): Promise<Account> {
  const validPartnerId = PartnerIdSchema.parse(partnerId);

  const existing = await prisma.account.findUnique({
    where: { partnerId: validPartnerId },
  });

  if (existing) {
    return AccountSchema.parse(existing);
  }

  const created = await prisma.account.create({
    data: { partnerId: validPartnerId },
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

  const result = await prisma.account.findUnique({
    where: { id: account.id },
    include: {
      transactions: {
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      },
    },
  });

  return AccountWithTransactionsSchema.parse(result);
}

/**
 * Get account balance (lightweight)
 */
export async function getAccountBalance(partnerId: string): Promise<number> {
  const validPartnerId = PartnerIdSchema.parse(partnerId);

  const account = await prisma.account.findUnique({
    where: { partnerId: validPartnerId },
    select: { balance: true },
  });

  return account?.balance ?? 0;
}

// ============================================================================
// TRANSACTIONAL MUTATIONS
// ============================================================================

/**
 * Record a completed deposit (called by Stripe webhook after payment succeeds)
 */
export async function recordDeposit(
  partnerId: string,
  amount: number,
  stripeSessionId: string,
  stripePaymentIntentId: string
): Promise<AccountTransaction> {
  const validPartnerId = PartnerIdSchema.parse(partnerId);
  const validAmount = z.number().positive().parse(amount);
  const validSessionId = z.string().min(1).parse(stripeSessionId);
  const validPaymentIntentId = z.string().min(1).parse(stripePaymentIntentId);

  return await prisma.$transaction(async (tx) => {
    // Get or create account
    let account = await tx.account.findUnique({
      where: { partnerId: validPartnerId },
    });

    if (!account) {
      account = await tx.account.create({
        data: { partnerId: validPartnerId },
      });
    }

    const newBalance = account.balance + validAmount;

    // Update balance
    await tx.account.update({
      where: { id: account.id },
      data: { balance: newBalance },
    });

    // Check if there's a pending transaction for this session
    const pendingTx = await tx.accountTransaction.findUnique({
      where: { stripeSessionId: validSessionId },
    });

    let transaction;
    if (pendingTx) {
      // Update existing pending transaction to completed
      transaction = await tx.accountTransaction.update({
        where: { id: pendingTx.id },
        data: {
          status: 'COMPLETED',
          balanceAfter: newBalance,
          stripePaymentIntentId: validPaymentIntentId,
        },
      });
    } else {
      // Create new completed transaction
      transaction = await tx.accountTransaction.create({
        data: {
          accountId: account.id,
          type: 'DEPOSIT',
          status: 'COMPLETED',
          amount: validAmount,
          balanceAfter: newBalance,
          description: `Deposit of $${validAmount.toFixed(2)}`,
          stripeSessionId: validSessionId,
          stripePaymentIntentId: validPaymentIntentId,
        },
      });
    }

    return AccountTransactionSchema.parse(transaction);
  });
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

  return await prisma.$transaction(async (tx) => {
    const account = await tx.account.findUnique({
      where: { partnerId: validPartnerId },
    });

    if (!account) {
      throw new Error('Account not found. Please add funds first.');
    }

    if (account.balance < validAmount) {
      throw new Error(
        `Insufficient balance. Available: $${account.balance.toFixed(2)}, Required: $${validAmount.toFixed(2)}`
      );
    }

    const newBalance = account.balance - validAmount;

    // Update balance
    await tx.account.update({
      where: { id: account.id },
      data: { balance: newBalance },
    });

    // Create charge transaction (negative amount)
    const transaction = await tx.accountTransaction.create({
      data: {
        accountId: account.id,
        type: 'CAMPAIGN_CHARGE',
        status: 'COMPLETED',
        amount: -validAmount,
        balanceAfter: newBalance,
        description: `Campaign charge: ${validCampaignName}`,
        campaignId: validCampaignId,
      },
    });

    return AccountTransactionSchema.parse(transaction);
  });
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

  return await prisma.$transaction(async (tx) => {
    const account = await tx.account.findUnique({
      where: { partnerId: validPartnerId },
    });

    if (!account) {
      throw new Error('Account not found');
    }

    const newBalance = account.balance + validAmount;

    // Update balance
    await tx.account.update({
      where: { id: account.id },
      data: { balance: newBalance },
    });

    // Create refund transaction (positive amount)
    const transaction = await tx.accountTransaction.create({
      data: {
        accountId: account.id,
        type: 'CAMPAIGN_REFUND',
        status: 'COMPLETED',
        amount: validAmount,
        balanceAfter: newBalance,
        description: `Campaign refund: ${validCampaignName}`,
        campaignId: validCampaignId,
      },
    });

    return AccountTransactionSchema.parse(transaction);
  });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a pending deposit transaction before Stripe confirms payment
 */
export async function createPendingDeposit(
  partnerId: string,
  amount: number,
  stripeSessionId: string
): Promise<AccountTransaction> {
  const validPartnerId = PartnerIdSchema.parse(partnerId);
  const validAmount = z.number().positive().parse(amount);
  const validSessionId = z.string().min(1).parse(stripeSessionId);

  const account = await getOrCreateAccount(validPartnerId);

  const transaction = await prisma.accountTransaction.create({
    data: {
      accountId: account.id,
      type: 'DEPOSIT',
      status: 'PENDING',
      amount: validAmount,
      balanceAfter: account.balance, // Balance hasn't changed yet
      description: `Pending deposit of $${validAmount.toFixed(2)}`,
      stripeSessionId: validSessionId,
    },
  });

  return AccountTransactionSchema.parse(transaction);
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

  const updated = await prisma.account.update({
    where: { id: account.id },
    data: { stripeCustomerId: validCustomerId },
  });

  return AccountSchema.parse(updated);
}
