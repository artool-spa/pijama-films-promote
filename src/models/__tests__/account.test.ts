import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import prisma from '#prisma';
import {
  getOrCreateAccount,
  getAccountWithTransactions,
  getAccountBalance,
  recordDeposit,
  chargeCampaignBudget,
  refundCampaignBudget,
  createPendingDeposit,
  cancelPendingDeposit,
  updateStripeCustomerId,
  creditFeeAdjustment,
} from '../account';

describe('Account Model', () => {
  let partnerId: string;
  let campaignId: string;

  beforeEach(async () => {
    // Create test partner
    const partner = await prisma.partner.create({
      data: {
        partnerId: `test-partner-${Date.now()}`,
        name: 'Test Partner',
      },
    });
    partnerId = partner.id;

    // Create test campaign
    const campaign = await prisma.campaign.create({
      data: {
        name: 'Test Campaign',
        objective: 'CONVERSIONS',
        budget: 100,
        startDate: new Date(),
        filmMuviUuid: 'test-film-uuid',
        partnerId: partnerId,
      },
    });
    campaignId = campaign.id;
  });

  afterEach(async () => {
    // Cleanup in order (transactions → accounts → campaigns → partners)
    await prisma.accountTransaction.deleteMany({
      where: { account: { partnerId } },
    });
    await prisma.account.deleteMany({ where: { partnerId } });
    await prisma.campaign.deleteMany({ where: { partnerId } });
    await prisma.partner.deleteMany({ where: { id: partnerId } });
  });

  describe('getOrCreateAccount', () => {
    it('should create a new account for a partner', async () => {
      const account = await getOrCreateAccount(partnerId);

      expect(account).toBeDefined();
      expect(account.partnerId).toBe(partnerId);
      expect(account.balance).toBe(0);
      expect(account.currency).toBe('usd');
    });

    it('should return existing account on second call', async () => {
      const first = await getOrCreateAccount(partnerId);
      const second = await getOrCreateAccount(partnerId);

      expect(first.id).toBe(second.id);
    });
  });

  describe('getAccountBalance', () => {
    it('should return 0 for a partner without an account', async () => {
      const balance = await getAccountBalance(partnerId);
      expect(balance).toBe(0);
    });

    it('should return correct balance after deposit', async () => {
      await getOrCreateAccount(partnerId);
      await recordDeposit(partnerId, 100, `session-${Date.now()}`, `pi-${Date.now()}`);

      const balance = await getAccountBalance(partnerId);
      expect(balance).toBe(100);
    });
  });

  describe('getAccountWithTransactions', () => {
    it('should return account with empty transactions', async () => {
      const result = await getAccountWithTransactions(partnerId);

      expect(result).toBeDefined();
      expect(result.balance).toBe(0);
      expect(result.transactions).toEqual([]);
    });

    it('should return transactions ordered by createdAt desc', async () => {
      await getOrCreateAccount(partnerId);
      const ts = Date.now();
      await recordDeposit(partnerId, 50, `session-${ts}-1`, `pi-${ts}-1`);
      await recordDeposit(partnerId, 100, `session-${ts}-2`, `pi-${ts}-2`);

      const result = await getAccountWithTransactions(partnerId);
      expect(result.transactions).toHaveLength(2);
      expect(result.transactions[0].amount).toBe(100);
      expect(result.transactions[1].amount).toBe(50);
    });
  });

  describe('recordDeposit', () => {
    it('should credit balance and create completed transaction', async () => {
      const ts = Date.now();
      const transaction = await recordDeposit(partnerId, 250, `session-${ts}`, `pi-${ts}`);

      expect(transaction.type).toBe('DEPOSIT');
      expect(transaction.status).toBe('COMPLETED');
      expect(transaction.amount).toBe(250);
      expect(transaction.balanceAfter).toBe(250);

      const balance = await getAccountBalance(partnerId);
      expect(balance).toBe(250);
    });

    it('should update pending transaction if one exists', async () => {
      const ts = Date.now();
      const sessionId = `session-${ts}`;
      await createPendingDeposit(partnerId, 100, 106.20, 6.20, sessionId);

      const transaction = await recordDeposit(partnerId, 100, sessionId, `pi-${ts}`);

      expect(transaction.status).toBe('COMPLETED');
      expect(transaction.stripePaymentIntentId).toBe(`pi-${ts}`);

      // Should only have one transaction
      const result = await getAccountWithTransactions(partnerId);
      expect(result.transactions).toHaveLength(1);
    });

    it('should accumulate multiple deposits', async () => {
      const ts = Date.now();
      await recordDeposit(partnerId, 100, `session-${ts}-1`, `pi-${ts}-1`);
      await recordDeposit(partnerId, 200, `session-${ts}-2`, `pi-${ts}-2`);

      const balance = await getAccountBalance(partnerId);
      expect(balance).toBe(300);
    });
  });

  describe('chargeCampaignBudget', () => {
    it('should debit balance and create charge transaction', async () => {
      const ts = Date.now();
      await recordDeposit(partnerId, 500, `session-${ts}`, `pi-${ts}`);

      const transaction = await chargeCampaignBudget(partnerId, campaignId, 100, 'Test Campaign');

      expect(transaction.type).toBe('CAMPAIGN_CHARGE');
      expect(transaction.status).toBe('COMPLETED');
      expect(transaction.amount).toBe(-100);
      expect(transaction.balanceAfter).toBe(400);
      expect(transaction.campaignId).toBe(campaignId);

      const balance = await getAccountBalance(partnerId);
      expect(balance).toBe(400);
    });

    it('should throw on insufficient funds', async () => {
      await getOrCreateAccount(partnerId);

      await expect(
        chargeCampaignBudget(partnerId, campaignId, 100, 'Test Campaign')
      ).rejects.toThrow('Insufficient balance');
    });

    it('should throw if no account exists', async () => {
      await expect(
        chargeCampaignBudget(partnerId, campaignId, 100, 'Test Campaign')
      ).rejects.toThrow('Account not found');
    });
  });

  describe('refundCampaignBudget', () => {
    it('should credit balance back and create refund transaction', async () => {
      const ts = Date.now();
      await recordDeposit(partnerId, 500, `session-${ts}`, `pi-${ts}`);
      await chargeCampaignBudget(partnerId, campaignId, 200, 'Test Campaign');

      const transaction = await refundCampaignBudget(partnerId, campaignId, 200, 'Test Campaign');

      expect(transaction.type).toBe('CAMPAIGN_REFUND');
      expect(transaction.status).toBe('COMPLETED');
      expect(transaction.amount).toBe(200);
      expect(transaction.balanceAfter).toBe(500);

      const balance = await getAccountBalance(partnerId);
      expect(balance).toBe(500);
    });
  });

  describe('createPendingDeposit', () => {
    it('should create a pending deposit transaction without changing balance', async () => {
      const ts = Date.now();
      const transaction = await createPendingDeposit(partnerId, 100, 106.20, 6.20, `session-${ts}`);

      expect(transaction.type).toBe('DEPOSIT');
      expect(transaction.status).toBe('PENDING');
      expect(transaction.amount).toBe(100);
      expect(transaction.stripeFee).toBe(6.20);
      expect(transaction.grossAmount).toBe(106.20);
      expect(transaction.balanceAfter).toBe(0); // Balance unchanged

      const balance = await getAccountBalance(partnerId);
      expect(balance).toBe(0); // Still 0
    });
  });

  describe('recordDeposit idempotency', () => {
    it('should not double-credit when called twice with the same session', async () => {
      const ts = Date.now();
      const sessionId = `session-${ts}`;
      const paymentIntentId = `pi-${ts}`;

      await createPendingDeposit(partnerId, 100, 106.20, 6.20, sessionId);

      // First call: should credit the balance
      const tx1 = await recordDeposit(partnerId, 100, sessionId, paymentIntentId);
      expect(tx1.status).toBe('COMPLETED');

      const balanceAfterFirst = await getAccountBalance(partnerId);
      expect(balanceAfterFirst).toBe(100);

      // Second call: should return the same transaction without crediting again
      const tx2 = await recordDeposit(partnerId, 100, sessionId, paymentIntentId);
      expect(tx2.id).toBe(tx1.id);
      expect(tx2.status).toBe('COMPLETED');

      const balanceAfterSecond = await getAccountBalance(partnerId);
      expect(balanceAfterSecond).toBe(100); // Still 100, not 200
    });
  });

  describe('cancelPendingDeposit', () => {
    it('should cancel a pending deposit', async () => {
      const ts = Date.now();
      const sessionId = `session-${ts}`;
      await createPendingDeposit(partnerId, 100, 106.20, 6.20, sessionId);

      const result = await cancelPendingDeposit(sessionId);

      expect(result).not.toBeNull();
      expect(result!.status).toBe('CANCELLED');
      expect(result!.stripeSessionId).toBe(sessionId);

      // Balance should remain unchanged
      const balance = await getAccountBalance(partnerId);
      expect(balance).toBe(0);
    });

    it('should return null for an already completed transaction', async () => {
      const ts = Date.now();
      const sessionId = `session-${ts}`;
      await createPendingDeposit(partnerId, 100, 106.20, 6.20, sessionId);
      await recordDeposit(partnerId, 100, sessionId, `pi-${ts}`);

      const result = await cancelPendingDeposit(sessionId);
      expect(result).toBeNull();
    });

    it('should return null for an unknown session ID', async () => {
      const result = await cancelPendingDeposit('cs_unknown_session');
      expect(result).toBeNull();
    });
  });

  describe('creditFeeAdjustment', () => {
    it('should credit adjustment and create ADJUSTMENT transaction', async () => {
      const ts = Date.now();
      // First deposit some funds
      await recordDeposit(partnerId, 100, `session-${ts}`, `pi-${ts}`);

      const transaction = await creditFeeAdjustment(partnerId, 1.50, `pi-${ts}`);

      expect(transaction).not.toBeNull();
      expect(transaction!.type).toBe('ADJUSTMENT');
      expect(transaction!.status).toBe('COMPLETED');
      expect(transaction!.amount).toBe(1.50);
      expect(transaction!.balanceAfter).toBe(101.50);
      expect(transaction!.stripePaymentIntentId).toBe(`pi-${ts}`);

      const balance = await getAccountBalance(partnerId);
      expect(balance).toBe(101.50);
    });

    it('should be idempotent — return existing adjustment on second call', async () => {
      const ts = Date.now();
      await recordDeposit(partnerId, 100, `session-${ts}`, `pi-${ts}`);

      const tx1 = await creditFeeAdjustment(partnerId, 1.50, `pi-${ts}`);
      const tx2 = await creditFeeAdjustment(partnerId, 1.50, `pi-${ts}`);

      expect(tx1!.id).toBe(tx2!.id);

      // Balance should only be credited once
      const balance = await getAccountBalance(partnerId);
      expect(balance).toBe(101.50);
    });
  });

  describe('updateStripeCustomerId', () => {
    it('should update the Stripe customer ID', async () => {
      const account = await updateStripeCustomerId(partnerId, 'cus_test123');

      expect(account.stripeCustomerId).toBe('cus_test123');
    });
  });
});
