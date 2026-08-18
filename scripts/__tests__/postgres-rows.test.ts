/**
 * The migration's contract is that a document written from a Postgres row is
 * indistinguishable from one the application wrote itself. These tests assert
 * exactly that: every transform is fed a row shaped like `row_to_json` output
 * and its result is validated with the *model's own* read schema, then read
 * back through the models against the in-memory Firestore.
 *
 * A field the migration forgets therefore fails here rather than as a 500 on a
 * production page.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeFirestore } from '@/test/firestore-fake';

const db = new FakeFirestore();

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: () => db,
}));

import { compositeId as modelCompositeId } from '@/lib/firestore';
import { PartnerSchema } from '@/models/partner';
import { CampaignSchema, AdSchema } from '@/models/campaign';
import { ImageSchema } from '@/models/image';
import { VideoSchema } from '@/models/video';
import { AccountSchema, AccountTransactionSchema } from '@/models/account';
import { UserPreferenceSchema } from '@/models/userPreference';
import { getCampaignById } from '@/models/campaign';
import { getAccountWithTransactions } from '@/models/account';

import {
  AccountRow,
  AccountTransactionRow,
  AdRow,
  CampaignRow,
  GeneratedCopyRow,
  ImageRow,
  PartnerRow,
  UserPreferenceRow,
  VideoRow,
  accountDoc,
  adDoc,
  campaignDoc,
  compositeId,
  findNestedArray,
  generatedCopyDoc,
  groupRelations,
  imageDoc,
  partnerDoc,
  pgDate,
  transactionDoc,
  userPreferenceDoc,
  videoDoc,
} from '../lib/postgres-rows';

// ============================================================================
// FIXTURES — shaped exactly like `select row_to_json(t)` output
// ============================================================================

const PARTNER = {
  id: 'clpartner0001',
  partnerId: 'pijamafilms',
  name: 'Pijama Films',
  createdAt: '2026-01-15T10:00:00.000',
  updatedAt: '2026-01-15T10:00:00.000',
};

const CAMPAIGN = {
  id: 'clcampaign0001',
  platforms: ['META', 'GOOGLE'],
  metaCampaignId: '1203',
  imageAdSetId: null,
  videoAdSetId: null,
  googleCampaignId: 'customers/1/campaigns/2',
  googleAdGroupId: null,
  googleEntityStatus: 'ENABLED',
  googleBidStrategy: 'TARGET_CPV',
  targetCpvMicros: 30000,
  name: 'Lanzamiento',
  status: 'ACTIVE',
  objective: 'CONVERSIONS',
  budget: 250.5,
  budgetType: 'LIFETIME',
  startDate: '2026-02-01T00:00:00.000',
  endDate: null,
  language: 'es',
  targetCountries: ['CL', 'AR'],
  targetAgeMin: 18,
  targetAgeMax: 65,
  targetGenders: [1, 2],
  includeBaseAudiences: true,
  filmGenres: ['Drama'],
  includeLgbtAudience: false,
  pixelId: null,
  conversionEvent: 'PURCHASE',
  optimizationGoal: 'OFFSITE_CONVERSIONS',
  billingEvent: 'IMPRESSIONS',
  bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
  filmMuviUuid: 'film-uuid-1',
  partnerId: PARTNER.id,
  createdAt: '2026-01-20T12:00:00.000',
  updatedAt: '2026-01-21T12:00:00.000',
  syncedAt: '2026-01-21T12:05:00.000',
  draftFormState: { step: 2, selected: ['a', 'b'] },
  approvalSummary: 'ALL_APPROVED',
  lastSyncError: null,
  lastSyncErrorAt: null,
  lastSyncErrorDetails: null,
};

const AD = {
  id: 'clad0001',
  metaAdId: '9001',
  googleAdId: null,
  youtubeAdFormat: null,
  name: 'Ad principal',
  status: 'ACTIVE',
  adSetType: 'IMAGE',
  headlines: ['Verla ahora'],
  bodies: ['Un drama chileno'],
  descriptions: [],
  callToAction: 'WATCH_MORE',
  linkUrl: 'https://pijamafilms.com/film',
  campaignId: CAMPAIGN.id,
  createdAt: '2026-01-20T13:00:00.000',
  updatedAt: '2026-01-20T13:00:00.000',
  syncedAt: null,
  approvalStatus: 'APPROVED',
  approvalCheckedAt: '2026-01-22T09:00:00.000',
  rejectionReason: null,
  rejectionDetails: null,
  suggestedCorrection: null,
  reviewSeenAt: null,
};

const IMAGE = {
  id: 'climage0001',
  filmMuviUuid: 'film-uuid-1',
  name: 'poster.jpg',
  originalUrl: 'poster.jpg',
  storageKey: 'images/climage0001.jpg',
  url: 'https://storage.googleapis.com/bucket/images/climage0001.jpg',
  mimeType: 'image/jpeg',
  size: 204800,
  width: 1080,
  height: 1080,
  archived: false,
  createdAt: '2026-01-19T08:00:00.000',
  status: 'READY',
  validatedAt: '2026-01-19T08:00:05.000',
  validationError: null,
  aspectRatio: '1:1',
  metaImageHash: 'abc123',
  facebookEligible: true,
  instagramEligible: true,
  googleEligible: false,
  eligibilityError: null,
};

const VIDEO = {
  id: 'clvideo0001',
  filmMuviUuid: 'film-uuid-1',
  name: 'trailer.mp4',
  originalUrl: 'trailer.mp4',
  storageKey: 'videos/clvideo0001.mp4',
  url: 'https://storage.googleapis.com/bucket/videos/clvideo0001.mp4',
  mimeType: 'video/mp4',
  size: 10485760,
  duration: 45,
  thumbnailUrl: null,
  metaVideoId: null,
  archived: false,
  createdAt: '2026-01-19T09:00:00.000',
  status: 'READY',
  validatedAt: '2026-01-19T09:00:10.000',
  validationError: null,
  width: 1920,
  height: 1080,
  aspectRatio: '16:9',
  facebookEligible: true,
  instagramEligible: false,
  youtubeEligible: true,
  youtubeVideoId: null,
  eligibilityError: null,
};

const ACCOUNT = {
  id: 'claccount0001',
  partnerId: PARTNER.id,
  balance: 120.25,
  currency: 'usd',
  stripeCustomerId: 'cus_123',
  createdAt: '2026-01-16T10:00:00.000',
  updatedAt: '2026-01-25T10:00:00.000',
};

const TRANSACTION = {
  id: 'cltx0001',
  accountId: ACCOUNT.id,
  type: 'DEPOSIT',
  status: 'COMPLETED',
  amount: 200,
  balanceAfter: 200,
  description: 'Deposit of $200.00',
  stripeFee: 6.5,
  grossAmount: 206.5,
  stripeSessionId: 'cs_test_1',
  stripePaymentIntentId: 'pi_1',
  campaignId: null,
  createdAt: '2026-01-16T10:05:00.000',
  updatedAt: '2026-01-16T10:05:00.000',
};

/** Reproduce what `docData` does on read: merge the id back into the data. */
function asRead(doc: { id: string; data: Record<string, unknown> }) {
  return { id: doc.id, ...doc.data };
}

