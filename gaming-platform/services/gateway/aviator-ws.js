/**
 * Aviator player socket (protocol v1).
 *
 * The platform already has an authenticated SSE hub for general events. This
 * module adds the compact WebSocket surface described in the API design doc
 * without pulling in another runtime dependency: it performs the standard
 * RFC 6455 handshake itself, bridges client frames to the same REST handlers
 * the browser uses, and translates crash events from the realtime hub into the
 * documented `t`-typed server frames.
 *
 * Every wager still goes through the crash service and the wallet; this module
 * holds no balances and decides no outcomes.
 */

import { createHash } from "node:crypto";
import { epochMs, maskPlayer, PROTOCOL_VERSION, sanitizeSnapshot } from "../../packages/aviator/index.js";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** Build an unmasked server text frame. Lengths up to 64 KiB are supported,
 * which comfortably covers a snapshot even with a long bet history. */
export function textFrame(text) {
  const payload = Buffer.from(String(text), "utf8");
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x81, length]);
  } else if (length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Incremental RFC 6455 frame decoder. Client frames are always masked.
 * Returns `{ frames, rest }`; control frames (close/ping) are returned with
 * their opcode so the caller can answer a ping or close the socket. */
export function decodeFrames(buffer, fragments = [], fragmentState = { opcode: null, bytes: 0 }) {
  const frames = [];
  let offset = 0;
  for (;;) {
    if (buffer.length - offset < 2) break;
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const fin = (first & 0x80) !== 0;
    const masked = (second & 0x80) !== 0;
    // Reserved bits and fragmented/oversized control frames are protocol
    // errors. No extension is negotiated, so any RSV bit is invalid.
    if ((first & 0x70) !== 0) throw new Error("reserved frame bits set");
    if (opcode >= 8 && (!fin || (second & 0x7f) > 125)) throw new Error("invalid control frame");
    if (opcode === 0 && !fragmentState.opcode) throw new Error("unexpected continuation frame");
    if ((opcode === 1 || opcode === 2) && fragmentState.opcode) throw new Error("unfinished fragmented message");
    if (!masked) throw new Error("unmasked client frame");
    let length = second & 0x7f;
    offset += 2;
    if (length === 126) {
      if (buffer.length - offset < 2) { offset -= 2; break; }
      length = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (buffer.length - offset < 8) { offset -= 2; break; }
      const wide = buffer.readBigUInt64BE(offset);
      if (wide > 1024n * 1024n) throw new Error("frame too large");
      length = Number(wide);
      offset += 8;
    }
    if (length > 1024 * 1024) throw new Error("frame too large");
    if (buffer.length - offset < length + 4) { offset -= 2; break; }
    const mask = buffer.subarray(offset, offset + 4);
    const payload = Buffer.alloc(length);
    for (let i = 0; i < length; i++) payload[i] = buffer[offset + 4 + i] ^ mask[i % 4];
    offset += length + 4;
    // Continuation frames (opcode 0) are legal RFC 6455 messages. Reassemble
    // them here so a standards-compliant client is not silently dropped.
    if (opcode === 1 || opcode === 0 || opcode === 2) {
      if (opcode !== 0) {
        fragments.length = 0;
        fragmentState.opcode = opcode;
        fragmentState.bytes = 0;
      }
      fragmentState.bytes += payload.length;
      // The per-frame cap alone is not enough: unbounded continuation frames
      // could still exhaust memory. Bound the whole reassembled message too.
      if (fragmentState.bytes > 1024 * 1024) throw new Error("message too large");
      fragments.push(payload);
      if (fin) {
        const messageOpcode = fragmentState.opcode;
        const text = messageOpcode === 2
          ? ""
          : new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(fragments));
        frames.push({ opcode: messageOpcode, text });
        fragments.length = 0;
        fragmentState.opcode = null;
        fragmentState.bytes = 0;
      }
      continue;
    }
    frames.push({ opcode, text: "" });
  }
  return { frames, rest: buffer.subarray(offset) };
}

/** Re-check the player's access token on the socket's own privileged path.
 * REST requests pass through the gateway, which rejects revoked/rotated tokens
 * via `accessTokenActive`; these internal `api()` calls go straight to the
 * crash and chat services and would otherwise keep a logged-out socket live
 * until the JWT's natural expiry. */
