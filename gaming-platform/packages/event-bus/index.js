import Redis from "ioredis";

/**
 * Minimal Redis-backed event bus.
 *
 * Publish failures are logged and swallowed: an event notification must never
 * turn a durable, already-committed claim into a failed user request.
 */
export class EventBus {
  constructor(url) {
    this.redis = new Redis(url, {
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
        await this.redis.connect();
        this.connected = true;
      }
      await this.redis.publish(
        topic,
        JSON.stringify({ topic, payload, published_at: new Date().toISOString() }),
      );
      return true;
    } catch (err) {
      console.warn(`[event-bus] publish to ${topic} failed:`, err.message);
      return false;
    }
  }

  async close() {
    try {
      if (this.connected) await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
