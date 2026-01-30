import { NextRequest } from 'next/server';

import { broadcaster, type SSEEvent } from '@/lib/events';

export const dynamic = 'force-dynamic';

const HEARTBEAT_INTERVAL_MS = 30000;

/**
 * SSE endpoint for real-time notifications
 * Clients subscribe to film-specific channels to receive updates
 * about background operations like video uploads to Meta
 */
export async function GET(req: NextRequest): Promise<Response> {
  const filmId = req.nextUrl.searchParams.get('filmId');

  if (!filmId) {
    return new Response(JSON.stringify({ error: 'filmId parameter is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (data: SSEEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Stream may be closed, ignore errors
        }
      };

      // Send initial connection confirmation
      send({ type: 'connected' });

      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        send({ type: 'heartbeat' });
      }, HEARTBEAT_INTERVAL_MS);

      // Subscribe to video events for this film
      const unsubscribe = broadcaster.subscribe(`film:${filmId}`, (data) => {
        send(data as SSEEvent);
      });

      // Cleanup when client disconnects
      req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Stream may already be closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
