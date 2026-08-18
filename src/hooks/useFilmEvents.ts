'use client';

import { useEffect, useRef } from 'react';
import {
  collection,
  onSnapshot,
  query,
  where,
  Timestamp,
} from 'firebase/firestore';

import { clientDb } from '@/lib/firebase/client';
import type { SSEEvent } from '@/lib/events';

/**
 * Subscribe to a film's realtime event stream.
 *
 * Replaces the previous Mercure `EventSource` connection. Only events created
 * after the listener mounts are delivered, so a page load never replays the
 * backlog still inside the TTL window.
 *
 * The handler is held in a ref so that callers can pass an inline closure
 * without tearing down and re-establishing the subscription on every render.
 */
export function useFilmEvents(
  filmMuviUuid: string,
  onEvent: (event: SSEEvent) => void
): void {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    const mountedAt = Timestamp.now();

    const eventsQuery = query(
      collection(clientDb(), 'filmEvents', filmMuviUuid, 'events'),
      where('createdAt', '>', mountedAt)
    );

    const unsubscribe = onSnapshot(
      eventsQuery,
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type !== 'added') return;
          handlerRef.current(change.doc.data() as SSEEvent);
        });
      },
      (error) => {
        console.error('[events] Subscription error:', error);
      }
    );

    return () => unsubscribe();
  }, [filmMuviUuid]);
}
