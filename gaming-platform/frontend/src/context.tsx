/* eslint-disable react-hooks/exhaustive-deps */
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "react-toastify";
import { ApiError, apiRequest, errorMessage } from "./api";
import type { RequestOptions } from "./api";
import { config } from "./config";
import type {
  AuditReport,
  AuthData,
  CrashBet,
  CrashRound,
  CrashState,
  StrategyLabReport,
  ChatMessage,
  ChatRoom,
  CodenamesGame,
  GameKind,
  GamePlayer,
  GameSession,
  GinRummyGame,
  LeaderboardEntry,
  PictionaryRound,
  Promotion,
  RealtimeEvent,
  Tournament,
  User,
  WalletAccount,
  WalletTransaction,
} from "./types";

/** The Aviator client keeps one React context for auth, live data and actions.
 * This provider mirrors that architecture, but replaces its module-level
 * Socket.IO singleton with gateway-authenticated SSE and immutable updates. */

// The refresh credential is HttpOnly, so JavaScript cannot ask whether one
// exists. Auth sets this non-secret companion cookie with the same lifetime;
// it lets an anonymous page load skip a refresh that can only fail with 400.
const SESSION_HINT_COOKIE = "gp_session";
const hasSessionHint = () =>
  document.cookie.split(";").some((part) => part.trim() === `${SESSION_HINT_COOKIE}=1`);
const clearSessionHint = () => {
  document.cookie = `${SESSION_HINT_COOKIE}=; Max-Age=0; Path=/; SameSite=Strict`;
};

export interface ContextDataType {
  user: User | null;
  token: string | null;
  balance: string;
  events: RealtimeEvent[];
  history: number[];
  myBets: WalletTransaction[];
  rooms: ChatRoom[];
  room: string;
  messages: ChatMessage[];
  sessions: GameSession[];
  session: GameSession | null;
  gameId: string;
  players: GamePlayer[];
  leaderboard: LeaderboardEntry[];
  tournaments: Tournament[];
  promotions: Promotion[];
  gameKind: GameKind;
  codenames: CodenamesGame | null;
  ginRummy: GinRummyGame | null;
  pictionary: PictionaryRound | null;
  // Only the drawer's browser receives the secret word from the create
  // response; reads deliberately never return it.
  pictionaryWord: string | null;
  crash: CrashState;
  audit: AuditReport | null;
  permissions: string[];
  // Language requested by an operator launch URL. Non-sensitive UI state; the
  // launch token itself is never persisted or mirrored into context.
  operatorLanguage: string | null;
  ready: boolean;
  streamReady: boolean;
  lastSeq: number;
}

export interface ContextType extends ContextDataType {
  update(attrs: Partial<ContextDataType>): void;
  signUp(username: string, email: string, password: string): Promise<boolean>;
  signIn(identifier: string, password: string): Promise<boolean>;
  signOut(): Promise<void>;
  loadDashboard(): Promise<void>;
  createSession(gameKind: GameKind): Promise<GameSession | null>;
  joinSession(id: string): Promise<void>;
  loadGame(kind: GameKind, id: string): Promise<void>;
  forgetLastGame(): void;
  createCodenames(sessionId: string): Promise<void>;
  startCodenames(id: string): Promise<void>;
  guessCodenames(id: string, word: string): Promise<void>;
  clueCodenames(id: string, word: string, number: number): Promise<void>;
  createGinRummy(sessionId: string): Promise<void>;
  joinGinRummy(id: string): Promise<void>;
  drawGinRummy(id: string, source: "stock" | "discard"): Promise<void>;
  discardGinRummy(id: string, card: string): Promise<void>;
  meldGinRummy(id: string, melds: string[][]): Promise<void>;
  createPictionary(sessionId: string): Promise<void>;
  guessPictionary(id: string, guess: string): Promise<void>;
  loadRooms(): Promise<void>;
  createRoom(name: string): Promise<void>;
  loadMessages(room: string): Promise<void>;
  sendMessage(room: string, content: string): Promise<void>;
  loadLeaderboard(gameType: string): Promise<void>;
  loadTournaments(): Promise<void>;
  joinTournament(id: string): Promise<void>;
  loadPromotions(): Promise<void>;
  claimPromotion(code: string): Promise<void>;
  loadAudit(): Promise<void>;
  loadCrash(): Promise<void>;
  placeCrashBet(amount: number, autoCashout?: number | null): Promise<boolean>;
  cashOutCrash(): Promise<boolean>;
  runStrategyLab(input: {
    seed: string;
    rounds: number;
    stake: number;
    target: number;
    strategies: string[];
  }): Promise<StrategyLabReport | null>;
}

const initialState: ContextDataType = {
  user: null,
  token: null,
  balance: "0.00",
  events: [],
  history: [],
  myBets: [],
  rooms: [],
  room: "lobby",
  messages: [],
  sessions: [],
  session: null,
  gameId: "",
  players: [],
  leaderboard: [],
  tournaments: [],
  promotions: [],
  gameKind: "codenames",
  codenames: null,
  ginRummy: null,
  pictionary: null,
  pictionaryWord: null,
  crash: { round: null, myBet: null, history: [] },
  audit: null,
  permissions: [],
  operatorLanguage: null,
  ready: false,
  streamReady: false,
  lastSeq: 0,
};

const Context = React.createContext<ContextType>(null!);

/** Older builds wrote tokens to web storage. Delete those keys once at
 * startup (and on sign-out) so no long-lived credential is left behind;
 * current sessions keep only an in-memory access token and an HttpOnly cookie. */
function clearLegacyTokens() {
  try {
    localStorage.removeItem(config.legacyTokenKey);
    localStorage.removeItem(config.legacyRefreshKey);
    sessionStorage.removeItem(config.legacyTokenKey);
    sessionStorage.removeItem(config.legacyRefreshKey);
  } catch {
    // Storage may be unavailable (privacy mode / blocked cookies); in-memory
    // auth still works, so never fail a session over cleanup.
  }
}

interface LastGameState {
  sessionId?: string;
  gameId?: string;
  gameKind?: GameKind;
  secretWord?: string;
}

function readAllLastGames(): Record<string, LastGameState> {
  return JSON.parse(localStorage.getItem(config.lastGameKey) ?? "{}") as Record<
    string,
    LastGameState
  >;
}

/** Non-sensitive UI bookkeeping, partitioned by user id. No token is ever
 * written here: the refresh cookie and in-memory access token remain the only
 * credentials. */
function readLastGame(userId: string | null | undefined): LastGameState {
  if (!userId) return {};
  try {
    return readAllLastGames()[userId] ?? {};
  } catch {
    return {};
  }
}

function saveLastGame(userId: string | null | undefined, patch: LastGameState) {
  if (!userId) return;
  try {
    const all = readAllLastGames();
    all[userId] = { ...(all[userId] ?? {}), ...patch };
    localStorage.setItem(config.lastGameKey, JSON.stringify(all));
  } catch {
    // A blocked storage backend only disables session restoration; the live
    // game state in React still works, so never fail an action over this.
  }
}

