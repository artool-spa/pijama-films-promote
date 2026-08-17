import { FieldValue } from 'firebase-admin/firestore';

import { adminDb } from '@/lib/firebase/admin';
import { createLogger } from '@/lib/logger';
import type { SSEEvent } from './index';

const log = createLogger('events');

/** Events older than this are removed by the Firestore TTL policy. */
const EVENT_TTL_MS = 60 * 60 * 1000; // 1 hour

const FILM_EVENTS_COLLECTION = 'filmEvents';
const EVENTS_SUBCOLLECTION = 'events';

let configWarned = false;

function isConfigured(): boolean {
  if (!process.env.FIREBASE_PROJECT_ID) {
    if (!configWarned) {
      log.warn('Publishing disabled: FIREBASE_PROJECT_ID not configured');
      configWarned = true;
    }
    return false;
  }
  return true;
}

/**
 * Publish a realtime event for a film.
 *
 * Fire-and-forget: logs a warning on failure but never throws, matching the
 * previous Mercure behaviour so a broken event bus can't fail a request.
 */
export async function publish(filmMuviUuid: string, data: SSEEvent): Promise<void> {
  if (!isConfigured()) return;

  try {
    await adminDb()
      .collection(FILM_EVENTS_COLLECTION)
      .doc(filmMuviUuid)
      .collection(EVENTS_SUBCOLLECTION)
      .add({
        ...data,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + EVENT_TTL_MS),
      });

    log.info({ filmMuviUuid, type: data.type }, 'Published event');
  } catch (error) {
    log.warn({ err: error, filmMuviUuid }, 'Publish error');
  }
}

/**
 * Record which partner may subscribe to a film's event stream.
 *
 * Called from the server components that render the pages holding a listener,
 * right after they have already authorized the session against the film. The
 * Firestore rules read this document to authorize the client subscription -
 * film ownership itself lives in the external Pijama API, which rules cannot
 * reach.
 */
export async function grantFilmEventAccess(
  filmMuviUuid: string,
  partnerId: string
): Promise<void> {
  if (!isConfigured()) return;

  try {
    await adminDb()
      .collection(FILM_EVENTS_COLLECTION)
      .doc(filmMuviUuid)
      .set(
        {
          allowedPartnerIds: FieldValue.arrayUnion(partnerId),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
  } catch (error) {
    log.warn({ err: error, filmMuviUuid }, 'Failed to grant event access');
  }
}
