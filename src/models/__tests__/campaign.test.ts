import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeFirestore } from '@/test/firestore-fake';

const db = new FakeFirestore();

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: () => db,
}));

import { createCampaign, getCampaignById, getCampaignsByFilmMuviUuid, getCampaignsByPartnerId, deleteCampaign, recomputeApprovalSummary, updateCampaign } from '../campaign';
import { createAd, getAdsByCampaignId, updateAd, getDisapprovedAdsByCampaign } from '../ad';
import { createImage, getImagesWithUsageByFilmMuviUuid, deleteImage } from '../image';

const PARTNER_ID = 'partner-1';
const FILM_UUID = 'film-uuid-1';

async function seedPartner(): Promise<void> {
  const now = new Date('2026-01-01T00:00:00.000Z');
  db.write(`partners/${PARTNER_ID}`, { partnerId: 'ext-1', name: 'Test Partner', createdAt: now, updatedAt: now }, false);
}

// The create schemas expose their post-default shape, so a test has to spell
// out every field the database used to fill in.
async function newCampaign(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  });
}

async function newAd(campaignId: string, imageIds: string[], name = 'Ad 1') {
  return createAd({
    name,
    headlines: ['Headline'],
    bodies: ['Body'],
    descriptions: [],
    callToAction: 'WATCH_MORE',
    linkUrl: 'https://example.com/film',
    imageIds,
    videoIds: [],
    campaignId,
  });
}

async function newImage(name = 'Poster') {
  return createImage({
    filmMuviUuid: FILM_UUID,
    name,
    originalUrl: `https://example.com/${name}.jpg`,
    storageKey: `images/${name}.jpg`,
    url: `https://cdn.example.com/${name}.jpg`,
    mimeType: 'image/jpeg',
    size: 1024,
  });
}

describe('campaign graph', () => {
  beforeEach(async () => {
    db.reset();
    await seedPartner();
  });

  describe('createCampaign', () => {
    it('applies the defaults the database used to supply', async () => {
      const campaign = await newCampaign();

      expect(campaign.status).toBe('DRAFT');
      expect(campaign.platforms).toEqual(['META']);
      expect(campaign.budgetType).toBe('LIFETIME');
      expect(campaign.optimizationGoal).toBe('OFFSITE_CONVERSIONS');
      expect(campaign.metaCampaignId).toBeNull();
      expect(campaign.targetCpvMicros).toBeNull();
    });

    it('attaches the partner', async () => {
      const campaign = await newCampaign();

      expect(campaign.partner.name).toBe('Test Partner');
    });
  });

  describe('getCampaignById', () => {
    it('returns null for an unknown id', async () => {
      expect(await getCampaignById('nope')).toBeNull();
    });

    it('resolves campaign -> ads -> images, which used to be one join', async () => {
      const campaign = await newCampaign();
      const image = await newImage();

      await newAd(campaign.id, [image.id], 'Ad 1');

      const loaded = await getCampaignById(campaign.id);

      expect(loaded?.ads).toHaveLength(1);
      expect(loaded?.ads[0].images).toHaveLength(1);
      expect(loaded?.ads[0].images[0].name).toBe('Poster');
      expect(loaded?.partner.name).toBe('Test Partner');
    });

    it('skips media that no longer exists instead of failing', async () => {
      const campaign = await newCampaign();
      const image = await newImage();

      await newAd(campaign.id, [image.id], 'Ad 1');

      db.store.delete(`images/${image.id}`);

      const loaded = await getCampaignById(campaign.id);

      expect(loaded?.ads[0].images).toEqual([]);
    });
  });

  describe('getCampaignsByFilmMuviUuid', () => {
    it('hides drafts', async () => {
      const draft = await newCampaign({ name: 'Draft' });
      const published = await newCampaign({ name: 'Published' });
      await updateCampaign(published.id, { status: 'ACTIVE' });

      const results = await getCampaignsByFilmMuviUuid(FILM_UUID);

      expect(results.map((campaign) => campaign.name)).toEqual(['Published']);
      expect(results.some((campaign) => campaign.id === draft.id)).toBe(false);
    });

    it('scopes to the film', async () => {
      const mine = await newCampaign();
      await updateCampaign(mine.id, { status: 'ACTIVE' });
      const other = await newCampaign({ filmMuviUuid: 'another-film' });
      await updateCampaign(other.id, { status: 'ACTIVE' });

      const results = await getCampaignsByFilmMuviUuid(FILM_UUID);

      expect(results).toHaveLength(1);
      expect(results[0].filmMuviUuid).toBe(FILM_UUID);
    });
  });

  describe('getCampaignsByPartnerId', () => {
    it('returns every campaign of the partner, drafts included', async () => {
      await newCampaign({ name: 'One' });
      await newCampaign({ name: 'Two' });

      const results = await getCampaignsByPartnerId(PARTNER_ID);

      expect(results).toHaveLength(2);
    });
  });

  describe('deleteCampaign', () => {
    it('refuses to delete a campaign that is not a draft', async () => {
      const campaign = await newCampaign();
      await updateCampaign(campaign.id, { status: 'ACTIVE' });

      await expect(deleteCampaign(campaign.id)).rejects.toThrow('borrador');
    });

    it('deletes a draft', async () => {
      const campaign = await newCampaign();

      await deleteCampaign(campaign.id);

      expect(await getCampaignById(campaign.id)).toBeNull();
    });
  });

  describe('recomputeApprovalSummary', () => {
    it('ignores ads that never reached a platform', async () => {
      const campaign = await newCampaign();
      const image = await newImage();
      await newAd(campaign.id, [image.id], 'Unsynced');

      expect(await recomputeApprovalSummary(campaign.id)).toBe('UNKNOWN');
    });

    it('rolls a disapproved ad up to the campaign', async () => {
      const campaign = await newCampaign();
      const image = await newImage();
      const ad = await newAd(campaign.id, [image.id], 'Synced');

      db.write(`ads/${ad.id}`, { metaAdId: 'meta-1', approvalStatus: 'DISAPPROVED' }, true);

      expect(await recomputeApprovalSummary(campaign.id)).toBe('ALL_DISAPPROVED');
    });
  });
});