function forgetLastGame(userId: string | null | undefined) {
  if (!userId) return;
  try {
    const all = readAllLastGames();
    delete all[userId];
    localStorage.setItem(config.lastGameKey, JSON.stringify(all));
  } catch {
    // Same as above: losing the shortcut is harmless when storage is blocked.
  }
}

/** Keep the api client's 15s timeout while allowing an identity change to
 * abort in-flight requests. `dispose` detaches the listeners once the request
 * settles so long-lived identity signals do not accumulate listeners. */
function scopedSignal(scope: AbortSignal | undefined): {
  signal?: AbortSignal;
  dispose: () => void;
} {
  if (!scope) return { signal: undefined, dispose: () => undefined };
  const ctor = AbortSignal as typeof AbortSignal & {
    any?: (signals: AbortSignal[]) => AbortSignal;
    timeout?: (ms: number) => AbortSignal;
  };
  const timeout = ctor.timeout?.(15000);
  if (timeout && typeof ctor.any === "function") {
    return { signal: ctor.any([scope, timeout]), dispose: () => undefined };
  }
  if (!timeout) return { signal: scope, dispose: () => undefined };
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (scope.aborted) abort();
  else scope.addEventListener("abort", abort, { once: true });
  const timer = window.setTimeout(abort, 15000);
  return {
    signal: controller.signal,
    dispose: () => {
      window.clearTimeout(timer);
      scope.removeEventListener("abort", abort);
    },
  };
}

/** Upstream game endpoints use database field names. Normalise them once so
 * the board components can rely on a single client-side shape. */
function normalizeCodenames(raw: CodenamesGame): CodenamesGame {
  const server = raw as CodenamesGame & { current_team?: string };
  return { ...server, turn: server.turn ?? server.current_team };
}

function normalizeGinRummy(raw: GinRummyGame, userId?: string | null): GinRummyGame {
  const server = raw as GinRummyGame & {
    current_turn?: string | null;
    player1_hand?: string[];
    player2_hand?: string[];
    discard_pile?: string[];
  };
  const hand =
    userId && userId === server.player1_id
      ? server.player1_hand
      : userId && userId === server.player2_id
        ? server.player2_hand
        : undefined;
  return {
    ...server,
    turn_user_id: server.turn_user_id ?? server.current_turn ?? null,
    hand: hand ?? server.hand,
    discard: server.discard ?? server.discard_pile,
  };
}

type StatePatch = Partial<ContextDataType> | ((prev: ContextDataType) => Partial<ContextDataType>);

