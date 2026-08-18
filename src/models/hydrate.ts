/**
 * Relation loading for the campaign graph.
 *
 * Postgres resolved `campaign -> ads -> images/videos` with a join. Firestore
 * has none, so the same shape is assembled with a bounded fan-out:
 *
 *   1. one query per batch of campaign ids for their ads,
 *   2. one `getAll` for every distinct image and video the ads reference.
 *
 * The cost is a handful of round trips regardless of how many campaigns are
 * being hydrated — not one query per ad, which is what a naive port produces.
 */

import { adminDb } from '@/lib/firebase/admin';
import { COLLECTIONS, docData } from '@/lib/firestore';

type Doc = Record<string, unknown>;

/** Firestore rejects an `in` filter with more than 30 values. */
const IN_LIMIT = 30;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function idList(value: unknown): string[] {
  return Array.isArray(value) ? (value.filter((id) => typeof id === 'string') as string[]) : [];
}

function createdAtMillis(doc: Doc): number {
  const value = doc.createdAt;
  return value instanceof Date ? value.getTime() : 0;
}

async function loadByIds(collectionName: string, ids: string[]): Promise<Map<string, Doc>> {
  const map = new Map<string, Doc>();
  if (ids.length === 0) return map;

  const refs = ids.map((id) => adminDb().collection(collectionName).doc(id));
  const snaps = await adminDb().getAll(...refs);

  for (const snap of snaps) {
    const data = docData(snap);
    if (data) map.set(snap.id, data);
  }

  return map;
}

/**
 * Replace each ad's `imageIds` / `videoIds` with the documents they point at,
 * reproducing the `images` and `videos` relations the schemas expect.
 *
 * A dangling id (asset deleted out from under the ad) is skipped rather than
 * surfaced as a null, which is how the join behaved.
 */
export async function attachMedia(ads: Doc[]): Promise<Doc[]> {
  const imageIds = [...new Set(ads.flatMap((ad) => idList(ad.imageIds)))];
  const videoIds = [...new Set(ads.flatMap((ad) => idList(ad.videoIds)))];

  const [images, videos] = await Promise.all([
    loadByIds(COLLECTIONS.images, imageIds),
    loadByIds(COLLECTIONS.videos, videoIds),
  ]);

  return ads.map((ad) => ({
    ...ad,
    images: idList(ad.imageIds)
      .map((id) => images.get(id))
      .filter((doc): doc is Doc => doc !== undefined),
    videos: idList(ad.videoIds)
      .map((id) => videos.get(id))
      .filter((doc): doc is Doc => doc !== undefined),
  }));
}

/** Every ad of a single campaign, media attached, newest first. */
export async function adsForCampaign(campaignId: string): Promise<Doc[]> {
  const snap = await adminDb()
    .collection(COLLECTIONS.ads)
    .where('campaignId', '==', campaignId)
    .get();

  const docs = snap.docs
    .map(docData)
    .filter((doc): doc is Doc => doc !== null)
    .sort((a, b) => createdAtMillis(b) - createdAtMillis(a));

  return attachMedia(docs);
}

/** Ads for many campaigns at once, grouped by campaign id. */
export async function adsForCampaigns(campaignIds: string[]): Promise<Map<string, Doc[]>> {
  const grouped = new Map<string, Doc[]>();
  for (const id of campaignIds) grouped.set(id, []);

  if (campaignIds.length === 0) return grouped;

  const snaps = await Promise.all(
    chunk(campaignIds, IN_LIMIT).map((batch) =>
      adminDb().collection(COLLECTIONS.ads).where('campaignId', 'in', batch).get()
    )
  );

  const docs = snaps.flatMap((snap) => snap.docs.map(docData)).filter((doc): doc is Doc => doc !== null);
  const hydrated = await attachMedia(docs);

  for (const ad of hydrated) {
    const bucket = grouped.get(ad.campaignId as string);
    if (bucket) bucket.push(ad);
  }

  for (const bucket of grouped.values()) {
    bucket.sort((a, b) => createdAtMillis(b) - createdAtMillis(a));
  }

  return grouped;
}

/** Attach an `ads` array to each campaign document. */
export async function withAds(campaigns: Doc[]): Promise<Doc[]> {
  const byCampaign = await adsForCampaigns(campaigns.map((campaign) => campaign.id as string));

  return campaigns.map((campaign) => ({
    ...campaign,
    ads: byCampaign.get(campaign.id as string) ?? [],
  }));
}

/** Attach the `partner` document to each campaign. */
export async function withPartner(campaigns: Doc[]): Promise<Doc[]> {
  const partnerIds = [...new Set(campaigns.map((campaign) => campaign.partnerId as string))];
  const partners = await loadByIds(COLLECTIONS.partners, partnerIds);

  return campaigns.map((campaign) => ({
    ...campaign,
    partner: partners.get(campaign.partnerId as string),
  }));
}

export { loadByIds, createdAtMillis };