describe('ad media relations', () => {
  beforeEach(async () => {
    db.reset();
    await seedPartner();
  });

  it('replaces the whole media list on update', async () => {
    const campaign = await newCampaign();
    const first = await newImage('First');
    const second = await newImage('Second');

    const ad = await newAd(campaign.id, [first.id], 'Ad 1');

    const updated = await updateAd(ad.id, { imageIds: [second.id] });

    expect(updated.images.map((image) => image.name)).toEqual(['Second']);
  });

  it('counts how many ads use an image', async () => {
    const campaign = await newCampaign();
    const image = await newImage();

    await newAd(campaign.id, [image.id], 'Ad 1');

    const [withUsage] = await getImagesWithUsageByFilmMuviUuid(FILM_UUID);

    expect(withUsage._count.ads).toBe(1);
  });

  it('refuses to delete an image an ad depends on', async () => {
    const campaign = await newCampaign();
    const image = await newImage();

    await newAd(campaign.id, [image.id], 'Ad 1');

    await expect(deleteImage(image.id)).rejects.toThrow('being used by ads');
  });

  it('lists ads of a campaign with their media attached', async () => {
    const campaign = await newCampaign();
    const image = await newImage();

    await newAd(campaign.id, [image.id], 'Ad 1');

    const ads = await getAdsByCampaignId(campaign.id);

    expect(ads).toHaveLength(1);
    expect(ads[0].images[0].id).toBe(image.id);
    expect(ads[0].videos).toEqual([]);
  });

  it('finds the disapproved ads of a campaign', async () => {
    const campaign = await newCampaign();
    const image = await newImage();
    const ad = await newAd(campaign.id, [image.id], 'Ad 1');

    db.write(`ads/${ad.id}`, { approvalStatus: 'DISAPPROVED', rejectionReason: 'Policy' }, true);

    const disapproved = await getDisapprovedAdsByCampaign(campaign.id);

    expect(disapproved).toEqual([
      { id: ad.id, name: 'Ad 1', rejectionReason: 'Policy', approvalStatus: 'DISAPPROVED' },
    ]);
  });
});
