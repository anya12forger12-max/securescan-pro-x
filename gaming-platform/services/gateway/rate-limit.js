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

/**
 * Live-socket leases. A sorted set stores one member per open stream with its
 * expiry as score, so a crashed gateway replica cannot hold a slot forever:
 * the acquire script evicts expired members before counting. Unlike the
 * sliding-window request limiter, leases are released explicitly when the
 * stream closes and refreshed by a heartbeat while it is alive.
 */
const ACQUIRE_LEASE = `
local key = KEYS[1]
local member = ARGV[1]
local now = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local limit = tonumber(ARGV[4])
redis.call('ZREMRANGEBYSCORE', key, 0, now)
local used = redis.call('ZCARD', key)
if used >= limit then
  return {0, used, limit}
end
redis.call('ZADD', key, now + ttl, member)
redis.call('PEXPIRE', key, ttl + 60000)
return {1, used + 1, limit}
`;

const RELEASE_LEASE = `
local key = KEYS[1]
local member = ARGV[1]
redis.call('ZREM', key, member)
return redis.call('ZCARD', key)
`;

const TOUCH_LEASE = `
local key = KEYS[1]
local member = ARGV[1]
local now = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
if redis.call('ZSCORE', key, member) then
  redis.call('ZADD', key, now + ttl, member)
  -- Refresh the key TTL as well: ZADD preserves an existing expiry, so without
  -- this a long-lived stream's key disappears ~ttl+60s after the first acquire
  -- even while its heartbeat keeps the member alive, resetting the shared cap.
  redis.call('PEXPIRE', key, ttl + 60000)
  return 1
end
return 0
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
  const leases = new Map();
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
    const now = Date.now();
    const cutoff = now - windowMs;
    for (const [key, times] of buckets) {
      const kept = times.filter((time) => time > cutoff);
      if (kept.length) buckets.set(key, kept);
      else buckets.delete(key);
    }
    for (const [key, members] of leases) {
      for (const [member, expiry] of members) if (expiry <= now) members.delete(member);
      if (!members.size) leases.delete(key);
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
    // Fail closed means *no* shared counter - including a Redis that never
    // connected - rejects the request. Falling through to local counters here
    // would silently weaken the limit on every replica during an outage.
    if (failClosed && (!redis || !redisReady)) {
      return { allowed: false, remaining: 0, limit, resetAt: now + windowMs, unavailable: true };
    }
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

  /** Take a shared live-socket slot. `member` must be unique per stream so a
   * replica that dies mid-stream leaks at most one lease (until its TTL) and a
   * later release is always a harmless no-op. */
  async function acquireLease(key, member, limit, ttlMs) {
    const now = Date.now();
    if (failClosed && (!redis || !redisReady)) return false;
    if (redis && redisReady) {
      try {
        const [allowed] = await redis.eval(
          ACQUIRE_LEASE, 1, `lease:${key}`, member, now, ttlMs, limit,
        );
        return Number(allowed) === 1;
      } catch (err) {
        warnOnce("lease Redis error; using local counters", err);
        if (failClosed) return false;
      }
    }
    const members = leases.get(key) ?? new Map();
    for (const [id, expiry] of members) if (expiry <= now) members.delete(id);
    const allowed = members.size < limit;
    if (allowed) members.set(member, now + ttlMs);
    leases.set(key, members);
    return allowed;
  }

  async function releaseLease(key, member) {
    if (redis && redisReady) {
      try {
        await redis.eval(RELEASE_LEASE, 1, `lease:${key}`, member);
      } catch (err) {
        warnOnce("lease release Redis error", err);
      }
    }
    const members = leases.get(key);
    if (!members) return;
    members.delete(member);
    if (!members.size) leases.delete(key);
  }

  async function touchLease(key, member, ttlMs) {
    const now = Date.now();
    if (redis && redisReady) {
      try {
        await redis.eval(TOUCH_LEASE, 1, `lease:${key}`, member, now, ttlMs);
      } catch (err) {
        warnOnce("lease touch Redis error", err);
      }
    }
    const members = leases.get(key);
    if (members?.has(member)) members.set(member, now + ttlMs);
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

  return { check, acquireLease, releaseLease, touchLease, close };
}
