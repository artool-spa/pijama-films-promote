/**
 * Provision a Firebase Auth user for the platform.
 *
 * Replaces the old hardcoded user whitelist. This script never handles a
 * password: it creates (or updates) the account, attaches the `partnerId`
 * custom claim used for authorization, and prints a one-time password-reset
 * link that you forward to the user over a trusted channel.
 *
 * Usage:
 *   npx tsx scripts/firebase-provision-user.ts <email> <name> <partnerId>
 *
 * Requires Application Default Credentials with permission on the Firebase
 * project (e.g. `gcloud auth application-default login`).
 */

import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const [email, name, partnerId] = process.argv.slice(2);

if (!email || !name || !partnerId) {
  console.error(
    'Usage: npx tsx scripts/firebase-provision-user.ts <email> <name> <partnerId>'
  );
  process.exit(1);
}

const projectId = process.env.FIREBASE_PROJECT_ID;

if (!projectId) {
  console.error('FIREBASE_PROJECT_ID is not set');
  process.exit(1);
}

async function main(): Promise<void> {
  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault(), projectId });
  }

  const auth = getAuth();

  let uid: string;

  try {
    const existing = await auth.getUserByEmail(email);
    uid = existing.uid;
    await auth.updateUser(uid, { displayName: name });
    console.log(`Updated existing user ${email} (${uid})`);
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') {
      throw error;
    }
    const created = await auth.createUser({
      email,
      displayName: name,
      emailVerified: false,
    });
    uid = created.uid;
    console.log(`Created user ${email} (${uid})`);
  }

  // The claim the whole app authorizes against.
  await auth.setCustomUserClaims(uid, { partnerId });
  console.log(`Set claim partnerId=${partnerId}`);

  const resetLink = await auth.generatePasswordResetLink(email);
  console.log('\nSend this one-time link to the user over a trusted channel:');
  console.log(resetLink);
}

main().catch((error) => {
  console.error('Provisioning failed:', error);
  process.exit(1);
});
