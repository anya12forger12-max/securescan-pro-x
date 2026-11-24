import Redis from "ioredis";

/**
 * Minimal Redis-backed event bus.
 *
 * Publish failures are logged and swallowed: an event notification must never
 * turn a durable, already-committed claim into a failed user request.
 */
export class EventBus {
  constructor(url) {
    this.url = url;
    this.connectPromise = null;
    this.newClient();
  }

  newClient() {
    this.redis = new Redis(this.url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.connected = false;
    this.redis.on("error", (err) => console.warn("[event-bus] redis error:", err.message));
  }

  async publish(topic, payload) {
    try {
      if (!this.connected) {
        // Concurrent publishes must await the same connection attempt.
        // ioredis rejects a second connect(), which used to drop one event.
        this.connectPromise ??= this.redis.connect().then(() => {
          this.connected = true;
        }).finally(() => {
          this.connectPromise = null;
        });
        await this.connectPromise;
      }
      await this.redis.publish(
        topic,
        JSON.stringify({ topic, payload, published_at: new Date().toISOString() }),
      );
      return true;
    } catch (err) {
      this.connected = false;
      console.warn(`[event-bus] publish to ${topic} failed:`, err.message);
      return false;
    }
  }

  async close() {
    // ioredis does not reliably allow connect() again on a closed client, so
    // replace it. Otherwise a bus reused after shutdown silently drops events.
    try {
      this.redis.disconnect();
    } catch {
      // nothing else to clean up
    }
    this.connectPromise = null;
    this.newClient();
  }
}
