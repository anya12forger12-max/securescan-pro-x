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
  crash: CrashState;
  audit: AuditReport | null;
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
  crash: { round: null, myBet: null, history: [] },
  audit: null,
  ready: false,
  streamReady: false,
  lastSeq: 0,
};

const Context = React.createContext<ContextType>(null!);

function persist(token: string | null, refreshToken: string | null) {
  if (token) localStorage.setItem(config.tokenKey, token);
  else localStorage.removeItem(config.tokenKey);
  if (refreshToken) localStorage.setItem(config.refreshKey, refreshToken);
  else localStorage.removeItem(config.refreshKey);
}

export const Provider = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = React.useState<ContextDataType>(initialState);
  const tokenRef = useRef<string | null>(null);
  const lastSeqRef = useRef(0);
  const refreshPromiseRef = useRef<Promise<string | null> | null>(null);

  useEffect(() => {
    tokenRef.current = state.token;
  }, [state.token]);

  const update = useCallback((attrs: Partial<ContextDataType>) => {
    setState((prev) => ({ ...prev, ...attrs }));
  }, []);

  /** Rotate the 15-minute access token with the durable refresh token. One
   * shared promise prevents parallel 401s from racing the single-use token. */
  const refreshSession = useCallback((): Promise<string | null> => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const refreshToken = localStorage.getItem(config.refreshKey);
    if (!refreshToken) return Promise.resolve(null);

    refreshPromiseRef.current = apiRequest<AuthData>("/auth/refresh", {
      method: "POST",
      body: { refresh_token: refreshToken },
    })
      .then((data) => {
        persist(data.token, data.refresh_token);
        tokenRef.current = data.token;
        update({ token: data.token, user: data.user });
        return data.token;
      })
      .catch(() => {
        persist(null, null);
        tokenRef.current = null;
        update({ token: null, user: null });
        return null;
      })
      .finally(() => {
        refreshPromiseRef.current = null;
      });
    return refreshPromiseRef.current;
  }, [update]);

  const call = useCallback(
    async <T,>(path: string, init: RequestOptions = {}): Promise<T> => {
      const request = (token: string | null) => apiRequest<T>(path, { ...init, token });
      try {
        return await request(tokenRef.current);
      } catch (err) {
        // Auth endpoints own their own 401s; every other expired access token
        // is silently refreshed and the original request replayed once.
        if (!(err instanceof ApiError && err.status === 401) || path.startsWith("/auth/")) throw err;
        const refreshed = await refreshSession();
        if (!refreshed) throw err;
        return request(refreshed);
      }
    },
    [refreshSession],
  );

  const guard = useCallback(
    async (label: string, action: () => Promise<unknown>, success?: string) => {
      try {
        const result = await action();
        if (success) toast.success(success);
        return result;
      } catch (err) {
        const message = err instanceof ApiError && err.status === 401
          ? "Session expired - please sign in again"
          : errorMessage(err);
        toast.error(`${label}: ${message}`);
        return null;
      }
    },
    [],
  );

  // Restore the session the same way the Aviator client reads its `cert`
  // query parameter, but from durable storage and with server verification.
  useEffect(() => {
    let cancelled = false;
    const stored = localStorage.getItem(config.tokenKey);
    if (!stored) {
      update({ ready: true });
      return;
    }
    void (async () => {
      try {
        const data = await apiRequest<{ user: User }>("/auth/me", { token: stored });
        if (cancelled) return;
        tokenRef.current = stored;
        update({ token: stored, user: data.user });
      } catch (err) {
        if (cancelled) return;
        // A stale access token is normal after 15 minutes; the 30-day refresh
        // token should keep the session alive instead of forcing a new login.
        if (err instanceof ApiError && err.status === 401) {
          const refreshed = await refreshSession();
          if (cancelled) return;
          if (refreshed) {
            try {
              const me = await apiRequest<{ user: User }>("/auth/me", { token: refreshed });
              if (!cancelled) update({ token: refreshed, user: me.user });
              return;
            } catch {
              // Fall through and clear the unusable session.
            }
          }
        }
        persist(null, null);
        tokenRef.current = null;
        update({ token: null, user: null });
      } finally {
        if (!cancelled) update({ ready: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSession, update]);

  // Durable event stream. Fetch is used instead of EventSource because the
  // gateway requires an Authorization header on every event request.
  useEffect(() => {
    if (!state.token) return;
    let cancelled = false;
    let controller: AbortController | null = null;
    let retry: number | undefined;

    const connect = async () => {
      controller = new AbortController();
      try {
        const response = await fetch(`${config.events}?since=${lastSeqRef.current}`, {
          headers: { authorization: `Bearer ${state.token}` },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error(`stream failed (${response.status})`);
        update({ streamReady: true });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let split = buffer.indexOf("\n\n");
          while (split >= 0) {
            const frame = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            const line = frame.split("\n").find((item) => item.startsWith("data:"));
            if (line) {
              try {
                const event = JSON.parse(line.slice(5).trim()) as RealtimeEvent;
                const seq = Number(event.seq);
                if (Number.isFinite(seq) && seq > lastSeqRef.current) {
                  lastSeqRef.current = seq;
                  setState((prev) => ({
                    ...prev,
                    lastSeq: seq,
                    events: [event, ...prev.events].slice(0, 100),
                    history: [seq, ...prev.history].slice(0, 24),
                  }));
                }
              } catch {
                // Ignore malformed frames and keep the stream alive.
              }
            }
            split = buffer.indexOf("\n\n");
          }
        }
      } catch (err) {
        if (!cancelled) {
          update({ streamReady: false });
          retry = window.setTimeout(connect, 2000);
        }
      }
    };

    void connect();
    return () => {
      cancelled = true;
      if (retry) window.clearTimeout(retry);
      controller?.abort();
      update({ streamReady: false });
    };
  }, [state.token, update]);

  const loadDashboard = useCallback(async () => {
    if (!tokenRef.current) return;
    const [balance, transactions, rooms, promotions, tournaments] = await Promise.allSettled([
      call<{ account: WalletAccount }>("/wallet/balance"),
      call<{ items: WalletTransaction[] }>("/wallet/transactions?limit=20"),
      call<{ rooms: ChatRoom[] }>("/chat/rooms"),
      call<{ items: Promotion[] }>("/promotions"),
      call<{ items: Tournament[] }>("/tournaments"),
    ]);
    update({
      balance: balance.status === "fulfilled" ? balance.value.account.balance : "0.00",
      myBets: transactions.status === "fulfilled" ? transactions.value.items : [],
      rooms: rooms.status === "fulfilled" ? rooms.value.rooms : [],
      promotions: promotions.status === "fulfilled" ? promotions.value.items : [],
      tournaments: tournaments.status === "fulfilled" ? tournaments.value.items : [],
    });
    if (rooms.status === "fulfilled" && rooms.value.rooms.length) {
      const room = rooms.value.rooms[0].name;
      const messages = await call<{ messages: ChatMessage[] }>(
        `/chat/rooms/${encodeURIComponent(room)}/messages?limit=50`,
      ).catch(() => ({ messages: [] }));
      update({ room, messages: messages.messages });
    }
  }, [call, update]);

  useEffect(() => {
    if (state.token) void loadDashboard();
  }, [state.token, loadDashboard]);

  const applyAuth = useCallback(
    async (data: AuthData) => {
      persist(data.token, data.refresh_token);
      tokenRef.current = data.token;
      update({ token: data.token, user: data.user });
      await loadDashboard();
    },
    [loadDashboard, update],
  );

  const signUp = useCallback(
    async (username: string, email: string, password: string) => {
      const ok = await guard("Register", async () => {
        await call("/auth/register", { method: "POST", body: { username, email, password } });
        return call<AuthData>("/auth/login", {
          method: "POST",
          body: { identifier: username, password },
        });
      });
      if (!ok) return false;
      await applyAuth(ok as AuthData);
      toast.success("Account created");
      return true;
    },
    [applyAuth, call, guard],
  );

  const signIn = useCallback(
    async (identifier: string, password: string) => {
      const data = await guard("Sign in", () =>
        call<AuthData>("/auth/login", { method: "POST", body: { identifier, password } }),
      );
      if (!data) return false;
      await applyAuth(data as AuthData);
      toast.success("Signed in");
      return true;
    },
    [applyAuth, call, guard],
  );

  const signOut = useCallback(async () => {
    // Send the refresh token so the server revokes it too; clearing only local
    // storage would leave a 30-day credential usable by anyone who copied it.
    const refreshToken = localStorage.getItem(config.refreshKey);
    if (refreshToken) {
      await apiRequest("/auth/logout", {
        method: "POST",
        body: { refresh_token: refreshToken },
      }).catch(() => undefined);
    }
    persist(null, null);
    tokenRef.current = null;
    setState({ ...initialState, ready: true });
    toast.info("Signed out");
  }, []);

  const createSession = useCallback(
    async (kind: GameKind) => {
      const result = (await guard("Create session", () =>
        call<{ session: GameSession }>("/game/sessions", {
          method: "POST",
          body: { game_type: kind },
        }),
      )) as { session: GameSession } | null;
      if (!result) return null;
      update({ session: result.session, sessions: [result.session, ...state.sessions] });
      toast.success("Session created");
      return result.session;
    },
    [call, guard, state.sessions, update],
  );

  const joinSession = useCallback(
    async (id: string) => {
      // The join endpoint returns only `{ player }`. Read the session back so
      // the board keeps its existing session and player list instead of being
      // overwritten with undefined by the join response.
      const joined = await guard("Join session", () =>
        call(`/game/sessions/${id}/join`, { method: "POST", body: {} }),
      );
      if (!joined) return;
      const data = await guard("Session", () =>
        call<{ session: GameSession; players: GamePlayer[] }>(`/game/sessions/${id}`),
      );
      if (data) {
        const sessionData = data as { session: GameSession; players: GamePlayer[] };
        update({ session: sessionData.session, players: sessionData.players });
      }
    },
    [call, guard, update],
  );

  const loadGame = useCallback(
    async (kind: GameKind, id: string) => {
      const paths: Record<GameKind, string> = {
        codenames: `/codenames/games/${id}`,
        "gin-rummy": `/gin-rummy/games/${id}`,
        pictionary: `/pictionary/rounds/${id}`,
        crash: `/crash/rounds/${id}`,
      };
      const patch: Partial<ContextDataType> = { gameKind: kind, gameId: id };
      const result = await guard("Load game", () => call<Record<string, unknown>>(paths[kind]));
      if (result) {
        const data = result as Record<string, unknown>;
        if (kind === "codenames") patch.codenames = data.game as CodenamesGame;
        if (kind === "gin-rummy") patch.ginRummy = data.game as GinRummyGame;
        if (kind === "pictionary") patch.pictionary = data.round as PictionaryRound;
        if (kind === "crash") {
          const round = data.round as CrashRound;
          patch.crash = { round, myBet: (data.myBet as CrashBet) ?? null, history: state.crash.history };
        }
      }
      update(patch);
    },
    [call, guard, state.crash.history, update],
  );

  const createCodenames = useCallback(
    async (sessionId: string) => {
      const result = (await guard("Create Codenames game", () =>
        call<{ game: CodenamesGame }>("/codenames/games", {
          method: "POST",
          body: { session_id: sessionId },
        }),
      )) as { game: CodenamesGame } | null;
      if (result) {
        update({ gameKind: "codenames", codenames: result.game, gameId: result.game.id });
      }
    },
    [call, guard, update],
  );

  const startCodenames = useCallback(
    async (id: string) => {
      await guard("Start game", () =>
        call(`/codenames/games/${id}/status`, { method: "POST", body: { status: "active" } }),
      );
      await loadGame("codenames", id);
    },
    [call, guard, loadGame],
  );

  const guessCodenames = useCallback(
    async (id: string, word: string) => {
      const result = await guard("Guess", () =>
        call(`/codenames/games/${id}/guess`, { method: "POST", body: { word } }),
      );
      if (result) await loadGame("codenames", id);
    },
    [call, guard, loadGame],
  );

  const clueCodenames = useCallback(
    async (id: string, word: string, number: number) => {
      await guard("Clue", () =>
        call(`/codenames/games/${id}/clue`, {
          method: "POST",
          body: { game_id: id, word, number },
        }),
      );
      await loadGame("codenames", id);
    },
    [call, guard, loadGame],
  );

  const createGinRummy = useCallback(
    async (sessionId: string) => {
      const result = (await guard("Create Gin-rummy game", () =>
        call<{ game: GinRummyGame }>("/gin-rummy/games", {
          method: "POST",
          body: { session_id: sessionId },
        }),
      )) as { game: GinRummyGame } | null;
      if (result) update({ gameKind: "gin-rummy", ginRummy: result.game, gameId: result.game.id });
    },
    [call, guard, update],
  );

  const joinGinRummy = useCallback(
    async (id: string) => {
      const result = (await guard("Join game", () =>
        call<{ game: GinRummyGame }>(`/gin-rummy/games/${id}/join`, { method: "POST", body: {} }),
      )) as { game: GinRummyGame } | null;
      if (result) update({ gameKind: "gin-rummy", ginRummy: result.game, gameId: result.game.id });
    },
    [call, guard, update],
  );

  const ginMove = useCallback(
    async (id: string, action: string, body: unknown, label: string) => {
      const result = (await guard(label, () =>
        call<{ game: GinRummyGame }>(`/gin-rummy/games/${id}/${action}`, {
          method: "POST",
          body,
        }),
      )) as { game: GinRummyGame } | null;
      if (result) update({ ginRummy: result.game });
    },
    [call, guard, update],
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
      const result = (await guard("Create Pictionary round", () =>
        call<{ round: PictionaryRound }>("/pictionary/rounds", {
          method: "POST",
          body: { session_id: sessionId },
        }),
      )) as { round: PictionaryRound } | null;
      if (result) update({ gameKind: "pictionary", pictionary: result.round, gameId: result.round.id });
    },
    [call, guard, update],
  );

  const guessPictionary = useCallback(
    async (id: string, guess: string) => {
      const result = await guard("Guess", () =>
        call(`/pictionary/rounds/${id}/guess`, { method: "POST", body: { guess } }),
      );
      if (result) await loadGame("pictionary", id);
    },
    [call, guard, loadGame],
  );

  const loadRooms = useCallback(async () => {
    const result = (await guard("Rooms", () => call<{ rooms: ChatRoom[] }>("/chat/rooms"))) as
      | { rooms: ChatRoom[] }
      | null;
    if (result) update({ rooms: result.rooms });
  }, [call, guard, update]);

  const createRoom = useCallback(
    async (name: string) => {
      await guard("Create room", () =>
        call("/chat/rooms", { method: "POST", body: { name } }),
      );
      await loadRooms();
    },
    [call, guard, loadRooms],
  );

  const loadMessages = useCallback(
    async (room: string) => {
      const result = (await guard("Messages", () =>
        call<{ messages: ChatMessage[] }>(`/chat/rooms/${encodeURIComponent(room)}/messages?limit=50`),
      )) as { messages: ChatMessage[] } | null;
      if (result) update({ room, messages: result.messages });
    },
    [call, guard, update],
  );

  const sendMessage = useCallback(
    async (room: string, content: string) => {
      await guard("Message", () =>
        call(`/chat/rooms/${encodeURIComponent(room)}/messages`, {
          method: "POST",
          body: { content },
        }),
      );
      await loadMessages(room);
    },
    [call, guard, loadMessages],
  );

  const loadLeaderboard = useCallback(
    async (gameType: string) => {
      const result = (await guard("Leaderboard", () =>
        call<{ entries: LeaderboardEntry[] }>(`/leaderboard/${encodeURIComponent(gameType)}?limit=20`),
      )) as { entries: LeaderboardEntry[] } | null;
      if (result) update({ leaderboard: result.entries });
    },
    [call, guard, update],
  );

  const loadTournaments = useCallback(async () => {
    const result = (await guard("Tournaments", () => call<{ items: Tournament[] }>("/tournaments"))) as
      | { items: Tournament[] }
      | null;
    if (result) update({ tournaments: result.items });
  }, [call, guard, update]);

  const joinTournament = useCallback(
    async (id: string) => {
      await guard("Join tournament", () =>
        call(`/tournaments/${id}/join`, { method: "POST", body: {} }),
      );
      await loadTournaments();
    },
    [call, guard, loadTournaments],
  );

  const loadPromotions = useCallback(async () => {
    const result = (await guard("Promotions", () => call<{ items: Promotion[] }>("/promotions"))) as
      | { items: Promotion[] }
      | null;
    if (result) update({ promotions: result.items });
  }, [call, guard, update]);

  const claimPromotion = useCallback(
    async (code: string) => {
      await guard("Claim", () => call(`/promotions/${encodeURIComponent(code)}/claim`, { method: "POST", body: {} }));
      await Promise.all([loadPromotions(), loadDashboard()]);
    },
    [call, guard, loadDashboard, loadPromotions],
  );

  // Unified crash game. The gateway forwards these to @gp/crash; the browser
  // only ever sends its player JWT and never talks to a betting site.
  const loadCrash = useCallback(async () => {
    if (!tokenRef.current) return;
    const [current, history] = await Promise.allSettled([
      call<{ round: CrashRound | null }>("/crash/rounds/current"),
      call<{ items: CrashRound[] }>("/crash/rounds/history?limit=12"),
    ]);
    const round = current.status === "fulfilled" ? current.value.round : null;
    let myBet: CrashBet | null = null;
    if (round) {
      const detail = await call<{ myBet: CrashBet | null }>(`/crash/rounds/${round.id}`).catch(
        () => null,
      );
      myBet = detail?.myBet ?? null;
    }
    update({
      crash: {
        round,
        myBet,
        history: history.status === "fulfilled" ? history.value.items : [],
      },
    });
  }, [call, update]);

  useEffect(() => {
    if (!state.token) return;
    void loadCrash();
    const timer = setInterval(() => void loadCrash(), 1000);
    return () => clearInterval(timer);
  }, [state.token, loadCrash]);

  const placeCrashBet = useCallback(
    async (amount: number, autoCashout?: number | null) => {
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
      await Promise.all([loadCrash(), loadDashboard()]);
      return true;
    },
    [call, guard, loadCrash, loadDashboard, state.crash.round, state.session],
  );

  const cashOutCrash = useCallback(async () => {
    const roundId = state.crash.round?.id;
    if (!roundId) return false;
    const result = await guard("Cash out", () =>
      call("/crash/rounds/" + roundId + "/cashout", { method: "POST", body: {} }),
    );
    if (!result) return false;
    toast.success("Cashed out");
    await Promise.all([loadCrash(), loadDashboard()]);
    return true;
  }, [call, guard, loadCrash, loadDashboard, state.crash.round]);

  const runStrategyLab = useCallback(
    async (input: {
      seed: string;
      rounds: number;
      stake: number;
      target: number;
      strategies: string[];
    }) => {
      const result = await guard("Strategy lab", () =>
        call<StrategyLabReport>("/crash/strategy-lab/run", { method: "POST", body: input }),
      );
      return (result as StrategyLabReport | null) ?? null;
    },
    [call, guard],
  );

  const loadAudit = useCallback(async () => {
    const result = await guard("Audit", () => call<AuditReport>("/v1/internal/audit/verify"));
    if (result) update({ audit: result as AuditReport });
  }, [call, guard, update]);

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
