#!/usr/bin/env npx tsx
/**
 * Import partner records into Firestore.
 *
 * The Firestore migration starts from an empty environment; the only data
 * carried over is the users, i.e. the partner records that every campaign,
 * account and authorization check keys off.
 *
 * Document ids are preserved, so a partner keeps the id its old rows referred
 * to. Re-running the import overwrites the same documents.
 *
 * Producing the export
 * --------------------
 * Run this in the *production* environment (Cloud Run job or an
 * IAM-authenticated session) — never against a production URL held locally:
 *
 *   psql "$DATABASE_URL" -At -c \
 *     'select json_agg(row_to_json(p)) from "Partner" p' > partners.json
 *
 * Then copy that file to wherever you run this script.
 *
 * Usage:
 *   FIREBASE_PROJECT_ID=pijama-promote-firebase \
 *     npx tsx scripts/firestore-import-partners.ts partners.json [--dry-run]
 *
 * Requires Application Default Credentials with write access to Firestore
 * (`gcloud auth application-default login`).
 */

import { readFileSync } from 'fs';
import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const [inputPath, ...flags] = process.argv.slice(2);
const dryRun = flags.includes('--dry-run');

if (!inputPath) {
  console.error(
    'Usage: npx tsx scripts/firestore-import-partners.ts <partners.json> [--dry-run]'
  );
  process.exit(1);
}

const projectId = process.env.FIREBASE_PROJECT_ID;

if (!projectId) {
  console.error('FIREBASE_PROJECT_ID is not set');
  process.exit(1);
}

/** The columns the app actually reads; anything else in the dump is ignored. */
const PartnerRowSchema = z.object({
  id: z.string().min(1),
  partnerId: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

/** Firestore caps a batch at 500 writes. */
const BATCH_LIMIT = 500;

async function main(): Promise<void> {
  const rows = z.array(PartnerRowSchema).parse(JSON.parse(readFileSync(inputPath, 'utf8')));

  const duplicates = rows
    .map((row) => row.partnerId)
    .filter((partnerId, index, all) => all.indexOf(partnerId) !== index);

  if (duplicates.length > 0) {
    // `partnerId` was unique in Postgres and the app still looks partners up by
    // it; importing duplicates would make that lookup non-deterministic.
    console.error(`Duplicate partnerId values in the export: ${[...new Set(duplicates)].join(', ')}`);
    process.exit(1);
  }

  console.log(`Read ${rows.length} partners from ${inputPath}`);

  if (dryRun) {
    for (const row of rows) {
      console.log(`  would write partners/${row.id} (partnerId=${row.partnerId})`);
    }
    console.log('Dry run: nothing written.');
    return;
  }

  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault(), projectId });
  }

  const db = getFirestore();

  for (let start = 0; start < rows.length; start += BATCH_LIMIT) {
    const slice = rows.slice(start, start + BATCH_LIMIT);
    const batch = db.batch();

    for (const row of slice) {
      const { id, ...data } = row;
      batch.set(db.collection('partners').doc(id), data);
    }

    await batch.commit();
    console.log(`  wrote ${slice.length} partners`);
  }

  console.log(`Done. ${rows.length} partners in ${projectId}.`);
}

main().catch((error) => {
  console.error('Import failed:', error);
  process.exit(1);
});
