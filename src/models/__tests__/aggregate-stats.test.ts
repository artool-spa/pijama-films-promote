/**
 * `getAggregateStats` must be scoped to one partner.
 *
 * Before this was scoped it aggregated over the whole `campaigns` collection,
 * so the KPI header on /films and /campaigns showed every producer's combined
 * advertising budget and campaign counts to whoever was logged in. That is
 * third-party commercial information, not just catalogue metadata.
 *
 * The partner argument is REQUIRED, and deliberately so: an optional argument
 * whose absence means "every partner" is the same defect wearing a parameter.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeFirestore } from '@/test/firestore-fake';

const db = new FakeFirestore();

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: () => db,
}));

// film.ts reaches Muvi at import time through the `#muvi` proxy; the
// aggregation under test never calls it, but the module graph must resolve.
vi.mock('#muvi', () => ({
  muvi: {},
  getMovies: vi.fn(),
  getMovieDetails: vi.fn(),
}));

// `src/test/firestore-fake.ts` reads aggregation specs as `{ kind, field }`,
// which is not the shape the real AggregateField produces. Without this the
// fake silently sums nothing and every total comes back 0 — which would make
// the cross-tenant assertions below pass for the wrong reason.
vi.mock('firebase-admin/firestore', () => ({
  AggregateField: {
    sum: (field: string) => ({ kind: 'sum', field }),
    count: () => ({ kind: 'count' }),
  },
}));

import { getAggregateStats } from '../film';

const OURS = 'partner-ours';
const THEIRS = 'partner-theirs';

function campaign(
  id: string,
  partnerId: string,
  status: string,
  budget: number
): void {
  const now = new Date('2026-01-01T00:00:00.000Z');

  db.write(
    `campaigns/${id}`,
    {
      name: `Campaign ${id}`,
      status,
      budget,
      partnerId,
      filmMuviUuid: 'film-1',
      createdAt: now,
      updatedAt: now,
    },
    false
  );
}

beforeEach(() => {
  db.reset();

  // Ours: 100 + 250 published (one of them active), plus a draft that must not
  // be counted at all.
  campaign('c1', OURS, 'ACTIVE', 100);
  campaign('c2', OURS, 'PAUSED', 250);
  campaign('c3', OURS, 'DRAFT', 999);

  // Theirs: must never appear in our totals.
  campaign('c4', THEIRS, 'ACTIVE', 5000);
  campaign('c5', THEIRS, 'PAUSED', 7000);
});

describe('getAggregateStats', () => {
  it('sums only the requesting partner’s published campaigns', async () => {
    const stats = await getAggregateStats(OURS);

    expect(stats.totalBudget).toBe(350);
    expect(stats.totalCampaigns).toBe(2);
    expect(stats.activeCampaigns).toBe(1);
  });

  it('does not leak another partner’s budget', async () => {
    const stats = await getAggregateStats(OURS);

    // 12350 is what the unscoped aggregation returned.
    expect(stats.totalBudget).not.toBe(12350);
    expect(stats.totalCampaigns).not.toBe(4);
  });

  it('gives each partner their own totals', async () => {
    const theirs = await getAggregateStats(THEIRS);

    expect(theirs.totalBudget).toBe(12000);
    expect(theirs.totalCampaigns).toBe(2);
    expect(theirs.activeCampaigns).toBe(1);
  });

  // The fail-closed case. A partner with nothing must see zeroes, never the
  // platform-wide figures.
  it('returns zeroes for a partner with no campaigns', async () => {
    const stats = await getAggregateStats('partner-with-nothing');

    expect(stats.totalBudget).toBe(0);
    expect(stats.totalCampaigns).toBe(0);
    expect(stats.activeCampaigns).toBe(0);
  });

  // An empty partner id must not degrade into "no filter". Firestore would
  // happily match nothing, but the guard states the intent at the boundary
  // instead of relying on that.
  it('refuses an empty partner id rather than aggregating everything', async () => {
    await expect(getAggregateStats('')).rejects.toThrow();
  });
});
