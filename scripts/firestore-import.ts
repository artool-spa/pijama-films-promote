#!/usr/bin/env npx tsx
/**
 * Import the legacy Postgres export into Firestore.
 *
 * Takes the directory produced by `scripts/postgres-export.sh` and writes every
 * table into the collection layout described in docs/firestore-migration.md.
 * It needs no database access: the export is a set of JSON files, so the only
 * credential in play here is Firestore's.
 *
 * The import is idempotent. Every document is written under a preserved id, so
 * re-running overwrites the same documents rather than duplicating them — safe
 * to run again after fixing a dangling reference.
 *
 * Before writing anything it checks the export for problems the models would
 * only surface later as a broken page: dangling foreign keys, duplicate
 * `partnerId` values, and JSON columns holding a nested array (which Firestore
 * rejects). Any of those aborts the run unless --force is given.
 *
 * Usage:
 *   FIREBASE_PROJECT_ID=pijama-promote-firebase \
 *     npx tsx scripts/firestore-import.ts <export-dir> [--dry-run]
 *
 *   --dry-run                     read and validate, write nothing
 *   --replace-duplicate-partners  delete a pre-existing partner document that
 *                                 collides with an imported one (see below)
 *   --force                       import despite dangling references
 *
 * Requires Application Default Credentials with write access to Firestore
 * (`gcloud auth application-default login`).
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import {
  AccountRow,
  AccountTransactionRow,
  AdRow,
  CampaignRow,
  GeneratedCopyRow,
  ImageRow,
  PartnerRow,
  RelationRow,
  UserPreferenceRow,
  VideoRow,
  accountDoc,
  adDoc,
  campaignDoc,
  findNestedArray,
  generatedCopyDoc,
  groupRelations,
  imageDoc,
  partnerDoc,
  transactionDoc,
  userPreferenceDoc,
  videoDoc,
  type Document,
} from './lib/postgres-rows';

const [exportDir, ...flags] = process.argv.slice(2);
const dryRun = flags.includes('--dry-run');
const replaceDuplicatePartners = flags.includes('--replace-duplicate-partners');
const force = flags.includes('--force');

if (!exportDir) {
  console.error('Usage: npx tsx scripts/firestore-import.ts <export-dir> [--dry-run]');
  process.exit(1);
}

const projectId = process.env.FIREBASE_PROJECT_ID;

if (!projectId) {
  console.error('FIREBASE_PROJECT_ID is not set');
  process.exit(1);
}

/** Firestore caps a batch at 500 writes. */
const BATCH_LIMIT = 500;

