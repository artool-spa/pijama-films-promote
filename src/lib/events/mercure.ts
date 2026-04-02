import { SignJWT } from 'jose';

import { createLogger } from '@/lib/logger';
import type { SSEEvent } from './index';

const log = createLogger('mercure');
const TOPIC_PREFIX = 'https://promote.pijamafilms.com/films';

let configWarned = false;

function getConfig(): { mercureUrl: string; jwtSecret: string } | null {
  const mercureUrl = process.env.MERCURE_URL;
  const jwtSecret = process.env.MERCURE_JWT_SECRET;

  if (!mercureUrl || !jwtSecret) {
    if (!configWarned) {
      log.warn('Publishing disabled: MERCURE_URL or MERCURE_JWT_SECRET not configured');
      configWarned = true;
    }
    return null;
  }

  return { mercureUrl, jwtSecret };
}

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
async function signPublisherJwt(jwtSecret: string): Promise<string> {
  const secret = new TextEncoder().encode(jwtSecret);
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
  const config = getConfig();
  if (!config) return;

  try {
    const jwt = await signPublisherJwt(config.jwtSecret);
    const topic = buildTopic(filmMuviUuid);

    const body = new URLSearchParams();
    body.append('topic', topic);
    body.append('data', JSON.stringify(data));

    const response = await fetch(config.mercureUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      log.warn({ status: response.status, body: text }, 'Publish failed');
    } else {
      const eventId = await response.text();
      log.info({ topic, eventId }, 'Published event');
    }
  } catch (error) {
    log.warn({ err: error }, 'Publish error');
  }
}
