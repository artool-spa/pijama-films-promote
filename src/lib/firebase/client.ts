/**
 * Firebase client SDK singleton (browser).
 *
 * Only public config lives here - these values are safe to ship to the client.
 * Access control is enforced by Firebase Auth and, from phase 2, by Firestore
 * security rules. Never put an admin credential in this file.
 */

'use client';

import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

function getClientApp(): FirebaseApp {
  const existing = getApps();
  if (existing.length > 0) {
    return existing[0];
  }

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (!apiKey || !authDomain || !projectId) {
    throw new Error('Firebase client configuration is missing');
  }

  return initializeApp({ apiKey, authDomain, projectId });
}

export function clientAuth(): Auth {
  return getAuth(getClientApp());
}

export function clientDb(): Firestore {
  return getFirestore(getClientApp());
}