function read<T extends z.ZodTypeAny>(file: string, schema: T): z.infer<T>[] {
  const path = join(exportDir, file);
  const parsed = z.array(schema).safeParse(JSON.parse(readFileSync(path, 'utf8')));

  if (!parsed.success) {
    console.error(`\n${file} does not match the expected shape:`);
    for (const issue of parsed.error.issues.slice(0, 10)) {
      console.error(`  row ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  return parsed.data;
}

interface Collection {
  name: string;
  docs: Document[];
}

async function writeCollection(db: Firestore, name: string, docs: Document[]): Promise<void> {
  for (let start = 0; start < docs.length; start += BATCH_LIMIT) {
    const slice = docs.slice(start, start + BATCH_LIMIT);
    const batch = db.batch();

    for (const doc of slice) {
      batch.set(db.collection(name).doc(doc.id), doc.data);
    }

    await batch.commit();
  }

  console.log(`  ${name}: ${docs.length}`);
}

/**
 * Ledger entries live under their account, so they are written per parent
 * rather than as one flat collection.
 */
async function writeTransactions(
  db: Firestore,
  grouped: Map<string, Document[]>
): Promise<void> {
  let total = 0;

  for (const [accountId, docs] of grouped) {
    for (let start = 0; start < docs.length; start += BATCH_LIMIT) {
      const slice = docs.slice(start, start + BATCH_LIMIT);
      const batch = db.batch();

      for (const doc of slice) {
        batch.set(db.collection('accounts').doc(accountId).collection('transactions').doc(doc.id), doc.data);
      }

      await batch.commit();
      total += slice.length;
    }
  }

  console.log(`  accounts/*/transactions: ${total}`);
}

async function main(): Promise<void> {
  // ---- read ----------------------------------------------------------------

  const userPreferences = read('userPreferences.json', UserPreferenceRow);
  const partners = read('partners.json', PartnerRow);
  const campaigns = read('campaigns.json', CampaignRow);
  const ads = read('ads.json', AdRow);
  const images = read('images.json', ImageRow);
  const videos = read('videos.json', VideoRow);
  const generatedCopies = read('generatedCopies.json', GeneratedCopyRow);
  const accounts = read('accounts.json', AccountRow);
  const transactions = read('transactions.json', AccountTransactionRow);
  const adImages = read('adImages.json', RelationRow);
  const adVideos = read('adVideos.json', RelationRow);

  console.log(`Read from ${exportDir}:`);
  console.log(
    `  ${partners.length} partners, ${campaigns.length} campaigns, ${ads.length} ads, ` +
      `${images.length} images, ${videos.length} videos, ${generatedCopies.length} copies,`
  );
  console.log(
    `  ${accounts.length} accounts, ${transactions.length} ledger entries, ` +
      `${userPreferences.length} preferences, ${adImages.length + adVideos.length} media links`
  );

  // ---- check ---------------------------------------------------------------

  const problems: string[] = [];

  const partnerIds = new Set(partners.map((row) => row.id));
  const campaignIds = new Set(campaigns.map((row) => row.id));
  const adIds = new Set(ads.map((row) => row.id));
  const imageIds = new Set(images.map((row) => row.id));
  const videoIds = new Set(videos.map((row) => row.id));

  // `partnerId` was unique in Postgres and the app still resolves a partner by
  // it (auth middleware), so a duplicate makes that lookup non-deterministic.
  const seenPartnerId = new Set<string>();
  for (const row of partners) {
    if (seenPartnerId.has(row.partnerId)) {
      problems.push(`duplicate partnerId in the export: ${row.partnerId}`);
    }
    seenPartnerId.add(row.partnerId);
  }

  for (const row of campaigns) {
    if (!partnerIds.has(row.partnerId)) {
      problems.push(`campaign ${row.id} points at missing partner ${row.partnerId}`);
    }
  }

  for (const row of ads) {
    if (!campaignIds.has(row.campaignId)) {
      problems.push(`ad ${row.id} points at missing campaign ${row.campaignId}`);
    }
  }

  for (const row of adImages) {
    if (!adIds.has(row.A)) problems.push(`_AdImages references missing ad ${row.A}`);
    if (!imageIds.has(row.B)) problems.push(`_AdImages references missing image ${row.B}`);
  }

  for (const row of adVideos) {
    if (!adIds.has(row.A)) problems.push(`_AdVideos references missing ad ${row.A}`);
    if (!videoIds.has(row.B)) problems.push(`_AdVideos references missing video ${row.B}`);
  }

  // accounts/{partnerId}: the account document id is the partner id, so an
  // account whose partner is missing has nowhere to live.
  const accountPartner = new Map(accounts.map((row) => [row.id, row.partnerId]));
  for (const row of accounts) {
    if (!partnerIds.has(row.partnerId)) {
      problems.push(`account ${row.id} points at missing partner ${row.partnerId}`);
    }
  }

  for (const row of transactions) {
    if (!accountPartner.has(row.accountId)) {
      problems.push(`ledger entry ${row.id} points at missing account ${row.accountId}`);
    }
    if (row.campaignId !== null && !campaignIds.has(row.campaignId)) {
      problems.push(`ledger entry ${row.id} points at missing campaign ${row.campaignId}`);
    }
  }

  // Firestore rejects an array inside an array, and the JSON columns hold
  // whatever the application wrote.
  const jsonColumns: [string, string, unknown][] = [
    ...campaigns.flatMap((row): [string, string, unknown][] => [
      [`campaign ${row.id}`, 'draftFormState', row.draftFormState],
      [`campaign ${row.id}`, 'lastSyncErrorDetails', row.lastSyncErrorDetails],
    ]),
    ...ads.map((row): [string, string, unknown] => [`ad ${row.id}`, 'rejectionDetails', row.rejectionDetails]),
  ];

  for (const [subject, column, value] of jsonColumns) {
    const path = findNestedArray(value);
    if (path !== null) {
      problems.push(`${subject}: ${column} holds a nested array at ${path}, which Firestore rejects`);
    }
  }

  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s) found in the export:`);
    for (const problem of problems.slice(0, 25)) console.error(`  ${problem}`);
    if (problems.length > 25) console.error(`  ... and ${problems.length - 25} more`);

    if (!force) {
      console.error('\nRefusing to import. Fix the export, or re-run with --force to import anyway.');
      process.exit(1);
    }

    console.error('\n--force given: importing despite the above.');
  }

  // ---- transform -----------------------------------------------------------

  const imagesByAd = groupRelations(adImages);
  const videosByAd = groupRelations(adVideos);

  const collections: Collection[] = [
    { name: 'partners', docs: partners.map(partnerDoc) },
    { name: 'campaigns', docs: campaigns.map(campaignDoc) },
    { name: 'ads', docs: ads.map((row) => adDoc(row, imagesByAd.get(row.id) ?? [], videosByAd.get(row.id) ?? [])) },
    { name: 'images', docs: images.map(imageDoc) },
    { name: 'videos', docs: videos.map(videoDoc) },
    { name: 'generatedCopies', docs: generatedCopies.map(generatedCopyDoc) },
    { name: 'accounts', docs: accounts.map(accountDoc) },
    { name: 'userPreferences', docs: userPreferences.map(userPreferenceDoc) },
  ];

  const transactionsByAccount = new Map<string, Document[]>();
  for (const row of transactions) {
    const partnerId = accountPartner.get(row.accountId);
    if (!partnerId) continue; // already reported above
    const bucket = transactionsByAccount.get(partnerId) ?? [];
    bucket.push(transactionDoc(row, partnerId));
    transactionsByAccount.set(partnerId, bucket);
  }

  // ---- write ---------------------------------------------------------------

  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault(), projectId });
  }

  const db = getFirestore();

  // A partner seeded before the import (scripts/firestore-seed.ts writes
  // `partners/pijamafilms`) carries the same external partnerId as a row in the
  // export but a different document id. Leaving both in place makes
  // `getPartnerByPartnerId` return an arbitrary one of the two, and only one of
  // them owns the imported campaigns.
  const collisions: { existingId: string; importedId: string; partnerId: string }[] = [];

  for (const row of partners) {
    const snap = await db.collection('partners').where('partnerId', '==', row.partnerId).get();
    for (const existing of snap.docs) {
      if (existing.id !== row.id) {
        collisions.push({ existingId: existing.id, importedId: row.id, partnerId: row.partnerId });
      }
    }
  }

  if (collisions.length > 0) {
    console.log(`\n${collisions.length} partner document(s) already exist under a different id:`);
    for (const collision of collisions) {
      console.log(`  partnerId=${collision.partnerId}: existing ${collision.existingId} vs imported ${collision.importedId}`);
    }
    if (!replaceDuplicatePartners) {
      console.log('  Re-run with --replace-duplicate-partners to delete the existing ones after the import.');
    }
  }

  if (dryRun) {
    console.log('\nWould write:');
    for (const { name, docs } of collections) console.log(`  ${name}: ${docs.length}`);
    console.log(`  accounts/*/transactions: ${transactions.length}`);
    console.log('\nDry run: nothing written.');
    return;
  }

  console.log(`\nWriting to ${projectId}:`);

  for (const { name, docs } of collections) {
    await writeCollection(db, name, docs);
  }

  await writeTransactions(db, transactionsByAccount);

  if (collisions.length > 0 && replaceDuplicatePartners) {
    for (const collision of collisions) {
      // Only after the imported document is confirmed present, so a failure
      // cannot leave the partnerId resolving to nothing.
      const imported = await db.collection('partners').doc(collision.importedId).get();
      if (!imported.exists) {
        console.error(`  keeping ${collision.existingId}: imported ${collision.importedId} is missing`);
        continue;
      }
      await db.collection('partners').doc(collision.existingId).delete();
      console.log(`  deleted duplicate partners/${collision.existingId}`);
    }
  }

  console.log('\nDone.');
}

main().catch((error) => {
  console.error('Import failed:', error);
  process.exit(1);
});
