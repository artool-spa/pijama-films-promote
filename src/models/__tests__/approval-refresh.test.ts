import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeFirestore } from '@/test/firestore-fake';

const db = new FakeFirestore();

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: () => db,
}));

import { getAdsNeedingApprovalRefresh, markApprovalCheckAttempted } from '../ad';

const CAMPAIGN_ID = 'campaign-1';
const NOW = new Date('2026-03-01T12:00:00.000Z');

function seedCampaign(): void {
  db.write(
    `campaigns/${CAMPAIGN_ID}`,
    { partnerId: 'partner-1', status: 'PENDING', createdAt: NOW, updatedAt: NOW },
    false
  );
}

function seedAd(id: string, approvalCheckedAt: Date | null): void {
  db.write(
    `ads/${id}`,
    {
      campaignId: CAMPAIGN_ID,
      metaAdId: `meta-${id}`,
      googleAdId: null,
      approvalStatus: 'UNKNOWN',
      approvalCheckedAt,
      createdAt: NOW,
      updatedAt: NOW,
    },
    false
  );
}

async function nextInLine(): Promise<string | undefined> {
  const { metaAds } = await getAdsNeedingApprovalRefresh({
    olderThanMinutes: 15,
    metaLimit: 1,
  });

  return metaAds[0]?.id;
}

describe('approval refresh does not let a failing ad hold the batch', () => {
  beforeEach(() => {
    db.reset();
    seedCampaign();
  });

  it('puts a never-checked ad ahead of one checked long ago', async () => {
    seedAd('ad-stale', new Date('2026-03-01T00:00:00.000Z'));
    seedAd('ad-never', null);

    expect(await nextInLine()).toBe('ad-never');
  });

  /**
   * The regression this guards, and the reason markApprovalCheckAttempted
   * exists. With a batch of 50 and a run every 15 minutes, an ad whose refresh
   * always fails keeps a null `approvalCheckedAt`, sorts first on every run,
   * and consumes a slot forever. Right after an ad account changes that is not
   * one ad but all of them, so no newly created ad is ever checked and its
   * review status simply never arrives.
   *
   * Recording the attempt is what lets the queue move on.
   */
  it('lets the next ad through once the failed attempt is recorded', async () => {
    seedAd('ad-broken', null);
    seedAd('ad-waiting', null);

    const first = await nextInLine();
    expect(first).toBeDefined();

    // Simulate the refresh failing for whichever ad came first.
    await markApprovalCheckAttempted(first as string);

    const second = await nextInLine();
    expect(second, 'the same ad must not take the slot twice in a row').not.toBe(first);
    expect(second).toBe(first === 'ad-broken' ? 'ad-waiting' : 'ad-broken');
  });

  it('keeps the approval status untouched when only the attempt is recorded', async () => {
    seedAd('ad-broken', null);

    await markApprovalCheckAttempted('ad-broken');

    const stored = db.store.get('ads/ad-broken') as Record<string, unknown> | undefined;
    expect(stored?.approvalStatus, 'a failed call tells us nothing about the ad').toBe('UNKNOWN');
    expect(stored?.approvalCheckedAt).toBeInstanceOf(Date);
  });

  it('stops offering an ad whose attempt is newer than the cutoff', async () => {
    seedAd('ad-broken', null);

    await markApprovalCheckAttempted('ad-broken');

    expect(await nextInLine(), 'it comes back only after the staleness window').toBeUndefined();
  });
});