export async function bearerActive(verifyToken, token, log) {
  if (!token) return false;
  const auth = await verifyToken({
    headers: { authorization: `Bearer ${token}` },
    log,
  });
  return auth?.status === "valid";
}

/** Socket frames are privileged writes but bypass Fastify's onRequest hook.
 * Use the same per-user write bucket as REST so one player cannot multiply
 * their abuse budget by opening four sockets and streaming frames. `ping` is
 * handled by the caller before this check. */
export async function checkFrameRateLimit(rateLimiter, config, userId) {
  if (!rateLimiter) return { allowed: true };
  return rateLimiter.check(`user:${userId}:write`, config?.mutateMax ?? 30);
}

/** Render the public flight curve from the configured ceiling only. Reading
 * the hidden crash point here would plateau the tick at the outcome and leak
 * it before betting closes. */
const multiplierFor = (flightStart, elapsed, doublingSeconds = 3, maxMultiplier = 100) => {
  const start = epochMs(flightStart);
  if (start === null || elapsed < start) return 1;
  const doubling = Math.max(0.001, Number(doublingSeconds) || 3) * 1000;
  const cap = Number(maxMultiplier) > 0 ? Number(maxMultiplier) : 100;
  return Math.max(1, Math.min(cap, Math.pow(2, (elapsed - start) / doubling)));
};

/** Map a realtime event topic to the documented server message names. All
 * protocol timestamps are epoch milliseconds; realtime/DB ISO strings are
 * converted at this boundary. */
function frameForEvent(event) {
  const payload = event?.payload ?? {};
  const roundId = payload.roundId ?? payload.round?.id ?? payload.id ?? null;
  const money = (value) => value === null || value === undefined ? null : Number(value).toFixed(2);
  switch (event?.topic) {
    case "crash.round_created":
    case "crash.round_start":
      return {
        t: "round_start",
        roundId,
        seedHash: payload.seedHash ?? null,
        bettingEndsAt: epochMs(payload.bettingEndsAt)
          ?? Date.now() + (Number(payload.bettingMs) || 8000),
      };
    case "crash.round_started":
    case "crash.round_flight":
      return {
        t: "betting_closed",
        roundId,
        flightStart: epochMs(payload.flightStart) ?? Date.now(),
      };
    case "crash.round_finished":
    case "crash.round_crash":
      return {
        t: "crash",
        roundId,
        mult: money(payload.crashPoint ?? payload.mult),
        seed: payload.serverSeed ?? null,
      };
    case "crash.round_settling":
      return { t: "round_settling", roundId, state: "SETTLING" };
    case "crash.round_cancelled":
      return {
        t: "round_voided",
        roundId,
        reason: payload.reason ?? "round_cancelled",
      };
    case "crash.bet":
      return payload.status === "cancelled" ? null : {
        t: "feed",
        list: [{
          type: "bet", betId: payload.betId ?? payload.id ?? null,
          user: maskPlayer(payload.user ?? payload.username ?? "***"),
          stake: money(payload.stake ?? payload.amount), mult: null, payout: null,
        }],
      };
    case "crash.cashout":
      return {
        t: "feed",
        list: [{
          type: "cashout", betId: payload.betId ?? payload.id ?? null,
          user: maskPlayer(payload.user ?? payload.username ?? "***"),
          stake: money(payload.stake), mult: money(payload.mult ?? payload.multiplier),
          payout: money(payload.payout),
        }],
      };
    case "crash.auto_stopped":
      return { t: "error", code: "AUTO_STOPPED", message: "auto bet session stopped" };
    case "chat.message": {
      const message = payload.message ?? payload;
      return {
        t: "chat_msg",
        id: message.id ?? null,
        user: maskPlayer(message.username ?? message.user ?? "***"),
        text: message.content ?? "",
        time: epochMs(message.created_at) ?? Date.now(),
      };
    }
    default:
      return null;
  }
}

/**
 * Register GET /v1/ws on the gateway.
 *
 * deps: { verifyToken, allowedOrigin, upstream, realtimeToken, maxPerUser,
 *         rateLimiter, rateLimitConfig, log }
 */
