#!/usr/bin/env npx tsx
/**
 * Seed the Firestore database.
 *
 * Replaces the old `prisma/seed.ts`. Idempotent: re-running leaves the same
 * documents in place.
 *
 * What it seeds
 * -------------
 * The `pijamafilms` partner. It is not an ordinary producer: `isSpecialPartner()`
 * in src/lib/auth/access-control.ts and the `filmEvents` rules in
 * firestore.rules both grant it access to every film. Nothing works for the
 * internal team until this document exists.
 *
 * Its document id is the partner id itself rather than an auto-id, so the seed
 * is idempotent and the special partner is recognisable in the console.
 *
 * Usage:
 *   FIREBASE_PROJECT_ID=pijama-promote-firebase npx tsx scripts/firestore-seed.ts
 *
 * Requires Application Default Credentials with write access to Firestore
 * (`gcloud auth application-default login`).
 */

import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const SPECIAL_PARTNER_ID = 'pijamafilms';

const projectId = process.env.FIREBASE_PROJECT_ID;

if (!projectId) {
  console.error('FIREBASE_PROJECT_ID is not set');
  process.exit(1);
}

async function main(): Promise<void> {
  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault(), projectId });
  }

  const db = getFirestore();
  const ref = db.collection('partners').doc(SPECIAL_PARTNER_ID);
  const existing = await ref.get();
  const now = new Date();

  if (existing.exists) {
    console.log(`Partner ${SPECIAL_PARTNER_ID} already present, leaving it alone.`);
  } else {
    await ref.set({
      partnerId: SPECIAL_PARTNER_ID,
      name: 'Pijama Films',
      createdAt: now,
      updatedAt: now,
    });
    console.log(`Seeded partner ${SPECIAL_PARTNER_ID} in ${projectId}.`);
  }

  console.log(
    '\nUsers are provisioned separately:\n' +
      '  npx tsx scripts/firebase-provision-user.ts <email> <name> <partnerId>'
  );
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
