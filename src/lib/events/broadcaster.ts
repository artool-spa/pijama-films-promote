/**
 * Event broadcaster for managing SSE subscribers
 * Uses a singleton pattern that survives hot reload in development
 */

type EventHandler = (data: unknown) => void;

class EventBroadcaster {
  private subscribers: Map<string, Set<EventHandler>> = new Map();

  /**
   * Subscribe to a channel
   * @param channel - Channel name (e.g., 'film:abc-123')
   * @param handler - Callback function when events are broadcast
   * @returns Unsubscribe function
   */
  subscribe(channel: string, handler: EventHandler): () => void {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set());
    }
    this.subscribers.get(channel)!.add(handler);

    return () => {
      this.subscribers.get(channel)?.delete(handler);
      // Clean up empty channels
      if (this.subscribers.get(channel)?.size === 0) {
        this.subscribers.delete(channel);
      }
    };
  }

  /**
   * Broadcast data to all subscribers on a channel
   * @param channel - Channel name
   * @param data - Data to send to subscribers
   */
  broadcast(channel: string, data: unknown): void {
    this.subscribers.get(channel)?.forEach((handler) => {
      try {
        handler(data);
      } catch (error) {
        console.error(`[EventBroadcaster] Error in handler for channel ${channel}:`, error);
      }
    });
  }

  /**
   * Get the number of subscribers for a channel (useful for debugging)
   */
  getSubscriberCount(channel: string): number {
    return this.subscribers.get(channel)?.size ?? 0;
  }
}

// Singleton pattern - survives hot reload in development
const globalForEvents = global as unknown as { broadcaster: EventBroadcaster };
export const broadcaster = globalForEvents.broadcaster || new EventBroadcaster();
if (process.env.NODE_ENV !== 'production') {
  globalForEvents.broadcaster = broadcaster;
}
