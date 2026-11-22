import Redis from "ioredis";

/**
 * Atomic sliding-window counter. A sorted set keeps one member per request in
 * the window, so a burst at a window boundary cannot double the allowance the
 * way a fixed counter with a resetting TTL can. The whole read/check/write is
 * one script, which makes it safe when many gateway replicas share Redis.
 */
const SLIDING_WINDOW = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local used = redis.call('ZCARD', key)
if used >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local reset = now + window
  if oldest[2] then reset = tonumber(oldest[2]) + window end
  return {0, used, limit, reset}
end
redis.call('ZADD', key, now, tostring(now) .. '-' .. tostring(used))
redis.call('PEXPIRE', key, window)
return {1, used + 1, limit, now + window}
`;

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Shared rate limiter with a local fallback. Redis is the source of truth so
 * limits hold across replicas; if it is unavailable we keep counting in this
 * process rather than silently dropping all protection.
 */
export function createRateLimiter(options = {}) {
  const windowMs = positiveInt(options.windowMs, 60_000);
  const failClosed = options.failClosed === true;
  const log = options.log ?? console;
  const buckets = new Map();
  let redis = null;
  let redisReady = false;
  let warned = false;

  const warnOnce = (message, err) => {
    if (warned) return;
    warned = true;
    log.warn?.({ err }, message);
  };

  if (options.redisUrl) {
    try {
      redis = new Redis(options.redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy: (attempt) => Math.min(200 * attempt, 2000),
      });
      redis.on("ready", () => {
        redisReady = true;
      });
      redis.on("close", () => {
        redisReady = false;
      });
      redis.on("error", (err) => warnOnce("rate limit Redis unavailable; using local counters", err));
      void redis.connect().catch((err) => warnOnce("rate limit Redis connect failed; using local counters", err));
    } catch (err) {
      redis = null;
      warnOnce("rate limit Redis init failed; using local counters", err);
    }
  }

  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, times] of buckets) {
      const kept = times.filter((time) => time > cutoff);
      if (kept.length) buckets.set(key, kept);
      else buckets.delete(key);
    }
  }, Math.min(windowMs, 60_000));
  sweep.unref?.();

  function local(key, now, limit) {
    const cutoff = now - windowMs;
    const times = (buckets.get(key) ?? []).filter((time) => time > cutoff);
    const allowed = times.length < limit;
    if (allowed) times.push(now);
    buckets.set(key, times);
    return {
      allowed,
      remaining: Math.max(0, limit - times.length),
      limit,
      resetAt: times.length ? times[0] + windowMs : now + windowMs,
    };
  }

  async function check(key, limit) {
    const now = Date.now();
    if (redis && redisReady) {
      try {
        const [allowed, used, appliedLimit, reset] = await redis.eval(
          SLIDING_WINDOW,
          1,
          `rl:${key}`,
          now,
          windowMs,
          limit,
        );
        return {
          allowed: Number(allowed) === 1,
          remaining: Math.max(0, Number(appliedLimit) - Number(used)),
          limit: Number(appliedLimit),
          resetAt: Number(reset),
        };
      } catch (err) {
        warnOnce("rate limit Redis error; using local counters", err);
        if (failClosed) {
          return { allowed: false, remaining: 0, limit, resetAt: now + windowMs, unavailable: true };
        }
      }
    }
    return local(key, now, limit);
  }

  async function close() {
    clearInterval(sweep);
    if (!redis) return;
    try {
      await redis.quit();
    } catch {
      redis.disconnect();
    }
  }

  return { check, close };
}
