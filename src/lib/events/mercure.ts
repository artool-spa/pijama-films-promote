import { SignJWT } from 'jose';

import type { SSEEvent } from './index';

const MERCURE_URL = process.env.MERCURE_URL!;
const MERCURE_JWT_SECRET = process.env.MERCURE_JWT_SECRET!;

const TOPIC_PREFIX = 'https://promote.pijamafilms.com/films';

/**
 * Build a Mercure topic URL for a film's event channel
 */
function buildTopic(filmMuviUuid: string): string {
  return `${TOPIC_PREFIX}/${filmMuviUuid}/events`;
}

/**
 * Sign a publisher JWT for Mercure
 * The JWT authorizes publishing to any topic under our prefix
 */
async function signPublisherJwt(): Promise<string> {
  const secret = new TextEncoder().encode(MERCURE_JWT_SECRET);
  return new SignJWT({ mercure: { publish: ['*'] } })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);
}

/**
 * Publish an SSE event to Mercure hub
 *
 * Fire-and-forget semantics: logs a warning on failure but never throws.
 * This matches the previous in-memory broadcaster behavior.
 */
export async function publish(filmMuviUuid: string, data: SSEEvent): Promise<void> {
  try {
    const jwt = await signPublisherJwt();
    const topic = buildTopic(filmMuviUuid);

    const body = new URLSearchParams();
    body.append('topic', topic);
    body.append('data', JSON.stringify(data));

    const response = await fetch(MERCURE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      console.warn(`[Mercure] Publish failed (${response.status}): ${text}`);
    }
  } catch (error) {
    console.warn('[Mercure] Publish error:', error instanceof Error ? error.message : error);
  }
}
