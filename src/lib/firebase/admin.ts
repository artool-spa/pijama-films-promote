/**
 * Firebase Admin SDK singleton (server-only).
 *
 * Credentials resolution order:
 * 1. Application Default Credentials (Cloud Run / GCE metadata server) - production
 * 2. GOOGLE_APPLICATION_CREDENTIALS pointing at a service account file - local dev
 *
 * Never hardcode or inline a service account key.
 */

import { getApps, initializeApp, applicationDefault, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;

function getApp(): App {
  const existing = getApps();
  if (existing.length > 0) {
    return existing[0];
  }

  if (!FIREBASE_PROJECT_ID) {
    throw new Error('FIREBASE_PROJECT_ID is not configured');
  }

  return initializeApp({
    credential: applicationDefault(),
    projectId: FIREBASE_PROJECT_ID,
  });
}

export function adminAuth(): Auth {
  return getAuth(getApp());
}

export function adminDb(): Firestore {
  return getFirestore(getApp());
}

/**
 * Claims we attach to every Firebase user. `partnerId` is the authorization
 * anchor used by the rest of the app (and, from phase 2, by Firestore rules).
 */
export interface PijamaClaims {
  partnerId: string;
}

/**
 * Verify a Firebase ID token and extract our custom claims.
 *
 * `checkRevoked` forces a lookup against the user record so that a disabled or
 * revoked account cannot mint a new session.
 */
export async function verifyIdToken(
  idToken: string
): Promise<{ uid: string; email: string; name: string; partnerId: string } | null> {
  try {
    const decoded = await adminAuth().verifyIdToken(idToken, true);

    const partnerId = decoded.partnerId as string | undefined;
    if (!partnerId) {
      // A user without the partnerId claim is not provisioned for this app.
      return null;
    }

    if (!decoded.email) {
      return null;
    }

    return {
      uid: decoded.uid,
      email: decoded.email,
      name: (decoded.name as string | undefined) || decoded.email,
      partnerId,
    };
  } catch {
    return null;
  }
}
