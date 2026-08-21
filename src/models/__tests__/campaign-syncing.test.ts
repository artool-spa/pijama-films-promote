import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeFirestore } from '@/test/firestore-fake';

const db = new FakeFirestore();

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: () => db,
}));

import {
  createCampaign,
  getCampaignById,
  getCampaignsStuckSyncing,
  markCampaignSynced,
  markCampaignSubmitted,
  markCampaignError,
} from '../campaign';

const PARTNER_ID = 'partner-1';
const FILM_UUID = 'film-uuid-1';

async function seedPartner(): Promise<void> {
  const now = new Date('2026-01-01T00:00:00.000Z');
  db.write(
    `partners/${PARTNER_ID}`,
    { partnerId: 'ext-1', name: 'Test Partner', createdAt: now, updatedAt: now },
    false
  );
}

async function newCampaign() {
  return createCampaign({
    name: 'Test Campaign',
    platforms: ['META'],
    objective: 'CONVERSIONS',
    budget: 100,
    budgetType: 'LIFETIME',
    startDate: new Date('2026-02-01T00:00:00.000Z'),
    language: 'es',
    targetCountries: ['US'],
    targetAgeMin: 18,
    targetAgeMax: 65,
    targetGenders: [],
    includeBaseAudiences: true,
    filmGenres: [],
    includeLgbtAudience: false,
    conversionEvent: 'PURCHASE',
    filmMuviUuid: FILM_UUID,
    partnerId: PARTNER_ID,
  });
}

describe('publish status transitions', () => {
  beforeEach(async () => {
    db.reset();
    await seedPartner();
  });

  it('lands on SYNCING when the platform objects exist but no ad does', async () => {
    const campaign = await newCampaign();

    const synced = await markCampaignSynced(campaign.id, 'meta-1', 'adset-img');

    // PENDING would tell the producer their ads are under review; nothing has
    // been submitted at this point.
    expect(synced.status).toBe('SYNCING');
    expect(synced.metaCampaignId).toBe('meta-1');
  });

  it('promotes to PENDING only once an ad exists', async () => {
    const campaign = await newCampaign();
    await markCampaignSynced(campaign.id, 'meta-1');

    const submitted = await markCampaignSubmitted(campaign.id);

    expect(submitted.status).toBe('PENDING');
    expect(submitted.metaCampaignId).toBe('meta-1');
  });

  it('can go from SYNCING straight to ERROR', async () => {
    const campaign = await newCampaign();
    await markCampaignSynced(campaign.id, 'meta-1');

    const errored = await markCampaignError(campaign.id, { message: 'Ad creation failed' });

    expect(errored.status).toBe('ERROR');
    expect(errored.lastSyncError).toBe('Ad creation failed');
  });
});

describe('getCampaignsStuckSyncing', () => {
  beforeEach(async () => {
    db.reset();
    await seedPartner();
  });

  it('returns a campaign left SYNCING past the cutoff', async () => {
    const campaign = await newCampaign();
    await markCampaignSynced(campaign.id, 'meta-1');

    const stuck = await getCampaignsStuckSyncing(new Date(Date.now() + 60_000));

    expect(stuck.map((c) => c.id)).toEqual([campaign.id]);
  });

  it('leaves a publish that is still running alone', async () => {
    const campaign = await newCampaign();
    await markCampaignSynced(campaign.id, 'meta-1');

    // Cutoff in the past: the campaign was touched more recently than that.
    const stuck = await getCampaignsStuckSyncing(new Date(Date.now() - 60_000));

    expect(stuck).toEqual([]);
  });

  it('ignores campaigns in any other status', async () => {
    const campaign = await newCampaign();
    await markCampaignSynced(campaign.id, 'meta-1');
    await markCampaignSubmitted(campaign.id);

    const stuck = await getCampaignsStuckSyncing(new Date(Date.now() + 60_000));

    expect(stuck).toEqual([]);
    expect((await getCampaignById(campaign.id))?.status).toBe('PENDING');
  });
});
