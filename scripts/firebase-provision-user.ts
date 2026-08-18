#!/usr/bin/env npx tsx
/**
 * Provision a user for the platform.
 *
 * The app has two authentication paths:
 *
 *   1. Provisional — Firebase Auth with email and password. The browser signs
 *      in against Firebase, posts the ID token to /api/auth/login, and the
 *      server exchanges it for a session cookie. This script creates those
 *      accounts.
 *   2. Final — the Pijama Films integration (PIJAMA_CLIENT_ID /
 *      PIJAMA_CLIENT_SECRET), where identity comes from the Pijama API.
 *
 * Either way authorization hangs off the `partnerId` custom claim, and the
 * matching `partners/{id}` document has to exist: a user whose claim points at
 * no partner signs in successfully and then sees nothing. This script writes
 * both, so the two cannot drift apart.
 *
 * Usage:
 *   npx tsx scripts/firebase-provision-user.ts <email> <name> <partnerId>
 *   npx tsx scripts/firebase-provision-user.ts <email> <name> <partnerId> --password-stdin
 *
 * By default no password is handled at all: the script prints a one-time
 * password-reset link that you forward over a trusted channel. Pass
 * --password-stdin to set one directly, reading it from stdin — never as an
 * argument, which would leave it in the shell history.
 *
 * Requires Application Default Credentials with permission on the Firebase
 * project (e.g. `gcloud auth application-default login`).
 */

import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const usePasswordStdin = args.includes('--password-stdin');
const [email, name, partnerId] = args.filter((arg) => !arg.startsWith('--'));

if (!email || !name || !partnerId) {
  console.error(
    'Usage: npx tsx scripts/firebase-provision-user.ts <email> <name> <partnerId> [--password-stdin]'
  );
  process.exit(1);
}

const projectId = process.env.FIREBASE_PROJECT_ID;

if (!projectId) {
  console.error('FIREBASE_PROJECT_ID is not set');
  process.exit(1);
}

/** Read the password from stdin so it never appears in argv or shell history. */
async function readPassword(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  const password = Buffer.concat(chunks).toString('utf8').trim();

  if (password.length < 6) {
    throw new Error('Firebase requires a password of at least 6 characters');
  }

  return password;
}

/**
 * The partner document the claim points at. Without it the user authenticates
 * and then finds no campaigns, no account and no films.
 */
async function ensurePartner(): Promise<void> {
  const db = getFirestore();
  const byExternalId = await db
    .collection('partners')
    .where('partnerId', '==', partnerId)
    .limit(1)
    .get();

  if (!byExternalId.empty) {
    console.log(`Partner ${partnerId} already exists (${byExternalId.docs[0].id})`);
    return;
  }

  const now = new Date();
  const ref = db.collection('partners').doc(partnerId);
  await ref.set({ partnerId, name, createdAt: now, updatedAt: now });

  console.log(`Created partner ${partnerId} (${ref.id})`);
}

async function main(): Promise<void> {
  const password = usePasswordStdin ? await readPassword() : undefined;

  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault(), projectId });
  }

  const auth = getAuth();

  let uid: string;

  try {
    const existing = await auth.getUserByEmail(email);
    uid = existing.uid;
    await auth.updateUser(uid, { displayName: name, ...(password ? { password } : {}) });
    console.log(`Updated existing user ${email} (${uid})`);
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') {
      throw error;
    }
    const created = await auth.createUser({
      email,
      displayName: name,
      emailVerified: false,
      ...(password ? { password } : {}),
    });
    uid = created.uid;
    console.log(`Created user ${email} (${uid})`);
  }

  // The claim the whole app authorizes against.
  await auth.setCustomUserClaims(uid, { partnerId });
  console.log(`Set claim partnerId=${partnerId}`);

  await ensurePartner();

  if (password) {
    console.log('\nPassword set. The user can sign in with email and password.');
    return;
  }

  const resetLink = await auth.generatePasswordResetLink(email);
  console.log('\nSend this one-time link to the user over a trusted channel:');
  console.log(resetLink);
}

main().catch((error) => {
  console.error('Provisioning failed:', error);
  process.exit(1);
});