// ============================================================================
// SCALARS
// ============================================================================

describe('pgDate', () => {
  it('reads a naive timestamp as UTC', () => {
    // Prisma writes UTC into `timestamp(3)`, which carries no offset. Parsing
    // it as local time would shift every date by the importer's own offset.
    expect(pgDate('2026-02-01T14:14:31.431').toISOString()).toBe('2026-02-01T14:14:31.431Z');
  });

  it('honours an explicit offset', () => {
    expect(pgDate('2026-02-01T14:14:31.431Z').toISOString()).toBe('2026-02-01T14:14:31.431Z');
    expect(pgDate('2026-02-01T11:14:31.431-03:00').toISOString()).toBe('2026-02-01T14:14:31.431Z');
  });

  it('passes a Date through and rejects nonsense', () => {
    const date = new Date('2026-02-01T00:00:00.000Z');
    expect(pgDate(date)).toBe(date);
    expect(() => pgDate('not a date')).toThrow();
  });
});

describe('compositeId', () => {
  it('matches the implementation the models use', () => {
    // The script copy exists only because scripts run without the `@/` alias.
    for (const parts of [
      ['film-1', 'es', 'A'],
      ['film/with/slashes', 'pt', 'B'],
      ['film_with_underscores', 'en', 'C'],
    ]) {
      expect(compositeId(...parts)).toBe(modelCompositeId(...parts));
    }
  });
});

describe('findNestedArray', () => {
  it('finds an array inside an array, which Firestore rejects', () => {
    expect(findNestedArray({ a: [[1]] })).toBe('a[0]');
    expect(findNestedArray([{ b: { c: [['x']] } }])).toBe('[0].b.c[0]');
  });

  it('accepts arrays of scalars and objects', () => {
    expect(findNestedArray({ a: [1, 2], b: [{ c: 'd' }], e: null })).toBeNull();
  });
});

describe('groupRelations', () => {
  it('groups join rows by ad id', () => {
    const grouped = groupRelations([
      { A: 'ad1', B: 'img2' },
      { A: 'ad1', B: 'img1' },
      { A: 'ad2', B: 'img3' },
    ]);

    expect(grouped.get('ad1')).toEqual(['img1', 'img2']);
    expect(grouped.get('ad2')).toEqual(['img3']);
  });
});

// ============================================================================
// TRANSFORMS — validated with the models' own read schemas
// ============================================================================

