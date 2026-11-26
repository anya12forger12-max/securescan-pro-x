import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest, errorMessage } from '../../api';
import { config } from '../../config';
import { useGamingContext } from '../../context';
import type { GameKind } from '../../types';
import './aviator.scss';

type Phase = 'WAITING' | 'BETTING' | 'FLYING' | 'CRASHED' | 'SETTLING';
type PanelTab = 'bet' | 'auto';

interface AviatorRound {
  id: string;
  status: string;
  state?: Phase;
  seedHash: string;
  createdAt: string;
  startedAt: string | null;
  bettingEndsAt?: string | null;
  crashPoint?: number | null;
  doublingSeconds?: number;
  maxMultiplier?: number;
  houseEdge?: number;
}

interface AviatorBet {
  id: string;
  round_id: string;
  panel: number;
  amount: string;
  auto_cashout: string | null;
  cashout_at: string | null;
  payout: string | null;
  status: string;
  created_at: string;
}

interface TopEntry {
  user?: string;
  payout?: number;
  mult?: number;
  roundId?: string;
}

interface PanelSettings {
  stake: string;
  autoCashout: string;
  rounds: string;
  stopLoss: string;
  stopWin: string;
  tab: PanelTab;
}

const DEFAULT_PANEL: PanelSettings = {
  stake: '100', autoCashout: '2.00', rounds: '5', stopLoss: '500', stopWin: '1000', tab: 'bet',
};

const phaseOf = (round: AviatorRound | null, now: number): Phase => {
  if (!round) return 'WAITING';
  if (round.state && ['WAITING', 'BETTING', 'FLYING', 'CRASHED', 'SETTLING'].includes(round.state)) {
    return round.state;
  }
  if (round.status === 'finished' || round.status === 'cancelled') return 'CRASHED';
  if (round.status === 'running') {
    const started = round.startedAt ? Date.parse(round.startedAt) : NaN;
    const point = Number(round.crashPoint);
    const doubling = Number(round.doublingSeconds) || 3;
    const end = Number.isFinite(started) && Number.isFinite(point) && point > 0
      ? started + Math.log2(point) * doubling * 1000
      : NaN;
    return Number.isFinite(end) && now >= end ? 'CRASHED' : 'FLYING';
  }
  return 'BETTING';
};

const multiplierFor = (elapsedMs: number, doubling: number, cap: number): number => {
  const value = Math.pow(2, Math.max(0, elapsedMs) / (1000 * Math.max(0.001, doubling)));
  return Math.max(1, Math.min(value, cap));
};

const multClass = (value: number) => (value >= 10 ? 'mult-high' : value >= 2 ? 'mult-mid' : 'mult-low');