export const Provider = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = React.useState<ContextDataType>(initialState);
  // Access token used for outgoing requests. Rotated by /auth/refresh.
  const tokenRef = useRef<string | null>(null);
  // Token captured when the current identity was established. Unlike the
  // access token it is stable across refreshes, so it is the scope used to
  // reject async writes belonging to a previous user or a signed-out session.
  const identityRef = useRef<string | null>(null);
  // Incremented on every identity change so in-flight requests from a
  // previous session cannot repopulate state after sign-out or account switch.
  const authGenerationRef = useRef(0);
  const lastSeqRef = useRef(0);
  const refreshPromiseRef = useRef<Promise<AuthData | null> | null>(null);
  // Every cookie-affecting auth call is queued. The browser applies Set-Cookie
  // in response order, so a refresh landing after logout must never be able to
  // restore a session the user just ended (or overwrite a new account).
  const authQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const identityEstablishedRef = useRef(true);
  const loadAbortRef = useRef<AbortController | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  // Assigned once the loaders are defined so the event stream can request an
  // authoritative refresh without capturing a stale closure.
  const crashRefreshRef = useRef<() => void>(() => undefined);
  const crashRefreshTimerRef = useRef<number | undefined>(undefined);
  const dashboardRefreshRef = useRef<() => void>(() => undefined);
  // Assigned after loadGame exists so the restore effect can use the latest
  // loader without re-running whenever unrelated state (e.g. crash history)
  // changes its identity.
  const restoreGameRef = useRef<(kind: GameKind, id: string) => Promise<void>>(async () => undefined);
  // Chat room selection must survive unrelated dashboard reloads, and a slow
  // response for a previously selected room must not overwrite the current one.
  const selectedRoomRef = useRef<string | null>(null);
  const chatRoomRequestRef = useRef(0);

  React.useEffect(() => {
    selectedRoomRef.current = state.room;
  }, [state.room]);

  // tokenRef is written only by identity transitions and token rotation above;
  // it is deliberately not mirrored from state.token, because a state commit
  // from a refresh that races sign-out must not revive the cleared token.

  /** The single scope check every async state write goes through. */
  const isCurrent = useCallback(
    (token: string | null, generation: number) =>
      identityRef.current === token && authGenerationRef.current === generation,
    [],
  );

  const update = useCallback((attrs: Partial<ContextDataType>) => {
    setState((prev) => ({ ...prev, ...attrs }));
  }, []);

  /** Async-only counterpart of update: writes are dropped unless the captured
   * identity token and generation are still current, including inside the
   * deferred functional updater. */
  const updateIfCurrent = useCallback(
    (token: string | null, generation: number, patch: StatePatch) => {
      if (!isCurrent(token, generation)) return;
      setState((prev) => {
        if (!isCurrent(token, generation)) return prev;
        return { ...prev, ...(typeof patch === "function" ? patch(prev) : patch) };
      });
    },
    [isCurrent],
  );

  /** Begin a new identity epoch: invalidate every in-flight loader, reset the
   * event cursor and cancel the previous stream before the new state is set. */
  const invalidateIdentity = useCallback((token: string | null) => {
    const generation = ++authGenerationRef.current;
    identityRef.current = token;
    tokenRef.current = token;
    lastSeqRef.current = 0;
    loadAbortRef.current?.abort();
    loadAbortRef.current = new AbortController();
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    return generation;
  }, []);

  const resetState = useCallback(
    (token: string | null, user: User | null, generation: number) => {
      if (!isCurrent(token, generation)) return;
      // initialState also clears lastSeq, events and history so no streaming
      // cursor or event from the previous identity survives the switch.
      setState({ ...initialState, token, user, ready: true });
    },
    [isCurrent],
  );

  const setIdentity = useCallback(
    (token: string | null, user: User | null) => {
      if (token) identityEstablishedRef.current = true;
      const generation = invalidateIdentity(token);
      resetState(token, user, generation);
      return generation;
    },
    [invalidateIdentity, resetState],
  );

  /** Serialise cookie-affecting requests. A rotation already in flight is
   * awaited before login/logout starts, and later callers queue behind it. */
  const serializeAuth = useCallback(<T,>(action: () => Promise<T>): Promise<T> => {
    const result = authQueueRef.current.then(action);
    authQueueRef.current = result.catch(() => undefined);
    return result;
  }, []);

  /** Serialise cookie rotation across tabs as well as within this tab. The
   * refresh cookie is single-use and shared by every tab of the origin, so two
   * tabs refreshing simultaneously would otherwise replay the same token; the
   * second request would be classified as theft and revoke the whole family.
   * Web Locks are held across the fetch itself, so a waiting tab sends the
   * cookie that the first tab's response just installed. */
  const withCrossTabAuthLock = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    if (typeof navigator !== "undefined" && navigator.locks) {
      let result!: T;
      let completed = false;
      await navigator.locks.request("gp:auth-refresh", async () => {
        result = await action();
        completed = true;
      });
      // The callback always runs unless the browser denies the lock outright;
      // in that case fall through to an unlocked attempt below.
      if (completed) return result;
    }
    return action();
  }, []);

  /** Rotate the 15-minute access token with the HttpOnly refresh cookie. One
   * shared promise prevents parallel 401s from racing the single-use cookie.
   * The generation captured at start is rechecked before every write so a
   * sign-out or a new login during the request cannot be undone by it. */
  const refreshSession = useCallback((): Promise<AuthData | null> => {
    // After sign-out no new rotation may be issued: it would set a fresh
    // cookie after logout's Max-Age=0 response and silently sign back in.
    if (!identityEstablishedRef.current) return Promise.resolve(null);
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const token = identityRef.current;
    const generation = authGenerationRef.current;

    const pending: Promise<AuthData | null> = serializeAuth(() =>
      withCrossTabAuthLock(() =>
        apiRequest<AuthData>("/auth/refresh", {
          method: "POST",
          credentials: "include",
        }),
      ),
    )
      .then((data) => {
        if (!isCurrent(token, generation)) return null;
        // Token rotation is not an identity change: keep identityRef, the
        // generation and the event cursor, only rotate the in-memory token.
        tokenRef.current = data.token;
        updateIfCurrent(token, generation, { token: data.token, user: data.user });
        return data;
      })
      .catch((err: unknown) => {
        if (!isCurrent(token, generation)) return null;
        // Only an explicit invalid/expired credential ends the session. A
        // 429, 5xx or transport failure must not turn a still-valid cookie
        // into a phantom sign-out that a reload would immediately undo.
        if (err instanceof ApiError && (err.status === 400 || err.status === 401)) {
          identityEstablishedRef.current = false;
          // The credential is gone; stop every later page load from retrying.
          clearSessionHint();
          // At bootstrap there is no identity to clear. Bumping the generation
          // here would discard a login queued behind this refresh: guard()
          // captures the generation before serializeAuth drains the queue.
          if (token) {
            const cleared = invalidateIdentity(null);
            resetState(null, null, cleared);
          }
        }
        return null;
      })
      .finally(() => {
        if (refreshPromiseRef.current === pending) refreshPromiseRef.current = null;
      });
    refreshPromiseRef.current = pending;
    return pending;
  }, [invalidateIdentity, isCurrent, resetState, serializeAuth, updateIfCurrent, withCrossTabAuthLock]);

  const call = useCallback(
    async <T,>(path: string, init: RequestOptions = {}): Promise<T> => {
      const request = async (accessToken: string | null) => {
        // Identity changes (sign-out / account switch) cancel in-flight work.
        const scope = init.signal ? null : scopedSignal(loadAbortRef.current?.signal);
        try {
          return await apiRequest<T>(path, {
            ...init,
            token: accessToken,
            signal: init.signal ?? scope?.signal,
          });
        } finally {
          scope?.dispose();
        }
      };
      try {
        return await request(tokenRef.current);
      } catch (err) {
        // Auth endpoints own their own 401s; every other expired access token
        // is silently refreshed and the original request replayed once.
        if (!(err instanceof ApiError && err.status === 401) || path.startsWith("/auth/")) throw err;
        const refreshed = await refreshSession();
        if (!refreshed) throw err;
        return request(refreshed.token);
      }
    },
    [refreshSession],
  );

  const guard = useCallback(
    async (label: string, action: () => Promise<unknown>, success?: string) => {
      const token = identityRef.current;
      const generation = authGenerationRef.current;
      try {
        const result = await action();
        if (!isCurrent(token, generation)) return null;
        if (success) toast.success(success);
        return result;
      } catch (err) {
        // An abort or failure from a discarded identity must not surface a
        // toast that looks like it belongs to the current session.
        if (!isCurrent(token, generation)) return null;
        const message = err instanceof ApiError && err.status === 401
          ? "Session expired - please sign in again"
          : errorMessage(err);
        toast.error(`${label}: ${message}`);
        return null;
      }
    },
    [isCurrent],
  );

  // Restore a session on load with the HttpOnly refresh cookie only: there is
  // no access token in web storage to verify or replay. Legacy token keys are
  // deleted here so credentials from earlier builds cannot linger.
  useEffect(() => {
    let cancelled = false;
    const generation = authGenerationRef.current;
    clearLegacyTokens();

    // An operator launch carries a short-lived, gateway-valid access token in
    // the URL. Strip it before any fetch or navigation so it never reaches
    // browser history or a Referer header, then verify it through /auth/me.
    // Operator-supplied identity claims are never trusted: only auth's own
    // validation can establish the session.
    const params = new URLSearchParams(window.location.search);
    const launchToken = params.get('token');
    if (launchToken) {
      const language = params.get('lang')?.slice(0, 16) ?? null;
      params.delete('token');
      params.delete('v');
      params.delete('lang');
      const query = params.toString();
      window.history.replaceState(
        null, '',
        `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
      );
      void (async () => {
        try {
          const identity = await apiRequest<{ user: User }>('/auth/me', { token: launchToken });
          if (cancelled || !isCurrent(null, generation) || !identity?.user) return;
          const nextGeneration = setIdentity(launchToken, identity.user);
          if (language) updateIfCurrent(launchToken, nextGeneration, { operatorLanguage: language });
        } catch {
          // An expired or forged launch fails closed to the anonymous view.
        } finally {
          // setIdentity starts a new generation, so the bootstrap generation is
          // intentionally not checked here: the launch session is ready now.
          if (!cancelled) update({ ready: true });
        }
      })();
      return () => { cancelled = true; };
    }

    if (!hasSessionHint()) {
      update({ ready: true });
      return;
    }
    void (async () => {
      try {
        const data = await refreshSession();
        if (cancelled || !isCurrent(null, generation) || !data) return;
        setIdentity(data.token, data.user);
      } finally {
        if (!cancelled && isCurrent(null, generation)) update({ ready: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isCurrent, refreshSession, setIdentity, update, updateIfCurrent]);

  // Durable event stream. Fetch is used instead of EventSource because the
  // gateway requires an Authorization header on every event request.
  useEffect(() => {
    const identity = identityRef.current;
    const generation = authGenerationRef.current;
    const accessToken = state.token;
    if (!accessToken || !identity || !isCurrent(identity, generation)) return;
    let cancelled = false;
    let controller: AbortController | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let retry: number | undefined;

    // In addition to the identity scope, pin the access token: a refresh
    // rotates state.token and restarts this effect, and the old stream must
    // not write another frame in the gap before React runs the cleanup.
    const stillCurrent = () =>
      !cancelled && isCurrent(identity, generation) && tokenRef.current === accessToken;

    // Debounce crash refreshes through a ref so the frame loop never captures
    // a mutable timer variable (and the cleanup can always cancel it).
    const scheduleCrashRefresh = () => {
      if (crashRefreshTimerRef.current) return;
      crashRefreshTimerRef.current = window.setTimeout(() => {
        crashRefreshTimerRef.current = undefined;
        if (stillCurrent()) crashRefreshRef.current();
      }, 200);
    };

    const stop = () => {
      if (retry) window.clearTimeout(retry);
      if (crashRefreshTimerRef.current) window.clearTimeout(crashRefreshTimerRef.current);
      // A cleared timer never fires to reset the ref. Without this, the next
      // stream's scheduleCrashRefresh() sees a truthy ref and returns forever,
      // freezing the crash board while `streamReady` suppresses polling.
      crashRefreshTimerRef.current = undefined;
      void reader?.cancel().catch(() => undefined);
      controller?.abort();
      if (streamAbortRef.current === controller) streamAbortRef.current = null;
    };

    const scheduleRetry = () => {
      if (!stillCurrent()) return;
      updateIfCurrent(identity, generation, { streamReady: false });
      retry = window.setTimeout(connect, 2000);
    };

    const connect = async () => {
      if (!stillCurrent()) return;
      controller = new AbortController();
      streamAbortRef.current = controller;
      try {
        const response = await fetch(`${config.events}?since=${lastSeqRef.current}`, {
          headers: { authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
        });
        if (!stillCurrent()) {
          stop();
          return;
        }
        if (response.status === 401) {
          // The stream bypasses call(), so nothing else would rotate an
          // expired access token while it is the app's only live request.
          // Rotate here; a successful rotation changes state.token and this
          // effect reconnects with the new token. stillCurrent() then goes
          // false and suppresses the fallback retry below.
          void refreshSession().then(scheduleRetry, scheduleRetry);
          return;
        }
        if (!response.ok || !response.body) throw new Error(`stream failed (${response.status})`);
        updateIfCurrent(identity, generation, { streamReady: true });
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (stillCurrent()) {
          const { done, value } = await reader.read();
          if (!stillCurrent()) {
            stop();
            return;
          }
          if (done) {
            // A clean EOF (proxy timeout, server restart, upstream cancel) is
            // just as disconnected as a thrown error. Resume from the last
            // sequence we saw so no events are lost during the gap.
            scheduleRetry();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          let split = buffer.indexOf("\n\n");
          while (split >= 0) {
            const frame = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            const frameLines = frame.split("\n");
            const eventName = frameLines.find((item) => item.startsWith("event:"))?.slice(6).trim();
            const line = frameLines.find((item) => item.startsWith("data:"));
            if (line) {
              try {
                const event = JSON.parse(line.slice(5).trim()) as RealtimeEvent & {
                  resync_required?: boolean;
                };
                // A retention gap is a control frame, not an event: it has no
                // sequence and must not be dropped by the cursor check. Reload
                // authoritative state so the hole cannot linger unnoticed.
                if (eventName === "gap" || event.resync_required === true) {
                  toast.warn("Event history gap - refreshing live data");
                  if (stillCurrent()) {
                    crashRefreshRef.current();
                    dashboardRefreshRef.current();
                  }
                  continue;
                }
                const seq = Number(event.seq);
                if (Number.isFinite(seq) && seq > lastSeqRef.current) {
                  lastSeqRef.current = seq;
                  updateIfCurrent(identity, generation, (prev) => ({
                    lastSeq: seq,
                    events: [event, ...prev.events].slice(0, 100),
                    history: [seq, ...prev.history].slice(0, 24),
                  }));
                  // Round and bet changes arrive as events; refresh crash
                  // state immediately (debounced) instead of waiting a second.
                  if (event.topic.startsWith("crash.")) scheduleCrashRefresh();
                }
              } catch {
                // Ignore malformed frames and keep the stream alive.
              }
            }
            split = buffer.indexOf("\n\n");
          }
        }
      } catch {
        scheduleRetry();
      }
    };

    void connect();
    return () => {
      cancelled = true;
      stop();
      updateIfCurrent(identity, generation, { streamReady: false });
    };
  }, [state.token, isCurrent, refreshSession, updateIfCurrent]);

  const loadDashboard = useCallback(async () => {
    const token = identityRef.current;
    const generation = authGenerationRef.current;
    if (!token) return;
    const [balance, transactions, rooms, promotions, tournaments] = await Promise.allSettled([
      call<{ account: WalletAccount }>("/wallet/balance"),
      call<{ items: WalletTransaction[] }>("/wallet/transactions?limit=20"),
      call<{ rooms: ChatRoom[] }>("/chat/rooms"),
      call<{ items: Promotion[] }>("/promotions"),
      call<{ items: Tournament[] }>("/tournaments"),
    ]);
    // A sign-out or account switch may have happened while these requests were
    // in flight. Never write a previous user's data into the current session.
    if (!isCurrent(token, generation)) return;
    // A failed request says nothing about the user's actual balance or data.
    // Keep the last known values instead of presenting an outage as zero.
    updateIfCurrent(token, generation, (prev) => ({
      balance: balance.status === "fulfilled" ? balance.value.account.balance : prev.balance,
      myBets: transactions.status === "fulfilled" ? transactions.value.items : prev.myBets,
      rooms: rooms.status === "fulfilled" ? rooms.value.rooms : prev.rooms,
      promotions: promotions.status === "fulfilled" ? promotions.value.items : prev.promotions,
      tournaments: tournaments.status === "fulfilled" ? tournaments.value.items : prev.tournaments,
    }));
    if (rooms.status === "fulfilled" && rooms.value.rooms.length) {
      // Preserve the player's selection across dashboard refreshes; only fall
      // back to the first room when the selected one no longer exists.
      const available = rooms.value.rooms;
      const previous = selectedRoomRef.current;
      const room =
        previous && available.some((entry) => entry.name === previous)
          ? previous
          : available[0].name;
      const seq = ++chatRoomRequestRef.current;
      const messages = await call<{ messages: ChatMessage[] }>(
        `/chat/rooms/${encodeURIComponent(room)}/messages?limit=50`,
      ).catch(() => null);
      if (!isCurrent(token, generation) || seq !== chatRoomRequestRef.current) return;
      updateIfCurrent(token, generation, (prev) => ({
        room,
        messages: messages ? messages.messages : prev.messages,
      }));
    }
  }, [call, isCurrent, updateIfCurrent]);

  useEffect(() => {
    if (state.token) void loadDashboard();
  }, [state.token, loadDashboard]);

  const applyAuth = useCallback(
    async (data: AuthData) => {
      identityEstablishedRef.current = true;
      const generation = invalidateIdentity(data.token);
      resetState(data.token, data.user, generation);
      await loadDashboard();
    },
    [invalidateIdentity, loadDashboard, resetState],
  );

  const signUp = useCallback(
    async (username: string, email: string, password: string) => {
      const generation = authGenerationRef.current;
      // Keep registration and auto-login separate. If the account commits but
      // the follow-up login fails, the user must be told the account exists
      // rather than being sent back to a form that now returns "already
      // registered" on retry.
      const registered = await guard("Register", () =>
        serializeAuth(() =>
          call("/auth/register", { method: "POST", body: { username, email, password } }),
        ),
      );
      if (!registered || authGenerationRef.current !== generation) return false;
      const data = await guard("Sign in", () =>
        serializeAuth(() =>
          call<AuthData>("/auth/login", {
            method: "POST",
            credentials: "include",
            body: { identifier: username, password },
          }),
        ),
      );
      if (authGenerationRef.current !== generation) return false;
      if (!data) {
        toast.info("Account created - please sign in");
        return true;
      }
      await applyAuth(data as AuthData);
      toast.success("Account created");
      return true;
    },
    [applyAuth, call, guard, serializeAuth],
  );

  const signIn = useCallback(
    async (identifier: string, password: string) => {
      const generation = authGenerationRef.current;
      const data = await guard("Sign in", () =>
        serializeAuth(() =>
          call<AuthData>("/auth/login", {
            method: "POST",
            credentials: "include",
            body: { identifier, password },
          }),
        ),
      );
      if (!data || authGenerationRef.current !== generation) return false;
      await applyAuth(data as AuthData);
      toast.success("Signed in");
      return true;
    },
    [applyAuth, call, guard, serializeAuth],
  );

  const signOut = useCallback(async () => {
    // Bump before any await so an in-flight refresh or loader immediately
    // becomes stale, even if the logout request is slow or never resolves.
    const generation = invalidateIdentity(null);
    identityEstablishedRef.current = false;
    // Drop the in-memory token up front and stop rendering the outgoing user's
    // data while the network request is still in flight.
    clearLegacyTokens();
    clearSessionHint();
    resetState(null, null, generation);
    // The logout must be the last cookie write. serializeAuth drains any
    // refresh in flight first and queues later logins behind the revocation;
    // the backend also revokes the whole token family for defense in depth.
    try {
      await serializeAuth(() =>
        apiRequest("/auth/logout", { method: "POST", credentials: "include" }),
      );
    } catch {
      // A blocked, rate-limited or unavailable logout leaves the httpOnly
      // refresh cookie valid. Silently reporting success would let a reload
      // restore this session on a shared device. Re-establish the in-memory
      // identity and tell the user so they can retry instead.
      if (!isCurrent(null, generation)) return;
      identityEstablishedRef.current = true;
      const restored = await refreshSession();
      if (!isCurrent(null, generation)) return;
      if (!restored) {
        toast.error("Sign out failed - please try again");
      } else {
        // refreshSession only rotates the in-memory token; it does not
        // re-establish identityRef, which signOut cleared at the start. Without
        // this the UI looks signed in but no authenticated event stream starts.
        setIdentity(restored.token, restored.user);
      }
      return;
    }
    // A new sign-in during logout owns the generation now; never clear its
    // fresh token or state.
    if (!isCurrent(null, generation)) return;
    clearLegacyTokens();
    resetState(null, null, generation);
    toast.info("Signed out");
  }, [invalidateIdentity, isCurrent, refreshSession, resetState, setIdentity, serializeAuth]);

  const createSession = useCallback(
    async (kind: GameKind) => {
      const token = identityRef.current;
      const generation = authGenerationRef.current;
      if (!token) return null;
      const result = (await guard("Create session", () =>
        call<{ session: GameSession }>("/game/sessions", {
          method: "POST",
          body: { game_type: kind },
        }),
      )) as { session: GameSession } | null;
      if (!result) return null;
      updateIfCurrent(token, generation, (prev) => ({
        session: result.session,
        // Build from the latest state: two quick creates must both appear.
        sessions: [result.session, ...prev.sessions],
      }));
      saveLastGame(state.user?.id, { sessionId: result.session.id, gameId: undefined });
      toast.success("Session created");
      return result.session;
    },
    [call, guard, state.user?.id, updateIfCurrent],
  );

  const joinSession = useCallback(
    async (id: string) => {
      const token = identityRef.current;
      const generation = authGenerationRef.current;
      if (!token) return;
      // The join endpoint returns only `{ player }`. Read the session back so
      // the board keeps its existing session and player list instead of being
      // overwritten with undefined by the join response.
      const joined = await guard("Join session", () =>
        call(`/game/sessions/${id}/join`, { method: "POST", body: {} }),
      );
      if (!joined || !isCurrent(token, generation)) return;
      const data = await guard("Session", () =>
        call<{ session: GameSession; players: GamePlayer[] }>(`/game/sessions/${id}`),
      );
      if (data) {
        const sessionData = data as { session: GameSession; players: GamePlayer[] };
        updateIfCurrent(token, generation, {
          session: sessionData.session,
          players: sessionData.players,
        });
        saveLastGame(state.user?.id, { sessionId: sessionData.session.id });
      }
    },
    [call, guard, isCurrent, state.user?.id, updateIfCurrent],
  );

  const loadGame = useCallback(
    async (kind: GameKind, id: string) => {
      const token = identityRef.current;
      const generation = authGenerationRef.current;
      if (!token) return;
      const paths: Record<GameKind, string> = {
        codenames: `/codenames/games/${id}`,
        "gin-rummy": `/gin-rummy/games/${id}`,
        pictionary: `/pictionary/rounds/${id}`,
        crash: `/crash/rounds/${id}`,
      };
      const patch: Partial<ContextDataType> = { gameKind: kind, gameId: id };
      const result = await guard("Load game", () => call<Record<string, unknown>>(paths[kind]));
      if (!result || !isCurrent(token, generation)) return;
      const data = result as Record<string, unknown>;
      if (kind === "codenames") {
        // `clues`, `guesses` and `revealed` are siblings of `game` in the
        // service response. Dropping them used to leave an empty board.
        patch.codenames = {
          ...normalizeCodenames(data.game as CodenamesGame),
          clues: (data.clues ?? []) as CodenamesGame["clues"],
          guesses: (data.guesses ?? []) as CodenamesGame["guesses"],
          revealed: (data.revealed ?? []) as CodenamesGame["revealed"],
        };
      }
      if (kind === "gin-rummy")
        patch.ginRummy = normalizeGinRummy(data.game as GinRummyGame, state.user?.id);
      if (kind === "pictionary") {
        const round = data.round as PictionaryRound;
        // Guesses are a sibling of `round` in the service response; copying
        // only the round used to make every submitted guess invisible.
        patch.pictionary = {
          ...round,
          guesses: (data.guesses ?? round.guesses ?? []) as PictionaryRound["guesses"],
        };
      }
      if (kind === "crash") {
        const round = data.round as CrashRound;
        patch.crash = { round, myBet: (data.myBet as CrashBet) ?? null, history: state.crash.history };
      }
      updateIfCurrent(token, generation, patch);
      saveLastGame(state.user?.id, { gameId: id, gameKind: kind });
    },
    [call, guard, isCurrent, state.crash.history, state.user?.id, updateIfCurrent],
  );

  useEffect(() => {
    restoreGameRef.current = loadGame;
  }, [loadGame]);

  // Restore the last board this user opened. Only non-sensitive ids are read
  // back from storage, and every one is revalidated through the gateway before
  // it is trusted, so a stale id simply clears the saved shortcut.
  useEffect(() => {
    const userId = state.user?.id;
    const saved = readLastGame(userId);
    if (!userId || !saved.gameId || !saved.gameKind) return;
    let cancelled = false;
    void (async () => {
      if (saved.sessionId) {
        const sessionData = await call<{ session: GameSession; players: GamePlayer[] }>(
          `/game/sessions/${saved.sessionId}`,
        ).catch(() => null);
        if (cancelled || !sessionData) return;
        updateIfCurrent(identityRef.current, authGenerationRef.current, (prev) => ({
          session: sessionData.session,
          players: sessionData.players,
          sessions: [sessionData.session, ...prev.sessions.filter((item) => item.id !== sessionData.session.id)],
        }));
      }
      await restoreGameRef.current(saved.gameKind as GameKind, saved.gameId as string);
      if (cancelled) return;
      if (saved.gameKind === "pictionary" && saved.secretWord) {
        updateIfCurrent(identityRef.current, authGenerationRef.current, {
          pictionaryWord: saved.secretWord,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [call, state.user?.id, updateIfCurrent]);

  const forgetCurrentGame = useCallback(() => forgetLastGame(state.user?.id), [state.user?.id]);

  const createCodenames = useCallback(
    async (sessionId: string) => {
      const token = identityRef.current;
      const generation = authGenerationRef.current;
      if (!token) return;
      const result = (await guard("Create Codenames game", () =>
        call<{ game: CodenamesGame }>("/codenames/games", {
          method: "POST",
          body: { session_id: sessionId },
        }),
      )) as { game: CodenamesGame } | null;
      if (result) {
        updateIfCurrent(token, generation, {
          gameKind: "codenames",
          codenames: normalizeCodenames(result.game),
          gameId: result.game.id,
        });
        saveLastGame(state.user?.id, {
          sessionId,
          gameId: result.game.id,
          gameKind: "codenames",
        });
      }
    },
    [call, guard, state.user?.id, updateIfCurrent],
  );

  const startCodenames = useCallback(
    async (id: string) => {
      const token = identityRef.current;
      const generation = authGenerationRef.current;
      if (!token) return;
      await guard("Start game", () =>
        call(`/codenames/games/${id}/status`, { method: "POST", body: { status: "active" } }),
      );
      if (isCurrent(token, generation)) await loadGame("codenames", id);
    },
    [call, guard, isCurrent, loadGame],
  );

  const guessCodenames = useCallback(
    async (id: string, word: string) => {
      const token = identityRef.current;
      const generation = authGenerationRef.current;
      if (!token) return;
      const result = await guard("Guess", () =>
        call<{ outcome?: string }>(`/codenames/games/${id}/guess`, {
          method: "POST",
          body: { word },
        }),
      );
      if (!result || !isCurrent(token, generation)) return;
      const outcome = (result as { outcome?: string }).outcome;
      if (outcome) toast.info(`Guess: ${outcome.replace(/_/g, " ")}`);
      await loadGame("codenames", id);
    },
    [call, guard, isCurrent, loadGame],
  );

  const clueCodenames = useCallback(
    async (id: string, word: string, number: number) => {
      const token = identityRef.current;
      const generation = authGenerationRef.current;
      if (!token) return;
      await guard("Clue", () =>
        call(`/codenames/games/${id}/clue`, {
          method: "POST",
          body: { game_id: id, word, number },
        }),
      );
      if (isCurrent(token, generation)) await loadGame("codenames", id);
    },
    [call, guard, isCurrent, loadGame],
  );

  const createGinRummy = useCallback(
    async (sessionId: string) => {
      const token = identityRef.current;
      const generation = authGenerationRef.current;
      if (!token) return;
      const result = (await guard("Create Gin-rummy game", () =>
        call<{ game: GinRummyGame }>("/gin-rummy/games", {
          method: "POST",
          body: { session_id: sessionId },
        }),
      )) as { game: GinRummyGame } | null;
      if (result) {
        updateIfCurrent(token, generation, {
          gameKind: "gin-rummy",
          ginRummy: normalizeGinRummy(result.game, state.user?.id),
          gameId: result.game.id,
        });
        saveLastGame(state.user?.id, {
          sessionId,
          gameId: result.game.id,
          gameKind: "gin-rummy",
        });
      }
    },
    [call, guard, state.user?.id, updateIfCurrent],
  );

  const joinGinRummy = useCallback(
    async (id: string) => {
      const token = identityRef.current;
      const generation = authGenerationRef.current;
      if (!token) return;
      const result = (await guard("Join game", () =>
        call<{ game: GinRummyGame }>(`/gin-rummy/games/${id}/join`, { method: "POST", body: {} }),
      )) as { game: GinRummyGame } | null;
      if (result) {
        updateIfCurrent(token, generation, {
          gameKind: "gin-rummy",
          ginRummy: normalizeGinRummy(result.game, state.user?.id),
          gameId: result.game.id,
        });
        saveLastGame(state.user?.id, {
          sessionId: result.game.session_id,
          gameId: result.game.id,
          gameKind: "gin-rummy",
        });
      }
    },
    [call, guard, state.user?.id, updateIfCurrent],
  );

  const ginMove = useCallback(
    async (id: string, action: string, body: unknown, label: string) => {
      const token = identityRef.current;
      const generation = authGenerationRef.current;
      if (!token) return;
      const result = (await guard(label, () =>
        call<{ game: GinRummyGame }>(`/gin-rummy/games/${id}/${action}`, {
          method: "POST",
          body,
        }),
      )) as { game: GinRummyGame } | null;
      if (result)
        updateIfCurrent(token, generation, {
          ginRummy: normalizeGinRummy(result.game, state.user?.id),
        });
    },
    [call, guard, state.user?.id, updateIfCurrent],
  );

  const drawGinRummy = useCallback(
    (id: string, source: "stock" | "discard") => ginMove(id, "draw", { source }, "Draw"),
    [ginMove],
  );
  const discardGinRummy = useCallback(
    (id: string, card: string) => ginMove(id, "discard", { card }, "Discard"),
    [ginMove],
  );
  const meldGinRummy = useCallback(
    (id: string, melds: string[][]) => ginMove(id, "meld", { melds }, "Meld"),
    [ginMove],
  );

  const createPictionary = useCallback(
    async (sessionId: string) => {
      const token = identityRef.current;
      const generation = authGenerationRef.current;
      if (!token) return;
      const result = (await guard("Create Pictionary round", () =>
        call<{ round: PictionaryRound; word: string }>("/pictionary/rounds", {
          method: "POST",
          body: { session_id: sessionId },
        }),
      )) as { round: PictionaryRound; word?: string } | null;
      if (result) {
        const secretWord = result.word ?? null;
        updateIfCurrent(token, generation, {
          gameKind: "pictionary",
          pictionary: result.round,
          pictionaryWord: secretWord,
          gameId: result.round.id,
        });
        saveLastGame(state.user?.id, {
          sessionId,
          gameId: result.round.id,
          gameKind: "pictionary",
          secretWord: secretWord ?? undefined,
        });
      }
    },
    [call, guard, state.user?.id, updateIfCurrent],
  );

  const guessPictionary = useCallback(
    async (id: string, guess: string) => {
      const token = identityRef.current;
      const generation = authGenerationRef.current;
      if (!token) return;
      const result = await guard("Guess", () =>
        call<{ word?: string; won?: boolean }>(`/pictionary/rounds/${id}/guess`, {
          method: "POST",
          // The service validates round_id in the body as well as the path;
          // omitting it made every guess from the UI fail with 400.
          body: { round_id: id, guess },
        }),
      );
      if (!result || !isCurrent(token, generation)) return;
      // A winning guess reveals the word; keep it so the round can still be
      // rendered correctly after a reload.
      const revealedWord = (result as { word?: string }).word;
      if (revealedWord)
        updateIfCurrent(token, generation, { pictionaryWord: revealedWord });
      saveLastGame(state.user?.id, {
        gameId: id,
        gameKind: "pictionary",
        ...(revealedWord ? { secretWord: revealedWord } : {}),
      });
      await loadGame("pictionary", id);
    },
    [call, guard, isCurrent, loadGame, state.user?.id, updateIfCurrent],
  );

  const loadRooms = useCallback(async () => {
    const token = identityRef.current;
    const generation = authGenerationRef.current;
    if (!token) return;
    const result = (await guard("Rooms", () => call<{ rooms: ChatRoom[] }>("/chat/rooms"))) as
      | { rooms: ChatRoom[] }
      | null;
    if (result) updateIfCurrent(token, generation, { rooms: result.rooms });
  }, [call, guard, updateIfCurrent]);

  const createRoom = useCallback(
    async (name: string) => {
      const token = identityRef.current;
      const generation = authGenerationRef.current;
      if (!token) return;
      // Room names become a single URL path segment. Encoded separators and
      // bare dot segments are rejected by the gateway/URL parser, so reject
      // them at creation time instead of creating an unopenable room. Other
      // dots (e.g. "team.v2") remain perfectly valid path characters.
      const trimmed = name.trim();
      if (!trimmed || /[\\/]/.test(trimmed) || trimmed === "." || trimmed === "..") {
        toast.error("Room name cannot be '.' or '..' or contain '/', '\\'");
        return;
      }
      await guard("Create room", () =>
        call("/chat/rooms", { method: "POST", body: { name: trimmed } }),
      );
      if (isCurrent(token, generation)) await loadRooms();
    },
    [call, guard, isCurrent, loadRooms],
  );

  const loadMessages = useCallback(
    async (room: string) => {
      const token = identityRef.current;
      const generation = authGenerationRef.current;
      if (!token) return;
      // Only the most recently requested room may write selection + messages.
      // Without this, a slow response for the previous room wins the race and
      // silently switches the player back after they selected another room.
      const seq = ++chatRoomRequestRef.current;
      const result = (await guard("Messages", () =>
        call<{ messages: ChatMessage[] }>(`/chat/rooms/${encodeURIComponent(room)}/messages?limit=50`),
      )) as { messages: ChatMessage[] } | null;
      if (result && seq === chatRoomRequestRef.current)
        updateIfCurrent(token, generation, { room, messages: result.messages });
    },
    [call, guard, updateIfCurrent],
  );

  const sendMessage = useCallback(
    async (room: string, content: string) => {
      const token = identityRef.current;
      const generation = authGenerationRef.current;
      if (!token) return;
      await guard("Message", () =>
        call(`/chat/rooms/${encodeURIComponent(room)}/messages`, {
          method: "POST",
          body: { content },
        }),
      );
      if (isCurrent(token, generation)) await loadMessages(room);
    },
    [call, guard, isCurrent, loadMessages],
  );

  const loadLeaderboard = useCallback(
    async (gameType: string) => {
      const token = identityRef.current;
      const generation = authGenerationRef.current;
      if (!token) return;
      const result = (await guard("Leaderboard", () =>
        call<{ entries: LeaderboardEntry[] }>(`/leaderboard/${encodeURIComponent(gameType)}?limit=20`),
      )) as { entries: LeaderboardEntry[] } | null;
      if (result) updateIfCurrent(token, generation, { leaderboard: result.entries });
    },
    [call, guard, updateIfCurrent],
  );

  const loadTournaments = useCallback(async () => {
    const token = identityRef.current;
    const generation = authGenerationRef.current;
    if (!token) return;
    const result = (await guard("Tournaments", () => call<{ items: Tournament[] }>("/tournaments"))) as
      | { items: Tournament[] }
      | null;
    if (result) updateIfCurrent(token, generation, { tournaments: result.items });
  }, [call, guard, updateIfCurrent]);

  const joinTournament = useCallback(
    async (id: string) => {
      const token = identityRef.current;
      const generation = authGenerationRef.current;
      if (!token) return;
      await guard("Join tournament", () =>
        call(`/tournaments/${id}/join`, { method: "POST", body: {} }),
      );
      if (isCurrent(token, generation)) await loadTournaments();
    },
    [call, guard, isCurrent, loadTournaments],
  );

  const loadPromotions = useCallback(async () => {
    const token = identityRef.current;
    const generation = authGenerationRef.current;
    if (!token) return;
    const result = (await guard("Promotions", () => call<{ items: Promotion[] }>("/promotions"))) as
      | { items: Promotion[] }
      | null;
    if (result) updateIfCurrent(token, generation, { promotions: result.items });
  }, [call, guard, updateIfCurrent]);

  const claimPromotion = useCallback(
    async (code: string) => {
      const token = identityRef.current;
      const generation = authGenerationRef.current;
      if (!token) return;
      await guard("Claim", () => call(`/promotions/${encodeURIComponent(code)}/claim`, { method: "POST", body: {} }));
      if (!isCurrent(token, generation)) return;
      await Promise.all([loadPromotions(), loadDashboard()]);
    },
    [call, guard, isCurrent, loadDashboard, loadPromotions],
  );

  // Unified crash game. The gateway forwards these to @gp/crash; the browser
  // only ever sends its player JWT and never talks to a betting site.
  const loadCrash = useCallback(async () => {
    const token = identityRef.current;
    const generation = authGenerationRef.current;
    if (!token) return;
    const [current, history] = await Promise.allSettled([
      call<{ round: CrashRound | null }>("/crash/rounds/current"),
      call<{ items: CrashRound[] }>("/crash/rounds/history?limit=12"),
    ]);
    if (!isCurrent(token, generation)) return;
    const round = current.status === "fulfilled" ? current.value.round : null;
    let myBet: CrashBet | null | undefined;
    if (current.status === "fulfilled" && round) {
      try {
        const detail = await call<{ myBet: CrashBet | null }>(`/crash/rounds/${round.id}`);
        if (!isCurrent(token, generation)) return;
        myBet = detail.myBet;
      } catch {
        // A failed detail fetch says nothing about the bet. Leaving `myBet`
        // undefined keeps the last known stake visible (and cash-out enabled)
        // instead of fabricating "no bet" during a transient 429/503.
      }
    }
    // A failed poll is not authoritative state. Keep the last known round,
    // bet and history rather than showing a fabricated "no flight" screen.
    updateIfCurrent(token, generation, (prev) => {
      if (current.status === "rejected") return {};
      return {
        crash: {
          round: round ?? null,
          myBet: myBet === undefined ? prev.crash.myBet : myBet,
          history: history.status === "fulfilled" ? history.value.items : prev.crash.history,
        },
      };
    });
  }, [call, isCurrent, updateIfCurrent]);

  useEffect(() => {
    dashboardRefreshRef.current = () => void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    crashRefreshRef.current = () => void loadCrash();
  }, [loadCrash]);

  useEffect(() => {
    if (!state.token) return;
    void loadCrash();
    // While the event stream is live, crash.* frames already schedule a
    // refresh. Polling every second on top of that sent 120-180 req/min and
    // exhausted the gateway's 120 req/min per-user read quota, silently
    // freezing the board. Keep a slow poll only as an offline fallback.
    if (state.streamReady) return;
    const timer = setInterval(() => void loadCrash(), 3000);
    return () => clearInterval(timer);
  }, [state.token, state.streamReady, loadCrash]);

  const placeCrashBet = useCallback(
    async (amount: number, autoCashout?: number | null) => {
      const token = identityRef.current;
      const generation = authGenerationRef.current;
      if (!token) return false;
      const roundId = state.crash.round?.id;
      if (!roundId) {
        toast.error("Bet: no active round");
        return false;
      }
      const result = await guard("Bet", () =>
        call("/crash/rounds/" + roundId + "/bets", {
          method: "POST",
          body: {
            amount,
            ...(autoCashout ? { autoCashout } : {}),
            // Anchor the wager to a crash session so a verified cash-out can
            // award leaderboard points. Other game sessions are ignored.
            ...(state.session?.game_type === "crash" ? { sessionId: state.session.id } : {}),
          },
        }),
      );
      if (!result) return false;
      toast.success("Stake placed");
      if (!isCurrent(token, generation)) return false;
      await Promise.all([loadCrash(), loadDashboard()]);
      return true;
    },
    [call, guard, isCurrent, loadCrash, loadDashboard, state.crash.round, state.session],
  );

  const cashOutCrash = useCallback(async () => {
    const token = identityRef.current;
    const generation = authGenerationRef.current;
    if (!token) return false;
    const roundId = state.crash.round?.id;
    if (!roundId) return false;
    const result = await guard("Cash out", () =>
      call("/crash/rounds/" + roundId + "/cashout", { method: "POST", body: {} }),
    );
    if (!result) return false;
    toast.success("Cashed out");
    if (!isCurrent(token, generation)) return false;
    await Promise.all([loadCrash(), loadDashboard()]);
    return true;
  }, [call, guard, isCurrent, loadCrash, loadDashboard, state.crash.round]);

  const runStrategyLab = useCallback(
    async (input: {
      seed: string;
      rounds: number;
      stake: number;
      target: number;
      strategies: string[];
    }) => {
      const token = identityRef.current;
      const generation = authGenerationRef.current;
      const result = await guard("Strategy lab", () =>
        call<StrategyLabReport>("/crash/strategy-lab/run", { method: "POST", body: input }),
      );
      if (!isCurrent(token, generation)) return null;
      return (result as StrategyLabReport | null) ?? null;
    },
    [call, guard, isCurrent],
  );

  // Privileged controls are hidden for players without the matching grant.
  // The gateway re-checks RBAC on every request, so this is presentation only.
  const loadPermissions = useCallback(async () => {
    const token = identityRef.current;
    const generation = authGenerationRef.current;
    if (!token) return;
    const result = await guard("Permissions", () =>
      call<{ permissions: string[] }>("/me/permissions"));
    if (result && isCurrent(token, generation)) {
      const granted = result as { permissions?: string[] };
      updateIfCurrent(token, generation, { permissions: granted.permissions ?? [] });
    }
  }, [call, guard, isCurrent, updateIfCurrent]);

  useEffect(() => {
    if (!state.user?.id) return;
    void loadPermissions();
  }, [state.user?.id, loadPermissions]);

  const loadAudit = useCallback(async () => {
    const token = identityRef.current;
    const generation = authGenerationRef.current;
    if (!token) return;
    // call() already prefixes /v1; this route is /v1/internal/audit/verify.
    const result = await guard("Audit", () => call<AuditReport>("/internal/audit/verify"));
    if (result) updateIfCurrent(token, generation, { audit: result as AuditReport });
  }, [call, guard, updateIfCurrent]);

  const value = useMemo<ContextType>(
    () => ({
      ...state,
      update,
      signUp,
      signIn,
      signOut,
      loadDashboard,
      createSession,
      joinSession,
      loadGame,
      forgetLastGame: forgetCurrentGame,
      createCodenames,
      startCodenames,
      guessCodenames,
      clueCodenames,
      createGinRummy,
      joinGinRummy,
      drawGinRummy,
      discardGinRummy,
      meldGinRummy,
      createPictionary,
      guessPictionary,
      loadRooms,
      createRoom,
      loadMessages,
      sendMessage,
      loadLeaderboard,
      loadTournaments,
      joinTournament,
      loadPromotions,
      claimPromotion,
      loadAudit,
      loadCrash,
      placeCrashBet,
      cashOutCrash,
      runStrategyLab,
    }),
    [
      state,
      update,
      signUp,
      signIn,
      signOut,
      loadDashboard,
      createSession,
      joinSession,
      loadGame,
      forgetCurrentGame,
      createCodenames,
      startCodenames,
      guessCodenames,
      clueCodenames,
      createGinRummy,
      joinGinRummy,
      drawGinRummy,
      discardGinRummy,
      meldGinRummy,
      createPictionary,
      guessPictionary,
      loadRooms,
      createRoom,
      loadMessages,
      sendMessage,
      loadLeaderboard,
      loadTournaments,
      joinTournament,
      loadPromotions,
      claimPromotion,
      loadAudit,
      loadCrash,
      placeCrashBet,
      cashOutCrash,
      runStrategyLab,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
};

export function useGamingContext(): ContextType {
  return React.useContext(Context);
}

export default Context;