describe('transforms produce documents the models accept', () => {
  it('partner', () => {
    const doc = partnerDoc(PartnerRow.parse(PARTNER));
    expect(doc.id).toBe(PARTNER.id);
    expect(() => PartnerSchema.parse(asRead(doc))).not.toThrow();
  });

  it('campaign', () => {
    const doc = campaignDoc(CampaignRow.parse(CAMPAIGN));
    const parsed = CampaignSchema.parse(asRead(doc));

    expect(doc.id).toBe(CAMPAIGN.id);
    expect(parsed.partnerId).toBe(PARTNER.id);
    // Stored as a number, handed back as the bigint the callers expect.
    expect(doc.data.targetCpvMicros).toBe(30000);
    expect(parsed.targetCpvMicros).toBe(BigInt(30000));
    expect(parsed.startDate.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(parsed.draftFormState).toEqual({ step: 2, selected: ['a', 'b'] });
  });

  it('ad, with the join tables folded into imageIds/videoIds', () => {
    const doc = adDoc(AdRow.parse(AD), [IMAGE.id], [VIDEO.id]);

    expect(doc.data.imageIds).toEqual([IMAGE.id]);
    expect(doc.data.videoIds).toEqual([VIDEO.id]);
    // The read schema sees the hydrated relations, which `attachMedia` builds
    // from those ids.
    expect(() =>
      AdSchema.parse({ ...asRead(doc), images: [], videos: [] })
    ).not.toThrow();
  });

  it('image and video', () => {
    expect(() => ImageSchema.parse(asRead(imageDoc(ImageRow.parse(IMAGE))))).not.toThrow();
    expect(() => VideoSchema.parse(asRead(videoDoc(VideoRow.parse(VIDEO))))).not.toThrow();
  });

  it('account, keyed by partner id rather than its own cuid', () => {
    const doc = accountDoc(AccountRow.parse(ACCOUNT));

    expect(doc.id).toBe(PARTNER.id);
    expect(AccountSchema.parse(asRead(doc)).balance).toBe(120.25);
  });

  it('ledger entry, with accountId rewritten to the partner id', () => {
    const doc = transactionDoc(AccountTransactionRow.parse(TRANSACTION), PARTNER.id);

    expect(doc.id).toBe(TRANSACTION.id);
    // Postgres pointed this at the account cuid; the models write the partner id.
    expect(doc.data.accountId).toBe(PARTNER.id);
    expect(() => AccountTransactionSchema.parse(asRead(doc))).not.toThrow();
  });

  it('user preference, keyed by email', () => {
    const doc = userPreferenceDoc(
      UserPreferenceRow.parse({
        id: 'clpref0001',
        email: 'admin@pijamafilms.com',
        howItWorksDismissed: true,
        createdAt: '2026-01-18T00:00:00.000',
        updatedAt: '2026-01-18T00:00:00.000',
      })
    );

    expect(doc.id).toBe('admin@pijamafilms.com');
    expect(() => UserPreferenceSchema.parse(asRead(doc))).not.toThrow();
  });

  it('generated copy, keyed by the composite that replaced the unique index', () => {
    const doc = generatedCopyDoc(
      GeneratedCopyRow.parse({
        id: 'clcopy0001',
        filmId: 'film-1',
        language: 'es',
        headline: 'Titular',
        primaryText: 'Texto',
        description: 'Desc',
        callToAction: 'WATCH_MORE',
        variant: 'A',
        createdAt: '2026-01-18T00:00:00.000',
      })
    );

    // The cuid is dropped: the model only ever looks a copy up by this id.
    expect(doc.id).toBe(compositeId('film-1', 'es', 'A'));
    expect(doc.data.id).toBeUndefined();
  });
});

// ============================================================================
// ROUND TRIP — imported documents read back through the models
// ============================================================================

describe('imported documents read back through the model layer', () => {
  beforeEach(() => {
    db.reset();

    const write = (path: string, doc: { id: string; data: Record<string, unknown> }) =>
      db.write(`${path}/${doc.id}`, doc.data, false);

    write('partners', partnerDoc(PartnerRow.parse(PARTNER)));
    write('campaigns', campaignDoc(CampaignRow.parse(CAMPAIGN)));
    write('ads', adDoc(AdRow.parse(AD), [IMAGE.id], [VIDEO.id]));
    write('images', imageDoc(ImageRow.parse(IMAGE)));
    write('videos', videoDoc(VideoRow.parse(VIDEO)));
    write('accounts', accountDoc(AccountRow.parse(ACCOUNT)));

    const ledger = transactionDoc(AccountTransactionRow.parse(TRANSACTION), PARTNER.id);
    db.write(`accounts/${PARTNER.id}/transactions/${ledger.id}`, ledger.data, false);
  });

  it('hydrates the campaign graph, media included', async () => {
    const campaign = await getCampaignById(CAMPAIGN.id);

    expect(campaign).not.toBeNull();
    expect(campaign?.name).toBe('Lanzamiento');
    expect(campaign?.ads).toHaveLength(1);
    // `imageIds` resolved back into the relation the join used to provide.
    expect(campaign?.ads[0].images.map((image) => image.id)).toEqual([IMAGE.id]);
    expect(campaign?.ads[0].videos.map((video) => video.id)).toEqual([VIDEO.id]);
  });

  it('serves the account and its ledger from the subcollection', async () => {
    const account = await getAccountWithTransactions(PARTNER.id);

    expect(account.balance).toBe(120.25);
    expect(account.stripeCustomerId).toBe('cus_123');
    expect(account.transactions).toHaveLength(1);
    expect(account.transactions[0].stripeSessionId).toBe('cs_test_1');
  });
});