export function registerAviatorSocket(app, deps) {
  const sockets = new Map();
  // The documented client is served by this gateway, so a same-origin request
  // is always acceptable even when the deployment's CORS allow-list uses a
  // different hostname spelling (localhost vs 127.0.0.1, for example).
  // A browser cannot forge its own Origin, so this check is safe: a cross-origin
  // page still has to appear in the explicit allow-list.
  const allowed = (origin, req) => {
    if (!origin) return true;
    if (deps.allowedOrigin(origin)) return true;
    try {
      const url = new URL(origin);
      const scheme = String(req.headers["x-forwarded-proto"] ?? req.protocol ?? "http").split(",")[0].trim();
      return ["http:", "https:"].includes(url.protocol)
        && url.host === req.headers.host;
    } catch {
      return false;
    }
  };

  // Handle the upgrade on the raw HTTP server rather than through a Fastify
  // route: a hijacked reply can inherit framework headers that confuse strict
  // WebSocket clients. Writing the 101 response directly keeps the handshake
  // byte-for-byte RFC compliant.
  app.server.on("upgrade", async (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== "/v1/ws") {
      socket.destroy();
      return;
    }
    const versionParam = url.searchParams.get("v");
    if (versionParam !== null && versionParam !== String(PROTOCOL_VERSION)) {
      const body = JSON.stringify({
        error: "UNSUPPORTED_VERSION",
        message: `only Aviator protocol v${PROTOCOL_VERSION} is supported`,
      });
      socket.write(
        `HTTP/1.1 400 Bad Request\r\nContent-Type: application/json; charset=utf-8\r\n` +
        `Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
      );
      socket.end();
      return;
    }
    const STATUS = {
      400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 429: "Too Many Requests",
    };
    const reject = (status, code, message) => {
      const body = JSON.stringify({ error: code, message });
      socket.write(
        `HTTP/1.1 ${status} ${STATUS[status]}\r\n` +
        `Content-Type: application/json; charset=utf-8\r\n` +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        `Connection: close\r\n\r\n${body}`,
      );
      socket.end();
    };
    const upgrade = String(req.headers.upgrade ?? "").toLowerCase();
    const key = req.headers["sec-websocket-key"];
    if (upgrade !== "websocket" || typeof key !== "string") {
      reject(400, "BAD_REQUEST", "websocket upgrade required");
      return;
    }
    if (!allowed(req.headers.origin, req)) {
      reject(403, "FORBIDDEN", "origin not allowed");
      return;
    }
    const queryToken = url.searchParams.get("token");
    if (!queryToken && typeof req.headers.authorization !== "string") {
      reject(401, "UNAUTHORIZED", "session token required");
      return;
    }
    const auth = await deps.verifyToken({
      headers: {
        ...req.headers,
        ...(queryToken ? { authorization: `Bearer ${queryToken}` } : {}),
      },
      log: app.log,
    });
    if (auth.status !== "valid") {
      reject(401, "UNAUTHORIZED", "invalid session token");
      return;
    }
    const userId = auth.claims.userId;
    const known = sockets.get(userId) ?? new Set();
    if (known.size >= deps.maxPerUser) {
      reject(429, "RATE_LIMITED", "socket limit reached");
      return;
    }

    const accept = createHash("sha1").update(`${key}${WS_GUID}`).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );

    const bearer = typeof req.headers.authorization === "string"
      && req.headers.authorization.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null;
    const state = {
      userId, token: queryToken ?? bearer, round: null,
      version: versionParam === null ? PROTOCOL_VERSION : Number(versionParam),
      fragments: [], fragment: { opcode: null, bytes: 0 }, idle: null, lastActivity: Date.now(),
      closed: false, tick: null, stream: null,
      intentLast: new Map(), replies: new Map(),
    };
    known.add(state);
    sockets.set(userId, known);
    // Silent sockets are closed after 45s. A client that pings every 15s stays
    // open; dead connections stop consuming a per-user slot.
    state.idle = setInterval(() => {
      if (Date.now() - state.lastActivity > 45_000) close();
    }, 5000);
    state.idle.unref?.();
    const send = (frame) => {
      if (state.closed || !socket.writable) return;
      try { socket.write(textFrame(JSON.stringify(frame))); } catch { close(); }
    };

    const api = async (path, options = {}) => {
      const response = await fetch(`${deps.upstream("crash", 3023)}${path}`, {
        method: options.method ?? "GET",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${state.token}`,
          "x-user-id": userId,
          ...(options.headers ?? {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
      if (!response.ok) {
        const error = payload?.error ?? {};
        const err = new Error(error.message ?? `request failed (${response.status})`);
        err.code = error.code ?? "INTERNAL";
        err.status = response.status;
        throw err;
      }
      return payload?.data ?? payload;
    };

    const startTicks = () => {
      if (state.tick) clearInterval(state.tick);
      state.tick = setInterval(() => {
        const round = state.round;
        if (!round || round.state !== "FLYING" || !round.flightStart) return;
        const mult = multiplierFor(
          round.flightStart, Date.now(),
          round.doublingSeconds ?? 3, round.maxMultiplier ?? 100,
        );
        send({ t: "tick", roundId: round.id, mult: mult.toFixed(2), serverTime: Date.now() });
      }, 120);
      state.tick.unref?.();
    };

    const pushSnapshot = async () => {
      try {
        const result = await api("/v1/crash/snapshot");
        // The crash REST endpoint returns an envelope; the socket protocol
        // carries the inner frame itself.
        const snapshot = sanitizeSnapshot(result?.snapshot ?? result);
        state.round = snapshot?.round ?? null;
        send(snapshot);
        startTicks();
        if (state.round?.state === "CRASHED" && state.tick) {
          clearInterval(state.tick);
          state.tick = null;
        }
      } catch (err) {
        send({ t: "error", code: err.code ?? "INTERNAL", message: err.message });
      }
    };

    // Realtime bridge: the hub is the single source of published events, so a
    // socket client sees the same feed as an SSE client, renamed to protocol v1.
    const subscribe = async () => {
      try {
        const controller = new AbortController();
        state.stream = controller;
        const response = await fetch(`${deps.upstream("realtime", 3010)}/v1/events/stream`, {
          headers: { "x-service-token": deps.realtimeToken },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done || state.closed) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary;
          while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const eventName = /^event:\s*(.*)$/m.exec(block)?.[1];
            const data = /^data:\s*(.*)$/m.exec(block)?.[1];
            if (!eventName || !data) continue;
            try {
              const event = JSON.parse(data);
              const frame = frameForEvent({ ...event, topic: eventName });
              if (!frame) continue;
              if (frame.t === "round_start" || frame.t === "betting_closed") {
                state.round = {
                  ...(state.round ?? {}),
                  id: frame.roundId ?? state.round?.id,
                  state: frame.t === "round_start" ? "BETTING" : "FLYING",
                  flightStart: frame.flightStart ?? null,
                };
                startTicks();
              }
              if (frame.t === "crash" && state.round) {
                state.round = { ...state.round, state: "CRASHED", crashPoint: frame.mult, mult: frame.mult };
                if (state.tick) { clearInterval(state.tick); state.tick = null; }
              }
              if (frame.t === "round_settling" && state.round) {
                state.round = { ...state.round, state: "SETTLING" };
              }
              if (frame.t === "round_voided" && state.round) {
                state.round = { ...state.round, state: "SETTLING", crashPoint: null, mult: null };
                if (state.tick) { clearInterval(state.tick); state.tick = null; }
              }
              send(frame);
            } catch { /* Ignore a malformed event; never drop the stream. */ }
          }
        }
      } catch (err) {
        if (!state.closed && deps.log) deps.log.warn({ err }, "aviator socket event bridge closed");
      }
    };

    const handleMessage = async (frame) => {
      let msg;
      try { msg = JSON.parse(frame.text); } catch {
        send({ t: "error", code: "VALIDATION_FAILED", message: "invalid JSON frame" });
        return;
      }
      const reqId = typeof msg.reqId === "string" && msg.reqId.length <= 128 ? msg.reqId : null;
      const replyKey = reqId ? `${msg.t}:${reqId}` : null;
      // A cached reply is still a privileged response. Re-check the access
      // token before replaying it; otherwise a revoked session could keep
      // collecting money-frame results for the whole cache window.
      if (msg.t !== "ping" && !(await bearerActive(deps.verifyToken, state.token, deps.log))) {
        send({ t: "error", code: "UNAUTHORIZED", message: "session revoked" });
        close();
        return;
      }
      const cached = replyKey ? state.replies.get(replyKey) : null;
      if (cached) {
        send(cached.frame);
        return;
      }
      const replyOk = (frameName, fields) => {
        const frame = { t: frameName, ...(reqId ? { reqId } : {}), ...fields };
        if (replyKey) {
          const now = Date.now();
          for (const [key, entry] of state.replies) {
            if (now - entry.at > 60_000) state.replies.delete(key);
          }
          if (state.replies.size >= 200) state.replies.delete(state.replies.keys().next().value);
          state.replies.set(replyKey, { frame, at: now });
        }
        send(frame);
      };
      const replyErr = (frameName, err) => send({
        t: frameName,
        ...(reqId ? { reqId } : {}),
        code: err.code ?? "INTERNAL",
        message: err.message,
      });
      // Balance is per-player: fetch it for this socket instead of broadcasting
      // it through the shared realtime hub, where other players would see it.
      const sendBalance = async () => {
        try {
          const me = await api("/v1/crash/me");
          if (me?.balance)
            send({ t: "balance", ...me.balance, ...(reqId ? { reqId } : {}) });
        } catch { /* A failed balance refresh never invalidates a paid bet. */ }
      };
      try {
        if (msg.t === "ping") {
          send({ t: "pong", ts: msg.ts ?? null, serverTime: Date.now() });
          return;
        }
        // Advance per-intent cooldowns only after token liveness and cache
        // replay are resolved, so a rejected frame cannot consume the budget.
        const INTENT_MIN_MS = {
          bet: 120, cancel_bet: 120, cashout: 120,
          auto_start: 300, auto_stop: 300, chat: 1000,
        };
        const minimum = INTENT_MIN_MS[msg.t];
        if (minimum) {
          const now = Date.now();
          if (now - (state.intentLast.get(msg.t) ?? 0) < minimum) {
            send({
              t: "error", code: "RATE_LIMITED", ...(reqId ? { reqId } : {}),
              message: `${msg.t} too fast; retry shortly`,
            });
            return;
          }
          state.intentLast.set(msg.t, now);
        }
        const limit = await checkFrameRateLimit(deps.rateLimiter, deps.rateLimitConfig, userId);
        if (!limit.allowed) {
          send({
            t: "error",
            code: limit.unavailable ? "RATE_LIMIT_UNAVAILABLE" : "RATE_LIMITED",
            message: limit.unavailable ? "rate limiter unavailable" : "too many requests",
          });
          return;
        }
        if (msg.t === "bet") {
          const roundId = msg.roundId ?? state.round?.id;
          if (!roundId) throw Object.assign(new Error("no active round"), { code: "NOT_IN_BETTING_PHASE" });
          const bet = await api(`/v1/crash/rounds/${encodeURIComponent(roundId)}/bets`, {
            method: "POST",
            body: {
              amount: msg.amount, panel: msg.panel ?? 1,
              ...(msg.autoCashout ? { autoCashout: msg.autoCashout } : {}),
              requestId: reqId ?? undefined,
            },
          });
          replyOk("bet_ok", {
            reqId: reqId ?? null, betId: bet.bet?.betId ?? bet.bet?.id ?? null,
            panel: msg.panel ?? 1,
            amount: Number.isFinite(Number(msg.amount)) ? Number(msg.amount).toFixed(2) : null,
          });
          void sendBalance();
          return;
        }
        if (msg.t === "cancel_bet") {
          const roundId = msg.roundId ?? state.round?.id;
          await api(`/v1/crash/rounds/${encodeURIComponent(roundId)}/bets/${encodeURIComponent(msg.betId)}/cancel`, {
            method: "POST", body: { requestId: reqId ?? undefined },
          });
          replyOk("bet_ok", { reqId: reqId ?? null, betId: msg.betId, cancelled: true });
          void sendBalance();
          return;
        }
        if (msg.t === "cashout") {
          const roundId = msg.roundId ?? state.round?.id;
          const body = { requestId: reqId ?? undefined };
          if (msg.betId) body.betId = msg.betId;
          if (msg.panel !== undefined) body.panel = Number(msg.panel) === 2 ? 2 : 1;
          const result = await api(`/v1/crash/rounds/${encodeURIComponent(roundId)}/cashout`, {
            method: "POST", body,
          });
          const settledPanel = Number(result.panel);
          replyOk("cashout_ok", {
            betId: result.betId ?? msg.betId ?? null,
            ...(settledPanel === 1 || settledPanel === 2 ? { panel: settledPanel } : {}),
            mult: String(result.multiplier ?? ""),
            payout: String(result.payout ?? ""),
          });
          void sendBalance();
          return;
        }
        if (msg.t === "auto_start") {
          await api("/v1/crash/auto", {
            method: "POST",
            body: {
              panel: msg.panel ?? 1, amount: msg.amount, autoCashout: msg.autoCashout,
              rounds: msg.rounds, stopRules: msg.stopRules ?? {},
            },
          });
          replyOk("bet_ok", {
            reqId: reqId ?? null, betId: null, auto: true, panel: msg.panel ?? 1,
          });
          return;
        }
        if (msg.t === "auto_stop") {
          await api(`/v1/crash/auto/${Number(msg.panel) === 2 ? 2 : 1}/stop`, { method: "POST" });
          replyOk("bet_ok", { reqId: reqId ?? null, betId: null, auto: false });
          return;
        }
        if (msg.t === "chat") {
          const room = encodeURIComponent(msg.room ?? "lobby");
          const response = await fetch(`${deps.upstream("chat", 3016)}/v1/chat/rooms/${room}/messages`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${state.token}`,
              "x-user-id": userId,
            },
            body: JSON.stringify({ content: String(msg.text ?? "").slice(0, 200) }),
          });
          if (!response.ok) throw Object.assign(new Error("chat rejected"), { code: "VALIDATION_FAILED" });
          replyOk("chat_msg", { user: "***", text: String(msg.text ?? "").slice(0, 200), time: Date.now() });
          return;
        }
        send({ t: "error", code: "VALIDATION_FAILED", message: `unknown message type ${msg.t}` });
      } catch (err) {
        const frameName = msg.t === "cashout" ? "cashout_err" : msg.t === "bet" ? "bet_err" : "error";
        replyErr(frameName, err);
      }
    };

    let pending = Buffer.alloc(0);
    const close = () => {
      if (state.closed) return;
      state.closed = true;
      if (state.tick) clearInterval(state.tick);
      if (state.idle) clearInterval(state.idle);
      state.stream?.abort?.();
      known.delete(state);
      if (!known.size) {
        sockets.delete(userId);
        // No socket means no player to manage an auto session. Stop it engine
        // side so it cannot keep staking while the client is disconnected.
        if (deps.crashToken) {
          void fetch(
            `${deps.upstream("crash", 3023)}/internal/crash/auto/${encodeURIComponent(userId)}/stop`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-service-token": deps.crashToken,
              },
              signal: AbortSignal.timeout(2000),
            },
          ).catch(() => undefined);
        }
      }
      // Echo an empty close frame before ending the TCP stream so clients see
      // a normal 1000/1005 closure instead of an abnormal 1006.
      try {
        if (socket.writable) socket.write(Buffer.from([0x88, 0x00]));
        socket.end();
      } catch { /* already gone */ }
    };
    const onData = (chunk) => {
      state.lastActivity = Date.now();
      try {
        const decoded = decodeFrames(Buffer.concat([pending, chunk]), state.fragments, state.fragment);
        pending = Buffer.from(decoded.rest);
        for (const frame of decoded.frames) {
          if (frame.opcode === 8) { close(); return; }
          if (frame.opcode === 9) {
            // Server control frames are never masked. An empty pong is enough:
            // the spec's application-level `ping`/`pong` pair is handled above.
            if (socket.writable) socket.write(Buffer.from([0x8a, 0x00]));
            continue;
          }
          if (frame.opcode === 1) void handleMessage(frame);
        }
      } catch {
        send({ t: "error", code: "VALIDATION_FAILED", message: "invalid frame" });
        close();
      }
    };
    socket.on("data", onData);
    if (head?.length) onData(head);
    socket.on("error", close);
    socket.on("close", close);

    void pushSnapshot();
    void subscribe();
  });

  return sockets;
}