function useTick(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 80);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function FlightCanvas({ round, phase, multiplier, reduced }: {
  round: AviatorRound | null; phase: Phase; multiplier: number; reduced: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth || 640;
    const height = canvas.clientHeight || 320;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#111826');
    gradient.addColorStop(1, '#0a0d13');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    if (!reduced) {
      context.strokeStyle = 'rgba(74,163,255,0.07)';
      context.lineWidth = 1;
      for (let i = 1; i < 9; i++) {
        const angle = (i / 9) * Math.PI * 2;
        context.beginPath();
        context.moveTo(width / 2, height / 2);
        context.lineTo(width / 2 + Math.cos(angle) * width, height / 2 + Math.sin(angle) * height);
        context.stroke();
      }
    }

    context.strokeStyle = 'rgba(139,148,167,0.12)';
    context.fillStyle = 'rgba(139,148,167,0.65)';
    context.font = '10px ui-monospace, monospace';
    [1, 2, 5, 10, 25].forEach((level) => {
      const y = height - 12 - Math.log2(level) * (height - 30) / 5;
      if (y < 8) return;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
      context.fillText(`${level}x`, 4, Math.max(10, y - 3));
    });

    const elapsed = round?.startedAt
      ? Math.max(0, Date.now() - Date.parse(round.startedAt))
      : 0;
    const doubling = Number(round?.doublingSeconds) || 3;
    const cap = Number(round?.crashPoint) && phase === 'CRASHED'
      ? Number(round?.crashPoint)
      : Number(round?.maxMultiplier) || 100;
    const span = Math.max(4000, elapsed * 1.05);
    const samples = 80;
    const points: Array<[number, number]> = [];
    for (let i = 0; i <= samples; i++) {
      const t = (i / samples) * span;
      const value = multiplierFor(t, doubling, cap);
      points.push([
        (i / samples) * width,
        height - 12 - Math.min(5, Math.log2(value)) * (height - 30) / 5,
      ]);
    }

    const fill = context.createLinearGradient(0, 0, 0, height);
    fill.addColorStop(0, phase === 'CRASHED' ? 'rgba(224,51,74,0.32)' : 'rgba(74,163,255,0.26)');
    fill.addColorStop(1, 'rgba(74,163,255,0)');
    context.beginPath();
    context.moveTo(0, height);
    points.forEach(([x, y]) => context.lineTo(x, y));
    context.lineTo(width, height);
    context.closePath();
    context.fillStyle = fill;
    context.fill();

    context.beginPath();
    points.forEach(([x, y], index) => (index ? context.lineTo(x, y) : context.moveTo(x, y)));
    context.strokeStyle = phase === 'CRASHED' ? '#e0334a' : multiplier >= 10 ? '#ff5fb0' : '#4aa3ff';
    context.lineWidth = 2.5;
    context.stroke();

    const nose = points[Math.min(points.length - 1, Math.round((elapsed / span) * samples))];
    if (phase === 'FLYING' || phase === 'CRASHED') {
      context.save();
      context.translate(nose[0], nose[1] - 16);
      context.rotate(-0.32);
      context.fillStyle = phase === 'CRASHED' ? '#e0334a' : '#e8ecf3';
      context.beginPath();
      context.moveTo(18, 0);
      context.lineTo(-12, -7);
      context.lineTo(-8, 0);
      context.lineTo(-12, 7);
      context.closePath();
      context.fill();
      context.fillStyle = 'rgba(232,236,243,0.35)';
      context.beginPath();
      context.ellipse(-4, 0, 8, 2, 0, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
  }, [round, phase, multiplier, reduced]);

  return (
    <div className="aviator-canvas-wrap">
      <canvas ref={canvasRef} className="aviator-canvas" aria-label="Flight curve" role="img" />
      <div className={`aviator-hero ${multClass(multiplier)} ${phase.toLowerCase()}`}>
        <strong>{multiplier.toFixed(2)}x</strong>
        <small>
          {phase === 'BETTING' ? 'PLACE YOUR BETS'
            : phase === 'FLYING' ? 'CASH OUT BEFORE THE CRASH'
              : phase === 'CRASHED' ? `FLEW AWAY @ ${Number(round?.crashPoint ?? 1).toFixed(2)}x`
                : phase === 'SETTLING' ? 'SETTLING' : 'WAITING FOR NEXT ROUND'}
        </small>
      </div>
      {phase === 'BETTING' && round?.bettingEndsAt && (
        <div className="countdown">
          <span>{Math.max(0, Math.ceil((Date.parse(round.bettingEndsAt) - Date.now()) / 1000))}s</span>
          <div className="countdown-bar" />
        </div>
      )}
    </div>
  );
}

function BetPanel({ index, round, phase, multiplier, bet, token, onRefresh, notify }: {
  index: 1 | 2;
  round: AviatorRound | null;
  phase: Phase;
  multiplier: number;
  bet: AviatorBet | null;
  token: string | null;
  onRefresh: () => void;
  notify: (message: string, kind?: 'ok' | 'error') => void;
}) {
  const [settings, setSettings] = useState<PanelSettings>(DEFAULT_PANEL);
  const [busy, setBusy] = useState(false);
  const patch = (next: Partial<PanelSettings>) => setSettings((prev) => ({ ...prev, ...next }));
  const stake = Number(settings.stake);
  const validStake = Number.isFinite(stake) && stake > 0;
  const liveWin = bet && phase === 'FLYING'
    ? Number(bet.amount) * multiplier
    : bet?.payout ? Number(bet.payout) : 0;

  const placeBet = async () => {
    if (!round || !token || !validStake || busy) return;
    setBusy(true);
    try {
      await apiRequest(`/crash/rounds/${round.id}/bets`, {
        method: 'POST',
        token,
        body: {
          amount: stake,
          panel: index,
          requestId: `${Date.now()}-${index}`,
          ...(settings.tab === 'auto' && Number(settings.autoCashout) >= 1.01
            ? { autoCashout: Number(settings.autoCashout) } : {}),
        },
      });
      notify(`Panel ${index}: bet placed`);
      if (settings.tab === 'auto') {
        await apiRequest('/crash/auto', {
          method: 'POST',
          token,
          body: {
            panel: index,
            amount: stake,
            rounds: Number(settings.rounds) || 1,
            ...(Number(settings.autoCashout) >= 1.01 ? { autoCashout: Number(settings.autoCashout) } : {}),
            stopRules: {
              ...(Number(settings.stopLoss) > 0 ? { totalLossLimit: Number(settings.stopLoss) } : {}),
              ...(Number(settings.stopWin) > 0 ? { singleWinAbove: Number(settings.stopWin) } : {}),
            },
          },
        });
        notify(`Panel ${index}: auto bet started`);
      }
      onRefresh();
    } catch (error) {
      notify(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const cashOut = async () => {
    if (!round || !token || !bet || busy) return;
    setBusy(true);
    try {
      const result = await apiRequest<{ payout?: number; multiplier?: number }>(
        `/crash/rounds/${round.id}/cashout`,
        { method: 'POST', token, body: { panel: index, betId: bet.id } },
      );
      notify(`Panel ${index}: cashed out ${Number(result?.payout ?? liveWin).toFixed(2)}`);
      onRefresh();
    } catch (error) {
      notify(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!round || !token || !bet || busy) return;
    setBusy(true);
    try {
      await apiRequest(`/crash/rounds/${round.id}/bets/${bet.id}/cancel`, { method: 'POST', token });
      notify(`Panel ${index}: bet cancelled`);
      onRefresh();
    } catch (error) {
      notify(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const live = bet && phase === 'FLYING';
  const label = phase === 'BETTING'
    ? (bet ? 'CANCEL' : 'BET')
    : live ? `CASH OUT ${liveWin.toFixed(2)}`
      : phase === 'FLYING' ? 'WAIT FOR NEXT ROUND' : 'BET';
  const action = phase === 'BETTING' ? (bet ? cancel : placeBet) : live ? cashOut : () => undefined;
  const disabled = busy || !token || phase === 'CRASHED' || phase === 'SETTLING'
    || (phase === 'FLYING' && !live) || (!validStake && phase === 'BETTING' && !bet);

  return (
    <section className="aviator-panel" aria-label={`Bet panel ${index}`}>
      <div className="panel-tabs" role="tablist">
        {(['bet', 'auto'] as PanelTab[]).map((tab) => (
          <button key={tab} type="button" role="tab" aria-selected={settings.tab === tab}
            className={settings.tab === tab ? 'active' : ''}
            onClick={() => patch({ tab })}>
            {tab === 'bet' ? 'Bet' : 'Auto'}
          </button>
        ))}
        {bet && <span className="panel-state">{bet.status.replace('_', ' ')}</span>}
      </div>

      <div className="stake-row">
        <button type="button" aria-label="Decrease stake" onClick={() => patch({ stake: String(Math.max(1, stake - 10)) })}>−</button>
        <input aria-label={`Panel ${index} stake`} inputMode="decimal" value={settings.stake}
          onChange={(event) => patch({ stake: event.target.value })} />
        <button type="button" aria-label="Increase stake" onClick={() => patch({ stake: String(stake + 10) })}>+</button>
      </div>
      <div className="quick-amounts">
        {[10, 50, 100, 500].map((amount) => (
          <button key={amount} type="button" onClick={() => patch({ stake: String(amount) })}>{amount}</button>
        ))}
      </div>

      {settings.tab === 'auto' ? (
        <div className="auto-settings">
          <label>Auto cash out
            <input aria-label="Auto cash-out target" inputMode="decimal" value={settings.autoCashout}
              onChange={(event) => patch({ autoCashout: event.target.value })} />
          </label>
          <label>Rounds
            <input aria-label="Auto bet rounds" inputMode="numeric" value={settings.rounds}
              onChange={(event) => patch({ rounds: event.target.value })} />
          </label>
          <label>Stop loss
            <input aria-label="Auto bet stop loss" inputMode="decimal" value={settings.stopLoss}
              onChange={(event) => patch({ stopLoss: event.target.value })} />
          </label>
          <label>Stop win
            <input aria-label="Auto bet stop win" inputMode="decimal" value={settings.stopWin}
              onChange={(event) => patch({ stopWin: event.target.value })} />
          </label>
        </div>
      ) : (
        <label className="auto-target">Auto cash out (optional)
          <input aria-label="Auto cash-out target" inputMode="decimal" value={settings.autoCashout}
            onChange={(event) => patch({ autoCashout: event.target.value })} />
        </label>
      )}

      <button type="button" className={`action ${label.includes('CASH') ? 'cashout' : label === 'CANCEL' ? 'cancel' : 'bet'}`}
        disabled={disabled} onClick={action}>
        <strong>{label}</strong>
        <small>{phase === 'BETTING' ? `${validStake ? stake.toFixed(2) : '—'} INR` : `${multiplier.toFixed(2)}x`}</small>
      </button>
    </section>
  );
}

function FairnessModal({ onClose, notify }: { onClose: () => void; notify: (m: string, k?: 'ok' | 'error') => void }) {
  const [seed, setSeed] = useState('');
  const [clientSeed, setClientSeed] = useState('');
  const [hash, setHash] = useState('');
  const [point, setPoint] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const verify = async () => {
    try {
      const response = await apiRequest<{ verification: Record<string, unknown> }>('/crash/fairness/verify', {
        method: 'POST',
        body: {
          serverSeed: seed, clientSeed,
          ...(hash ? { seedHash: hash } : {}),
          ...(point ? { crashPoint: Number(point) } : {}),
        },
      });
      setResult(response.verification);
    } catch (error) {
      notify(errorMessage(error), 'error');
    }
  };
  return (
    <div className="aviator-modal-backdrop" role="presentation" onClick={onClose}>
      <div className="aviator-modal" role="dialog" aria-modal="true" aria-label="Provably fair" onClick={(e) => e.stopPropagation()}>
        <header><h2>Provably fair</h2><button type="button" aria-label="Close" onClick={onClose}>×</button></header>
        <p>Hash the revealed server seed and recompute the crash point. The published hash is fixed before betting opens.</p>
        <label>Server seed<input value={seed} onChange={(e) => setSeed(e.target.value)} /></label>
        <label>Client seed<input value={clientSeed} onChange={(e) => setClientSeed(e.target.value)} /></label>
        <label>Published hash (optional)<input value={hash} onChange={(e) => setHash(e.target.value)} /></label>
        <label>Crash point (optional)<input value={point} onChange={(e) => setPoint(e.target.value)} /></label>
        <button type="button" className="verify" onClick={() => void verify()}>Verify</button>
        {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
      </div>
    </div>
  );
}

function RulesModal({ rules, onClose }: { rules: Record<string, unknown> | null; onClose: () => void }) {
  return (
    <div className="aviator-modal-backdrop" role="presentation" onClick={onClose}>
      <div className="aviator-modal" role="dialog" aria-modal="true" aria-label="Rules" onClick={(e) => e.stopPropagation()}>
        <header><h2>How to play</h2><button type="button" aria-label="Close" onClick={onClose}>×</button></header>
        {rules ? (
          <ul>
            <li>Bet during the BETTING phase. The server decides the crash point before betting closes.</li>
            <li>Cash out before the plane flies away to win stake × multiplier.</li>
            <li>Auto cash-out is evaluated by the server on every tick — your connection does not matter.</li>
            <li>Two panels place independent bets that share one round and one crash point.</li>
            <li>Min bet {String(rules.minBet)} · Max bet {String(rules.maxBet)} · House edge {String(rules.houseEdge)}</li>
          </ul>
        ) : <p>Loading rules…</p>}
      </div>
    </div>
  );
}

export default function AviatorStage() {
  const {
    token, balance, crash, messages, room, sendMessage,
    update, forgetLastGame, gameKind,
  } = useGamingContext();
  const contextRound = (crash.round as AviatorRound | null) ?? null;
  // Protocol v1 frames refine the server-clock view between REST refreshes.
  // Context/SSE remains authoritative when the socket is unavailable.
  const [socketRound, setSocketRound] = useState<AviatorRound | null>(null);
  const [serverMult, setServerMult] = useState<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const round = socketRound ?? contextRound;
  const phase = phaseOf(round, Date.now());
  const now = useTick(phase === 'BETTING' || phase === 'FLYING');
  const livePhase = phaseOf(round, now);

  const [bets, setBets] = useState<AviatorBet[]>([]);
  const [top, setTop] = useState<Record<string, TopEntry[]>>({ topWins: [], topMultipliers: [] });
  const [rules, setRules] = useState<Record<string, unknown> | null>(null);
  const [modal, setModal] = useState<'fairness' | 'rules' | null>(null);
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; kind: string }>>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');
  const [sound, setSound] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  const notify = useCallback((message: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { id, message, kind }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 4000);
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;
    const [myBets, topStats] = await Promise.allSettled([
      apiRequest<{ items: AviatorBet[] }>('/crash/bets?limit=20', { token }),
      apiRequest<Record<string, TopEntry[]>>('/crash/stats/top?period=day', { token }),
    ]);
    if (myBets.status === 'fulfilled') setBets(myBets.value.items ?? []);
    if (topStats.status === 'fulfilled') setTop(topStats.value);
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh, round?.id, round?.status]);
  useEffect(() => {
    if (!token) return;
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [refresh, token]);

  useEffect(() => {
    setSocketRound(null);
    setServerMult(null);
  }, [token]);

  useEffect(() => {
    if (!token || typeof WebSocket === 'undefined') return;
    let closed = false;
    let backoff = 0;
    let timer: number | undefined;
    const frameRound = (frame: Record<string, unknown>, state: Phase): AviatorRound => ({
      id: String(frame.roundId ?? ''),
      state,
      status: state === 'CRASHED' ? 'finished' : state === 'FLYING' ? 'running' : 'betting',
      seedHash: String(frame.seedHash ?? ''),
      createdAt: new Date().toISOString(),
      startedAt: typeof frame.flightStart === 'string' ? frame.flightStart : null,
      crashPoint: frame.crashPoint === undefined ? null : Number(frame.crashPoint),
    });
    const connect = () => {
      const socket = new WebSocket(`${config.socket}?token=${encodeURIComponent(token)}&v=1`);
      socketRef.current = socket;
      socket.onopen = () => { backoff = 0; };
      socket.onmessage = (event) => {
        let frame: Record<string, unknown>;
        try { frame = JSON.parse(String(event.data)); } catch { return; }
        if (!frame || typeof frame.t !== 'string') return;
        switch (frame.t) {
          case 'snapshot': {
            const incoming = frame.round as Record<string, unknown> | null;
            setSocketRound(incoming ? frameRound(incoming, (incoming.state as Phase) ?? 'BETTING') : null);
            setServerMult(null);
            break;
          }
          case 'round_start':
            setSocketRound(frameRound(frame, 'BETTING'));
            setServerMult(null);
            void refresh();
            break;
          case 'betting_closed':
            setSocketRound(frameRound(frame, 'FLYING'));
            setServerMult(1);
            break;
          case 'tick': {
            const value = Number(frame.mult);
            if (Number.isFinite(value)) setServerMult(value);
            break;
          }
          case 'crash':
            setSocketRound((previous) => previous
              ? { ...previous, state: 'CRASHED', status: 'finished', crashPoint: Number(frame.mult) }
              : frameRound(frame, 'CRASHED'));
            setServerMult(null);
            void refresh();
            break;
          case 'bet_ok':
          case 'cashout_ok':
            notify(frame.t === 'bet_ok' ? 'Bet placed' : `Cash-out at ${frame.mult ?? ''}×`);
            void refresh();
            break;
          case 'bet_err':
          case 'cashout_err':
          case 'error':
            if (frame.code !== 'AUTO_STOPPED') notify(String(frame.message ?? frame.code ?? 'Request failed'), 'error');
            break;
          default:
            break;
        }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (closed) return;
        timer = window.setTimeout(connect, Math.min(500 * 2 ** backoff++, 8000));
      };
    };
    connect();
    return () => {
      closed = true;
      if (timer) window.clearTimeout(timer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [token, refresh, notify]);

  useEffect(() => {
    if (!token || modal !== 'rules') return;
    void apiRequest<{ rules: Record<string, unknown> }>('/crash/rules', { token })
      .then((response) => setRules(response.rules))
      .catch(() => undefined);
  }, [token, modal]);

  const betFor = useCallback((panel: number) =>
    bets.find((bet) => bet.round_id === round?.id && bet.panel === panel
      && ['pending', 'active', 'cashing_out'].includes(bet.status)) ?? null,
  [bets, round?.id]);

  const elapsed = round?.startedAt ? Math.max(0, now - Date.parse(round.startedAt)) : 0;
  const doubling = Number(round?.doublingSeconds) || 3;
  const cap = Number(round?.crashPoint) && livePhase === 'CRASHED'
    ? Number(round?.crashPoint) : Number(round?.maxMultiplier) || 100;
  const interpolated = Number.isFinite(elapsed) ? multiplierFor(elapsed, doubling, cap) : 1;
  const multiplier = serverMult !== null && livePhase === 'FLYING'
    ? Math.min(serverMult, cap) : interpolated;

  const recentHistory = useMemo(() =>
    crash.history.map((item) => Number(item.crashPoint ?? 0)).filter((n) => Number.isFinite(n)).slice(0, 12),
  [crash.history]);

  const stopAuto = async (panel: number) => {
    if (!token) return;
    try {
      await apiRequest(`/crash/auto/${panel}/stop`, { method: 'POST', token });
      notify(`Panel ${panel}: auto bet stopped`);
      void refresh();
    } catch (error) { notify(errorMessage(error), 'error'); }
  };

  return (
    <div className="aviator-stage">
      <header className="aviator-header">
        <div className="aviator-brand"><span>GP</span><strong>AVIATOR</strong></div>
        <div className="aviator-balance">
          <small>BALANCE</small>
          <strong>{Number(balance || 0).toFixed(2)}</strong>
        </div>
        <nav>
          <label className="game-switch">
            <span className="sr-only">Switch game</span>
            <select value={gameKind} onChange={(event) => {
              const next = event.target.value as GameKind;
              forgetLastGame();
              update({ gameKind: next, gameId: '', session: null, players: [] });
            }}>
              <option value="crash">Aviator Crash</option>
              <option value="codenames">Codenames</option>
              <option value="gin-rummy">Gin Rummy</option>
              <option value="pictionary">Pictionary</option>
            </select>
          </label>
          <button type="button" onClick={() => setModal('fairness')}>Provably fair</button>
          <button type="button" onClick={() => setModal('rules')}>Rules</button>
          <button type="button" aria-label="Toggle sound" aria-pressed={sound} onClick={() => setSound((v) => !v)}>
            {sound ? '♪ On' : '♪ Off'}
          </button>
        </nav>
      </header>

      <div className="history-strip" aria-label="Recent crashes">
        {recentHistory.length === 0 ? <span className="empty">No completed rounds yet</span>
          : recentHistory.map((point, index) => (
            <button key={`${point}-${index}`} type="button" className={multClass(point)}
              onClick={() => setModal('fairness')} title="Open fairness verifier">
              {point.toFixed(2)}x
            </button>
          ))}
      </div>

      <FlightCanvas round={round} phase={livePhase} multiplier={multiplier} reduced={reduced} />

      <div className="aviator-panels">
        {([1, 2] as const).map((index) => (
          <BetPanel key={index} index={index} round={round} phase={livePhase} multiplier={multiplier}
            bet={betFor(index)} token={token} onRefresh={() => void refresh()} notify={notify} />
        ))}
      </div>

      <div className="aviator-lower">
        <section className="aviator-card">
          <header><h3>Live activity</h3><span>{bets.length} bets</span></header>
          <div className="activity-list">
            {bets.slice(0, 6).map((bet) => (
              <div key={bet.id}>
                <span className="masked">p***{bet.id.slice(-2)}</span>
                <span>{Number(bet.amount).toFixed(2)}</span>
                <span className={bet.status === 'cashed_out' ? 'win' : ''}>
                  {bet.cashout_at ? `${Number(bet.cashout_at).toFixed(2)}x` : bet.status.replace('_', ' ')}
                </span>
              </div>
            ))}
            {bets.length === 0 && <em>No bets this round</em>}
          </div>
          <div className="auto-controls">
            <button type="button" onClick={() => void stopAuto(1)}>Stop auto 1</button>
            <button type="button" onClick={() => void stopAuto(2)}>Stop auto 2</button>
          </div>
        </section>

        <section className="aviator-card">
          <header><h3>Top wins today</h3><span>day</span></header>
          <div className="activity-list">
            {(top.topWins ?? []).slice(0, 6).map((entry, index) => (
              <div key={index}>
                <span className="masked">{String(entry.user ?? '')}</span>
                <span>{Number(entry.payout ?? 0).toFixed(2)}</span>
                <span className="win">{String(entry.roundId ?? '').slice(0, 6)}</span>
              </div>
            ))}
            {(top.topWins ?? []).length === 0 && <em>No settled wins yet</em>}
          </div>
        </section>

        <section className={`aviator-card chat-card ${chatOpen ? 'open' : ''}`}>
          <header>
            <h3>Chat</h3>
            <button type="button" aria-label="Toggle chat" onClick={() => setChatOpen((v) => !v)}>
              {chatOpen ? 'Hide' : 'Show'}
            </button>
          </header>
          {chatOpen && (
            <>
              <div className="chat-log">
                {messages.slice(-8).map((message, index) => (
                  <p key={`${message.id}-${index}`}><strong>{String(message.username ?? message.user_id ?? 'player')}:</strong> {message.content}</p>
                ))}
                {messages.length === 0 && <em>No messages yet</em>}
              </div>
              <form onSubmit={(event) => {
                event.preventDefault();
                if (!chatText.trim()) return;
                void sendMessage(room, chatText.trim()).then(() => setChatText('')).catch(() => undefined);
              }}>
                <input aria-label="Chat message" maxLength={200} value={chatText}
                  onChange={(event) => setChatText(event.target.value)} placeholder="Say something" />
                <button type="submit">Send</button>
              </form>
            </>
          )}
        </section>
      </div>

      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => <div key={toast.id} className={toast.kind}>{toast.message}</div>)}
      </div>

      {modal === 'fairness' && <FairnessModal onClose={() => setModal(null)} notify={notify} />}
      {modal === 'rules' && <RulesModal rules={rules} onClose={() => setModal(null)} />}
    </div>
  );
}

