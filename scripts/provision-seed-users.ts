#!/usr/bin/env npx tsx
/**
 * Provision the in-house users in Firebase Auth.
 *
 * The list comes from the hardcoded whitelist this branch replaced
 * (`src/lib/auth/temporal-users.ts`, removed in b7c6c21). Emails, names and the
 * partner they belong to are carried over verbatim.
 *
 * The passwords are NOT. They were committed to the repository in plaintext,
 * three of the five shared the same value, and anyone with clone access has
 * had them ever since — reusing them here would import a known-compromised
 * credential into the new system. Each user gets a one-time reset link
 * instead, which you forward over a trusted channel.
 *
 * Generating a link sends nothing: Firebase returns the URL, it does not email
 * anyone. Nobody is contacted by running this.
 *
 * Usage:
 *   FIREBASE_PROJECT_ID=pijama-promote-firebase npx tsx scripts/provision-seed-users.ts
 *   ... --dry-run     list what would be created, touch nothing
 *
 * Requires Application Default Credentials (`gcloud auth application-default login`).
 */

import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

interface SeedUser {
  email: string;
  name: string;
  partnerId: string;
}

/** Everyone belongs to the special partner, which grants access to every film. */
const SEED_USERS: SeedUser[] = [
  { email: 'admin@pijamafilms.com', name: 'Administrator', partnerId: 'pijamafilms' },
  { email: 'producer1@pijamafilms.com', name: 'Producer 1', partnerId: 'pijamafilms' },
  { email: 'producer2@pijamafilms.com', name: 'Producer 2', partnerId: 'pijamafilms' },
  { email: 'testpijamatest@gmail.com', name: 'Test User', partnerId: 'pijamafilms' },
  { email: 'josefina@fabula.cl', name: 'Josefina', partnerId: 'pijamafilms' },
];

const dryRun = process.argv.includes('--dry-run');
const projectId = process.env.FIREBASE_PROJECT_ID;

if (!projectId) {
  console.error('FIREBASE_PROJECT_ID is not set');
  process.exit(1);
}

/** The partner every seed user's claim points at. */
async function ensurePartner(partnerId: string): Promise<void> {
  const db = getFirestore();
  const existing = await db.collection('partners').where('partnerId', '==', partnerId).limit(1).get();

  if (!existing.empty) return;

  const now = new Date();
  await db.collection('partners').doc(partnerId).set({
    partnerId,
    name: 'Pijama Films',
    createdAt: now,
    updatedAt: now,
  });

  console.log(`Created partner ${partnerId}`);
}

async function provision(user: SeedUser): Promise<string> {
  const auth = getAuth();

  let uid: string;

  try {
    const existing = await auth.getUserByEmail(user.email);
    uid = existing.uid;
    await auth.updateUser(uid, { displayName: user.name });
    console.log(`  updated ${user.email} (${uid})`);
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') {
      throw error;
    }
    const created = await auth.createUser({
      email: user.email,
      displayName: user.name,
      emailVerified: false,
    });
    uid = created.uid;
    console.log(`  created ${user.email} (${uid})`);
  }

  await auth.setCustomUserClaims(uid, { partnerId: user.partnerId });

  return auth.generatePasswordResetLink(user.email);
}

async function main(): Promise<void> {
  if (dryRun) {
    console.log(`Would provision ${SEED_USERS.length} users in ${projectId}:`);
    for (const user of SEED_USERS) {
      console.log(`  ${user.email}  (${user.name}, partnerId=${user.partnerId})`);
    }
    console.log('\nDry run: nothing written, no links generated.');
    return;
  }

  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault(), projectId });
  }

  const partnerIds = [...new Set(SEED_USERS.map((user) => user.partnerId))];
  for (const partnerId of partnerIds) {
    await ensurePartner(partnerId);
  }

  console.log(`\nProvisioning ${SEED_USERS.length} users in ${projectId}:`);

  const links: { email: string; link: string }[] = [];
  for (const user of SEED_USERS) {
    links.push({ email: user.email, link: await provision(user) });
  }

  console.log('\nOne-time password-reset links — send each over a trusted channel.');
  console.log('They expire, and generating them emailed nobody.\n');
  for (const { email, link } of links) {
    console.log(`${email}\n  ${link}\n`);
  }
}

main().catch((error) => {
  console.error('Provisioning failed:', error);
  process.exit(1);
});
