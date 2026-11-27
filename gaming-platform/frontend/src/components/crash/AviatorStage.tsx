import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ApiError, apiRequest, errorMessage } from '../../api';
import { config } from '../../config';
import { useGamingContext } from '../../context';
import { useSound, type SoundCue } from '../../hooks/useSound';
import {
  formatAmount, formatDate, isLocale, localeDirection, LOCALES, translate, type Locale,
} from '../../i18n/aviator';
import type { GameKind } from '../../types';
import './aviator.scss';

type Phase = 'WAITING' | 'BETTING' | 'FLYING' | 'CRASHED' | 'SETTLING';
type PanelTab = 'bet' | 'auto';
type Translator = (key: string, vars?: Record<string, string | number>) => string;
type SocketStatus = 'connecting' | 'live' | 'reconnecting';

/** Live chat frames arrive on the game socket; REST only supplies history. */
interface SocketChatMessage {
  id: string;
  user: string;
  text: string;
  time: number;
}

/** Messages exchanged with an operator shell that embeds the game in an iframe.
 * Every envelope carries `gp: 1` and is accepted only from an allowed parent. */
interface BridgeEnvelope {
  gp: 1;
  type: string;
  payload?: Record<string, unknown>;
}
interface OperatorLimits { minBet: number; maxBet: number; maxWin?: number }
interface OperatorTheme { primaryColor?: string; logo?: string; language?: Locale }

/** Keep keyboard focus inside an open dialog and restore it to the trigger. */
function useModalFocus(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(ref.current?.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ) ?? []).filter((element) => !element.hasAttribute('disabled'));
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);
  return ref;
}

interface AviatorRound {
  id: string;
  status: string;
  state?: Phase;
  seedHash: string;
  createdAt: string | number;
  startedAt: string | number | null;
  bettingEndsAt?: string | number | null;
  crashPoint?: number | null;
  doublingSeconds?: number;
  maxMultiplier?: number;
  houseEdge?: number;
}

interface FeedRow {
  type: 'bet' | 'cashout';
  betId: string | null;
  user: string;
  stake: string | null;
  mult: string | null;
  payout: string | null;
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

/** Protocol v1 sends epoch milliseconds; legacy REST/SSE frames send ISO
 * strings. Both are accepted so the stage stays usable during a rolling
 * deploy where different services use different encodings. */
const timeMs = (value: string | number | null | undefined): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (!value) return NaN;
  return Date.parse(value);
};

const phaseOf = (round: AviatorRound | null, now: number): Phase => {
  if (!round) return 'WAITING';
  if (round.state && ['WAITING', 'BETTING', 'FLYING', 'CRASHED', 'SETTLING'].includes(round.state)) {
    return round.state;
  }
  if (round.status === 'finished' || round.status === 'cancelled') return 'CRASHED';
  if (round.status === 'running') {
    const started = timeMs(round.startedAt);
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
    // The curve is animated with requestAnimationFrame, throttled to ~30fps
    // so React never redraws the whole stage on every display refresh.
    let frame = 0;
    let last = 0;
    const step = (timestamp: number) => {
      if (timestamp - last >= 32) {
        last = timestamp;
        setNow(Date.now());
      }
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [active]);
  return now;
}

function FlightCanvas({ round, phase, multiplier, reduced, status, t, now }: {
  round: AviatorRound | null; phase: Phase; multiplier: number; reduced: boolean;
  status: SocketStatus; t: Translator; now: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bettingRemaining = round?.bettingEndsAt ? Math.max(0, timeMs(round.bettingEndsAt) - now) : 0;
  const bettingTotal = round?.bettingEndsAt
    ? Math.max(1, timeMs(round.bettingEndsAt) - timeMs(round.createdAt)) : 1;

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

    const doublingForGrid = Number(round?.doublingSeconds) || 3;
    const revealedForGrid = Number(round?.crashPoint);
    const capForGrid = Number.isFinite(revealedForGrid) && revealedForGrid > 0
      ? revealedForGrid : Number(round?.maxMultiplier) || 100;
    const maxLog = Math.max(1, Math.log2(capForGrid));
    context.strokeStyle = 'rgba(139,148,167,0.12)';
    context.fillStyle = 'rgba(139,148,167,0.65)';
    context.font = '10px ui-monospace, monospace';
    const levels = [1, 2, 5, 10, 25, 50, 100]
      .filter((level) => level <= capForGrid);
    if (!levels.some((level) => Math.abs(level - capForGrid) < 0.01)) levels.push(capForGrid);
    levels.forEach((level) => {
      const y = height - 12 - Math.log2(level) * (height - 30) / maxLog;
      if (y < 8) return;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
      context.fillText(`${level.toFixed(level < 10 ? 0 : 1)}x`, 4, Math.max(10, y - 3));
    });

    const elapsed = round?.startedAt
      ? Math.max(0, now - timeMs(round.startedAt))
      : 0;
    const doubling = Number(round?.doublingSeconds) || 3;
    const revealed = Number(round?.crashPoint);
    const cap = Number.isFinite(revealed) && revealed > 0
      ? revealed : Number(round?.maxMultiplier) || 100;
    const span = Math.max(4000, elapsed * 1.05);
    const samples = 80;
    const points: Array<[number, number]> = [];
    for (let i = 0; i <= samples; i++) {
      const t = (i / samples) * span;
      const value = multiplierFor(t, doubling, cap);
      points.push([
        (i / samples) * width,
        height - 12 - Math.min(maxLog, Math.log2(value)) * (height - 30) / maxLog,
      ]);
    }

    // Time axis: each tick is one doubling period, so the grid remains
    // meaningful when a round lasts longer than the initial viewport.
    context.fillStyle = 'rgba(139,148,167,0.45)';
    for (let seconds = doublingForGrid; seconds * 1000 <= span; seconds += doublingForGrid) {
      const x = (seconds * 1000 / span) * width;
      if (x <= 4 || x >= width - 4) continue;
      context.beginPath();
      context.moveTo(x, height - 12);
      context.lineTo(x, height - 6);
      context.stroke();
      context.fillText(`${seconds.toFixed(0)}s`, x + 3, height - 16);
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
    context.strokeStyle = phase === 'CRASHED' ? '#e0334a'
      : multiplier >= 10 ? '#ff5fb0' : multiplier >= 2 ? '#b58cff' : '#4aa3ff';
    context.lineWidth = 2.5;
    context.stroke();

    // Waiting/betting visuals: a pulsing ring on the pad and a plane waiting
    // on the runway make the phase readable before take-off.
    if (phase === 'WAITING' || phase === 'BETTING') {
      context.beginPath();
      context.arc(width / 2, height / 2, 18, 0, Math.PI * 2);
      context.strokeStyle = 'rgba(74,163,255,0.5)';
      context.lineWidth = 2;
      context.stroke();
      context.save();
      context.translate(30, height - 34);
      context.fillStyle = '#e8ecf3';
      context.beginPath();
      context.moveTo(18, 0);
      context.lineTo(-12, -7);
      context.lineTo(-8, 0);
      context.lineTo(-12, 7);
      context.closePath();
      context.fill();
      context.restore();
    }

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
  }, [round, phase, multiplier, reduced, now]);

  return (
    <div className="aviator-canvas-wrap">
      <canvas ref={canvasRef} className="aviator-canvas" aria-label="Flight curve" role="img" />
      <div className={`aviator-hero ${multClass(multiplier)} ${phase.toLowerCase()}`}>
        <strong>{multiplier.toFixed(2)}x</strong>
        <small>
          {phase === 'BETTING' ? t('phaseBetting')
            : phase === 'FLYING' ? t('phaseFlying')
              : phase === 'CRASHED' ? t('phaseCrashed', { point: Number(round?.crashPoint ?? 1).toFixed(2) })
                : phase === 'SETTLING' ? t('phaseSettling') : t('phaseWaiting')}
        </small>
      </div>
      {status !== 'live' && <div className="canvas-status" role="status">
        {t(status === 'connecting' ? 'socketConnecting' : 'socketReconnecting')}
      </div>}
      {phase === 'BETTING' && round?.bettingEndsAt && (
        <div className={`countdown ${bettingRemaining < 3000 ? 'urgent' : ''}`}>
          <span>{Math.ceil(bettingRemaining / 1000)}s</span>
          <div className="countdown-bar">
            <i style={{ width: `${Math.max(0, Math.min(100, bettingRemaining / bettingTotal * 100))}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

function BetPanel({ index, round, phase, multiplier, bet, token, onRefresh, notify,
  t, money, onSound, limits, queued, onQueue, onRegisterPlace, connected, availableBalance }: {
  index: 1 | 2;
  round: AviatorRound | null;
  phase: Phase;
  multiplier: number;
  bet: AviatorBet | null;
  token: string | null;
  onRefresh: () => void;
  notify: (message: string, kind?: 'ok' | 'error') => void;
  t: Translator;
  money: (value: number | string) => string;
  onSound: (cue: SoundCue) => void;
  limits: OperatorLimits;
  queued: boolean;
  onQueue: (panel: 1 | 2, next: boolean) => void;
  onRegisterPlace: (panel: 1 | 2, place: (() => Promise<void>) | null) => void;
  connected: boolean;
  availableBalance: number;
}) {
  const [settings, setSettings] = useState<PanelSettings>(DEFAULT_PANEL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const patch = (next: Partial<PanelSettings>) => {
    setError('');
    setSettings((prev) => ({ ...prev, ...next }));
  };
  const stake = Number(settings.stake);
  const validStake = Number.isFinite(stake) && stake >= limits.minBet
    && stake <= limits.maxBet && stake <= availableBalance;
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
      onSound('bet');
      notify(t('notifyBetPlaced', { panel: index }));
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
        notify(t('notifyAutoStarted', { panel: index }));
      }
      setError('');
      onRefresh();
    } catch (err) {
      setError(errorMessage(err));
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const placeRef = useRef(placeBet);
  placeRef.current = placeBet;
  useEffect(() => {
    onRegisterPlace(index, () => placeRef.current());
    return () => onRegisterPlace(index, null);
  }, [index, onRegisterPlace]);

  const cashOut = useCallback(async () => {
    if (!round || !token || !bet || busy) return;
    setBusy(true);
    try {
      const result = await apiRequest<{ payout?: number; multiplier?: number }>(
        `/crash/rounds/${round.id}/cashout`,
        {
          method: 'POST', token,
          body: { panel: index, betId: bet.id, requestId: `cashout-${bet.id}` },
        },
      );
      onSound('cashout');
      notify(t('notifyCashedOut', { panel: index, amount: money(result?.payout ?? liveWin) }));
      setError('');
      onRefresh();
    } catch (err) {
      setError(errorMessage(err));
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }, [round, token, bet, busy, index, onSound, notify, t, money, liveWin, onRefresh]);

  const cancel = async () => {
    if (!round || !token || !bet || busy) return;
    setBusy(true);
    try {
      await apiRequest(`/crash/rounds/${round.id}/bets/${bet.id}/cancel`, {
        method: 'POST', token, body: { requestId: `cancel-${bet.id}` },
      });
      notify(t('notifyCancelled', { panel: index }));
      setError('');
      onRefresh();
    } catch (err) {
      setError(errorMessage(err));
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const live = bet && phase === 'FLYING';
  // Outside the betting window the button queues the current stake for the
  // next round; it is a local intent, never a wager or wallet call.
  const label = phase === 'BETTING'
    ? (bet ? t('actionCancel') : t('actionBet'))
    : queued ? t('actionQueued')
      : live ? t('actionCashout', { amount: money(liveWin) })
        : phase === 'CRASHED' || phase === 'SETTLING' ? t('actionWait') : t('actionBetNext');
  const action = phase === 'BETTING' ? (bet ? cancel : placeBet)
    : queued ? () => onQueue(index, false)
      : live ? cashOut : () => onQueue(index, true);
  // Cancel/cash-out use the persisted bet, so editing the stake must not
  // disable them. Crashed/settling rounds cannot accept a queued intent.
  const disabled = busy || !token || !connected || (queued ? false
    : phase === 'BETTING' ? !bet && !validStake
      : live ? false
        : phase === 'CRASHED' || phase === 'SETTLING' || !validStake);

  // Keyboard cash-out: `C` while a panel has a live bet. Panel 1 owns the
  // shortcut so two open bets never race on one key press.
  useEffect(() => {
    if (index !== 1 || !live || disabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'c' || event.repeat) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      void cashOut();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [index, live, disabled, cashOut]);

  return (
    <section className="aviator-panel" aria-label={t('panelAria', { panel: index })}>
      <div className="panel-tabs" role="tablist">
        {(['bet', 'auto'] as PanelTab[]).map((tab) => (
          <button key={tab} type="button" role="tab" aria-selected={settings.tab === tab}
            className={settings.tab === tab ? 'active' : ''}
            onClick={() => patch({ tab })}>
            {t(tab === 'bet' ? 'tabBet' : 'tabAuto')}
          </button>
        ))}
        {bet && <span className="panel-state">{bet.status.replace('_', ' ')}</span>}
      </div>

      <div className="stake-row">
        <button type="button" aria-label={t('stakeDecrease')}
          onClick={() => patch({ stake: String(Math.max(limits.minBet, stake - 10)) })}>−</button>
        <input aria-label={t('panelStake', { panel: index })} inputMode="decimal" value={settings.stake}
          onChange={(event) => patch({ stake: event.target.value })} />
        <button type="button" aria-label={t('stakeIncrease')}
          onClick={() => patch({ stake: String(Math.min(limits.maxBet, stake + 10)) })}>+</button>
      </div>
      <div className="quick-amounts">
        {[10, 50, 100, 500].map((amount) => {
          const clamped = Math.min(limits.maxBet, Math.max(limits.minBet, amount));
          return <button key={amount} type="button" onClick={() => patch({ stake: String(clamped) })}>{clamped}</button>;
        })}
      </div>

      {settings.tab === 'auto' ? (
        <div className="auto-settings">
          <label>{t('autoCashout')}
            <input aria-label={t('autoTargetAria')} inputMode="decimal" value={settings.autoCashout}
              onChange={(event) => patch({ autoCashout: event.target.value })} />
          </label>
          <label>{t('rounds')}
            <input aria-label={t('autoRoundsAria')} inputMode="numeric" value={settings.rounds}
              onChange={(event) => patch({ rounds: event.target.value })} />
          </label>
          <label>{t('stopLoss')}
            <input aria-label={t('stopLossAria')} inputMode="decimal" value={settings.stopLoss}
              onChange={(event) => patch({ stopLoss: event.target.value })} />
          </label>
          <label>{t('stopWin')}
            <input aria-label={t('stopWinAria')} inputMode="decimal" value={settings.stopWin}
              onChange={(event) => patch({ stopWin: event.target.value })} />
          </label>
        </div>
      ) : (
        <label className="auto-target">{t('autoCashoutOptional')}
          <input aria-label={t('autoTargetAria')} inputMode="decimal" value={settings.autoCashout}
            onChange={(event) => patch({ autoCashout: event.target.value })} />
        </label>
      )}

      <button type="button" className={`action ${live ? 'cashout' : bet ? 'cancel' : queued ? 'queued' : 'bet'}`}
        disabled={disabled} onClick={action}>
        <strong>{label}</strong>
        <small>{queued ? '—'
          : phase === 'BETTING' ? (validStake ? money(stake) : '—') : `${multiplier.toFixed(2)}x`}</small>
      </button>
      {error && <p className="panel-error" role="alert">{error}</p>}
    </section>
  );
}

function FairnessModal({ onClose, notify, t, token, roundId, houseEdge }: {
  onClose: () => void; notify: (m: string, k?: 'ok' | 'error') => void; t: Translator;
  token: string | null; roundId: string; houseEdge: number;
}) {
  const modalRef = useModalFocus(onClose);
  const [seed, setSeed] = useState('');
  const [clientSeed, setClientSeed] = useState('');
  const [hash, setHash] = useState('');
  const [point, setPoint] = useState('');
  const [round, setRound] = useState(roundId);
  const [edge, setEdge] = useState(String(houseEdge));
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  // A history chip carries a round ID: load that round's published hash and,
  // once revealed, its proof so the player can self-verify without copying
  // values by hand. Live rounds only have the pre-committed hash.
  useEffect(() => {
    if (!token || !roundId) return;
    let active = true;
    void apiRequest<{ round?: Record<string, unknown> }>(
      `/crash/rounds/${encodeURIComponent(roundId)}`, { token },
    ).then((response) => {
      if (!active || !response?.round) return;
      const row = response.round;
      const proof = row.proof as Record<string, unknown> | undefined;
      setRound(String(row.id ?? roundId));
      if (proof?.serverSeed) setSeed(String(proof.serverSeed));
      if (row.seedHash ?? proof?.seedHash) setHash(String(row.seedHash ?? proof?.seedHash));
      if (row.crashPoint ?? proof?.crashPoint) setPoint(String(row.crashPoint ?? proof?.crashPoint));
      if (row.houseEdge) setEdge(String(row.houseEdge));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [token, roundId]);
  const verify = async () => {
    try {
      const response = await apiRequest<{ verification: Record<string, unknown> }>('/crash/fairness/verify', {
        method: 'POST',
        body: {
          serverSeed: seed, clientSeed,
          ...(round ? { roundId: round } : {}),
          houseEdge: Number(edge),
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
      <div ref={modalRef} className="aviator-modal" role="dialog" aria-modal="true" aria-label={t('fairnessTitle')} onClick={(e) => e.stopPropagation()}>
        <header><h2>{t('fairnessTitle')}</h2><button type="button" aria-label={t('close')} onClick={onClose}>×</button></header>
        <p>{t('fairnessDescription')}</p>
        <label>{t('serverSeed')}<input value={seed} onChange={(e) => setSeed(e.target.value)} /></label>
        <label>{t('clientSeed')}<input value={clientSeed} onChange={(e) => setClientSeed(e.target.value)} /></label>
        <label>{t('roundId')}<input value={round} onChange={(e) => setRound(e.target.value)} /></label>
        <label>{t('houseEdge')}<input value={edge} inputMode="decimal" onChange={(e) => setEdge(e.target.value)} /></label>
        <label>{t('publishedHash')}<input value={hash} onChange={(e) => setHash(e.target.value)} /></label>
        <label>{t('crashPoint')}<input value={point} onChange={(e) => setPoint(e.target.value)} /></label>
        <button type="button" className="verify" onClick={() => void verify()}>{t('verify')}</button>
        {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
      </div>
    </div>
  );
}

function RulesModal({ rules, onClose, t }: {
  rules: Record<string, unknown> | null; onClose: () => void; t: Translator;
}) {
  const modalRef = useModalFocus(onClose);
  return (
    <div className="aviator-modal-backdrop" role="presentation" onClick={onClose}>
      <div ref={modalRef} className="aviator-modal" role="dialog" aria-modal="true" aria-label={t('rules')} onClick={(e) => e.stopPropagation()}>
        <header><h2>{t('rulesTitle')}</h2><button type="button" aria-label={t('close')} onClick={onClose}>×</button></header>
        {rules ? (
          <ul>
            <li>{t('rule1')}</li>
            <li>{t('rule2')}</li>
            <li>{t('rule3')}</li>
            <li>{t('rule4')}</li>
            <li>{t('rule5', { min: String(rules.minBet), max: String(rules.maxBet), edge: String(rules.houseEdge) })}</li>
          </ul>
        ) : <p>{t('rulesLoading')}</p>}
      </div>
    </div>
  );
}

export default function AviatorStage() {
  const {
    token, balance, crash, messages, room,
    update, forgetLastGame, loadDashboard, gameKind, operatorLanguage,
  } = useGamingContext();
  const contextRound = (crash.round as AviatorRound | null) ?? null;
  // Protocol v1 frames refine the server-clock view between REST refreshes.
  // Context/SSE remains authoritative when the socket is unavailable.
  const [socketRound, setSocketRound] = useState<AviatorRound | null>(null);
  const [serverMult, setServerMult] = useState<number | null>(null);
  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('connecting');
  const [socketMessages, setSocketMessages] = useState<SocketChatMessage[]>([]);
  const [socketHistory, setSocketHistory] = useState<string[]>([]);
  const [socketBalance, setSocketBalance] = useState<{ amount: string; currency: string } | null>(null);
  const [queued, setQueued] = useState<Record<1 | 2, boolean>>({ 1: false, 2: false });
  const socketRef = useRef<WebSocket | null>(null);
  const clockOffsetRef = useRef(0);
  const placeRefs = useRef<Record<number, (() => Promise<void>) | null>>({ 1: null, 2: null });
  const queuedRoundsRef = useRef(new Set<string>());
  const registerPlace = useCallback((panel: 1 | 2, place: (() => Promise<void>) | null) => {
    placeRefs.current[panel] = place;
  }, []);
  const serverNow = useCallback(() => Date.now() + clockOffsetRef.current, []);
  const round = socketRound ?? contextRound;
  const clock = useTick(['BETTING', 'FLYING'].includes(phaseOf(round, serverNow())));
  const timing = clock + clockOffsetRef.current;
  const phase = phaseOf(round, timing);
  const now = timing;
  const livePhase = phaseOf(round, now);

  const [bets, setBets] = useState<AviatorBet[]>([]);
  const [top, setTop] = useState<Record<string, TopEntry[]>>({ topWins: [], topMultipliers: [] });
  const [activityTab, setActivityTab] = useState<'mine' | 'all' | 'top'>('all');
  const [period, setPeriod] = useState<'day' | 'month' | 'year'>('day');
  const [rules, setRules] = useState<Record<string, unknown> | null>(null);
  const [modal, setModal] = useState<'fairness' | 'rules' | null>(null);
  const [modalRoundId, setModalRoundId] = useState('');
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; kind: string }>>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');
  const [chatError, setChatError] = useState('');
  const chatLogRef = useRef<HTMLDivElement>(null);
  const chatSentAtRef = useRef(0);
  const [serverSound, setServerSound] = useState<boolean | undefined>(undefined);
  const { enabled: sound, toggle: toggleSound, play: playSound } = useSound(serverSound);
  const [reduced, setReduced] = useState(false);
  const [animations, setAnimations] = useState(true);
  const [locale, setLocale] = useState<Locale>('en');
  const [currency, setCurrency] = useState('INR');
  const [limits, setLimits] = useState<OperatorLimits>({ minBet: 1, maxBet: 10000 });
  const [announcement, setAnnouncement] = useState('');
  const [themeColor, setThemeColor] = useState<string | null>(null);
  const [themeLogo, setThemeLogo] = useState<string | null>(null);

  const t = useCallback<Translator>((key, vars) => translate(locale, key, vars), [locale]);
  const money = useCallback((value: number | string) => formatAmount(value, locale, currency), [locale, currency]);
  const availableBalance = Number(socketBalance?.amount ?? balance ?? 0);

  // Player-facing preferences are saved server-side when signed in so they
  // follow the account; local storage keeps sound usable before sign-in.
  const saveSettings = useCallback((settings: Record<string, unknown>) => {
    if (!token) return;
    void apiRequest('/crash/settings', { method: 'PUT', token, body: settings }).catch(() => undefined);
  }, [token]);

  const changeLocale = useCallback((next: Locale) => {
    setLocale(next);
    saveSettings({ language: next });
  }, [saveSettings]);

  const toggleSoundWithSettings = useCallback(() => {
    toggleSound();
    saveSettings({ sound: !sound });
  }, [toggleSound, saveSettings, sound]);

  const toggleAnimationsWithSettings = useCallback(() => {
    const next = !animations;
    setAnimations(next);
    saveSettings({ animations: next });
  }, [animations, saveSettings]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  // Player settings own language/currency; operator limits override the stake
  // bounds the player may use. All three arrive from the authoritative REST API.
  useEffect(() => {
    if (!token) return;
    let active = true;
    void Promise.allSettled([
      apiRequest<{ settings?: { language?: string; currency?: string; animations?: boolean; sound?: boolean } }>('/crash/settings', { token }),
      apiRequest<{ rules?: { minBet?: number | string; maxBet?: number | string } }>('/crash/rules', { token }),
    ]).then(([settingsResult, rulesResult]) => {
      if (!active) return;
      if (settingsResult.status === 'fulfilled') {
        const settings = settingsResult.value.settings;
        // The launch URL's language is an explicit operator choice and wins
        // over the account's saved preference for this session.
        if (!operatorLanguage && isLocale(settings?.language)) setLocale(settings.language);
        if (settings?.currency) setCurrency(settings.currency.slice(0, 8));
        if (typeof settings?.animations === 'boolean') setAnimations(settings.animations);
        if (typeof settings?.sound === 'boolean') setServerSound(settings.sound);
      }
      if (rulesResult.status === 'fulfilled') {
        const minBet = Number(rulesResult.value.rules?.minBet);
        const maxBet = Number(rulesResult.value.rules?.maxBet);
        if (Number.isFinite(minBet) && minBet > 0) setLimits((prev) => ({ ...prev, minBet }));
        if (Number.isFinite(maxBet) && maxBet >= minBet) setLimits((prev) => ({ ...prev, maxBet }));
      }
    });
    return () => { active = false; };
  }, [token, operatorLanguage]);

  useEffect(() => {
    if (isLocale(operatorLanguage)) setLocale(operatorLanguage);
  }, [operatorLanguage]);

  // Screen-reader announcements for state changes only — never for ticks.
  useEffect(() => {
    if (livePhase === 'BETTING') setAnnouncement(t('announcementBetting'));
    else if (livePhase === 'FLYING') setAnnouncement(t('announcementFlying'));
    else if (livePhase === 'CRASHED') {
      setAnnouncement(t('announcementCrashed', { point: Number(round?.crashPoint ?? 1).toFixed(2) }));
    }
  }, [livePhase, round?.crashPoint, t]);

  const notify = useCallback((message: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { id, message, kind }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 4000);
  }, []);

  const closeModal = useCallback(() => setModal(null), []);
  const openFairness = useCallback((roundId = '') => {
    setModalRoundId(roundId);
    setModal('fairness');
  }, []);

  // Chat is public and fanned out to every player, so the gateway throttles it.
  // Mirror that limit locally and surface the server's code inline instead of
  // silently swallowing a rejected message.
  const submitChat = useCallback(async () => {
    const text = chatText.trim().slice(0, 200);
    if (!text) return;
    const sentAt = Date.now();
    if (sentAt - chatSentAtRef.current < 1000) {
      setChatError(t('chatTooFast'));
      return;
    }
    chatSentAtRef.current = sentAt;
    setChatError('');
    try {
      await apiRequest(`/chat/rooms/${encodeURIComponent(room)}/messages`, {
        method: 'POST', token, body: { content: text },
      });
      setChatText('');
    } catch (err) {
      chatSentAtRef.current = 0;
      setChatError(err instanceof ApiError && err.code === 'RATE_LIMITED'
        ? t('chatTooFast') : errorMessage(err));
    }
  }, [chatText, t, room, token]);

  const refresh = useCallback(async () => {
    if (!token) return;
    const [myBets, topStats] = await Promise.allSettled([
      apiRequest<{ items: AviatorBet[] }>('/crash/bets?limit=20', { token }),
      apiRequest<Record<string, TopEntry[]>>(`/crash/stats/top?period=${period}`, { token }),
    ]);
    if (myBets.status === 'fulfilled') setBets(myBets.value.items ?? []);
    if (topStats.status === 'fulfilled') setTop(topStats.value);
  }, [token, period]);

  useEffect(() => { void refresh(); }, [refresh, round?.id, round?.status]);
  useEffect(() => {
    if (!token) return;
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [refresh, token]);

  useEffect(() => {
    setSocketRound(null);
    setServerMult(null);
    setFeed([]);
    setSocketStatus('connecting');
    setSocketMessages([]);
    setSocketHistory([]);
    setSocketBalance(null);
    setQueued({ 1: false, 2: false });
    clockOffsetRef.current = 0;
    queuedRoundsRef.current.clear();
  }, [token]);

  useEffect(() => {
    if (!token || typeof WebSocket === 'undefined') return;
    let closed = false;
    let backoff = 0;
    let timer: number | undefined;
    const frameRound = (frame: Record<string, unknown>, state: Phase): AviatorRound => ({
      id: String(frame.roundId ?? frame.id ?? ''),
      state,
      status: state === 'CRASHED' ? 'finished' : state === 'FLYING' ? 'running' : 'betting',
      seedHash: String(frame.seedHash ?? ''),
      createdAt: serverNow(),
      startedAt: frame.flightStart === undefined || frame.flightStart === null
        ? null : frame.flightStart as string | number,
      bettingEndsAt: frame.bettingEndsAt === undefined || frame.bettingEndsAt === null
        ? null : frame.bettingEndsAt as string | number,
      doublingSeconds: Number(frame.doublingSeconds) || 3,
      maxMultiplier: Number(frame.maxMultiplier) || 100,
      crashPoint: frame.crashPoint === undefined ? null : Number(frame.crashPoint),
    });
    const connect = () => {
      const socket = new WebSocket(`${config.socket}?token=${encodeURIComponent(token)}&v=1`);
      let heartbeat: number | undefined;
      socketRef.current = socket;
      socket.onopen = () => {
        backoff = 0;
        setSocketStatus('live');
        // REST is still authoritative for top wins and full bet history; the
        // snapshot restores the round, balance, open bets and limits.
        void refresh();
        // The server closes sockets silent for 45s; keep the connection warm
        // and let pong.serverTime correct client clock drift.
        heartbeat = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN)
            socket.send(JSON.stringify({ t: 'ping', ts: Date.now() }));
        }, 15_000);
      };
      socket.onmessage = (event) => {
        let frame: Record<string, unknown>;
        try { frame = JSON.parse(String(event.data)); } catch { return; }
        if (!frame || typeof frame.t !== 'string') return;
        switch (frame.t) {
          case 'snapshot': {
            if (typeof frame.serverTime === 'number') clockOffsetRef.current = frame.serverTime - Date.now();
            const incoming = frame.round as Record<string, unknown> | null;
            setSocketRound(incoming ? frameRound(incoming, (incoming.state as Phase) ?? 'BETTING') : null);
            setServerMult(null);
            // A reconnect snapshot is authoritative. Restore every field the
            // player needs instead of waiting for the next REST poll.
            const frameBalance = frame.balance as { amount?: unknown; currency?: unknown } | null | undefined;
            if (frameBalance?.amount != null) {
              setSocketBalance({
                amount: String(frameBalance.amount),
                currency: String(frameBalance.currency ?? currency),
              });
            }
            if (Array.isArray(frame.history)) setSocketHistory(frame.history.map(String));
            const frameLimits = frame.limits as Record<string, unknown> | undefined;
            if (frameLimits) {
              const minBet = Number(frameLimits.minBet);
              const maxBet = Number(frameLimits.maxBet);
              const maxWin = Number(frameLimits.maxWin);
              setLimits((previous) => ({
                minBet: Number.isFinite(minBet) && minBet > 0 ? minBet : previous.minBet,
                maxBet: Number.isFinite(maxBet) && maxBet > 0 ? maxBet : previous.maxBet,
                maxWin: Number.isFinite(maxWin) && maxWin > 0 ? maxWin : previous.maxWin,
              }));
            }
            if (Array.isArray(frame.myBets)) {
              const restored: AviatorBet[] = frame.myBets.map((row) => {
                const item = row as Record<string, unknown>;
                return {
                  id: String(item.betId ?? ''),
                  round_id: String(incoming?.id ?? ''),
                  panel: Number(item.panel) === 2 ? 2 : 1,
                  amount: String(item.amount ?? '0'),
                  auto_cashout: item.autoCashout == null ? null : String(item.autoCashout),
                  cashout_at: null,
                  payout: null,
                  status: String(item.status ?? 'active'),
                  created_at: new Date(serverNow()).toISOString(),
                };
              }).filter((item) => item.id);
              setBets(restored);
            }
            break;
          }
          case 'round_start':
            setSocketRound(frameRound(frame, 'BETTING'));
            setServerMult(null);
            playSound('roundStart');
            void refresh();
            break;
          case 'betting_closed':
            setSocketRound(frameRound(frame, 'FLYING'));
            setServerMult(1);
            break;
          case 'tick': {
            if (typeof frame.serverTime === 'number') clockOffsetRef.current = frame.serverTime - Date.now();
            const value = Number(frame.mult);
            if (Number.isFinite(value)) setServerMult(value);
            break;
          }
          case 'crash':
            setSocketRound((previous) => previous
              ? { ...previous, state: 'CRASHED', status: 'finished', crashPoint: Number(frame.mult) }
              : frameRound(frame, 'CRASHED'));
            setServerMult(null);
            playSound('crash');
            void refresh();
            break;
          case 'round_settling':
            setSocketRound((previous) => previous ? { ...previous, state: 'SETTLING' } : previous);
            break;
          case 'round_voided':
            setSocketRound((previous) => previous
              ? { ...previous, state: 'SETTLING', crashPoint: null } : previous);
            setServerMult(null);
            break;
          case 'feed': {
            const rows = (Array.isArray(frame.list) ? frame.list : []).filter((row): row is FeedRow => {
              const item = row as FeedRow | null;
              return item?.type === 'bet' || item?.type === 'cashout';
            });
            setFeed((previous) => [...rows, ...previous].slice(0, 12));
            break;
          }
          case 'balance': {
            const amount = frame.amount === undefined ? null : String(frame.amount);
            if (amount) setSocketBalance({ amount, currency: String(frame.currency ?? currency) });
            break;
          }
          case 'chat_msg': {
            const id = String(frame.id ?? `${frame.time}-${frame.user}`);
            const text = String(frame.text ?? '');
            if (!text) break;
            setSocketMessages((previous) => previous.some((item) => item.id === id)
              ? previous
              : [...previous.slice(-49), {
                  id, user: String(frame.user ?? 'player'), text,
                  time: Number(frame.time) || Date.now(),
                }]);
            break;
          }
          case 'pong':
            if (typeof frame.serverTime === 'number') clockOffsetRef.current = frame.serverTime - Date.now();
            break;
          case 'bet_ok':
          case 'cashout_ok':
            notify(frame.t === 'bet_ok'
              ? t('socketBetPlaced')
              : t('socketCashoutAt', { mult: String(frame.mult ?? '') }));
            void refresh();
            break;
          case 'bet_err':
          case 'cashout_err':
          case 'error':
            if (frame.code !== 'AUTO_STOPPED') notify(String(frame.message ?? frame.code ?? t('requestFailed')), 'error');
            break;
          default:
            break;
        }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (heartbeat) window.clearInterval(heartbeat);
        if (closed) return;
        setSocketStatus('reconnecting');
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
  }, [token, refresh, notify, playSound, t, serverNow, currency]);

  // A queued stake is a local intent only. Fire it exactly once per panel and
  // round when BETTING opens; a failed HTTP call is reported by placeBet.
  useEffect(() => {
    if (phase !== 'BETTING' || !round?.id) return;
    ([1, 2] as const).forEach((panel) => {
      if (!queued[panel]) return;
      const key = `${round.id}:${panel}`;
      if (queuedRoundsRef.current.has(key)) return;
      queuedRoundsRef.current.add(key);
      setQueued((previous) => ({ ...previous, [panel]: false }));
      void placeRefs.current[panel]?.();
    });
  }, [phase, round?.id, queued]);

  useEffect(() => {
    if (!token || modal !== 'rules') return;
    void apiRequest<{ rules: Record<string, unknown> }>('/crash/rules', { token })
      .then((response) => setRules(response.rules))
      .catch(() => undefined);
  }, [token, modal]);

  // Operator shell bridge. Only the embedding parent, and only origins listed
  // in REACT_APP_OPERATOR_ORIGINS (plus our own origin), can drive the game.
  // No token or refresh credential is ever sent over postMessage.
  useEffect(() => {
    if (window.parent === window) return;
    const parent = window.parent;
    const allowed = new Set([window.location.origin, ...config.operatorOrigins]);
    let target: string | null = null;
    const post = (type: string, payload: Record<string, unknown> = {}) => {
      const envelope: BridgeEnvelope = { gp: 1, type, payload };
      parent.postMessage(envelope, target ?? '*');
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== parent || !allowed.has(event.origin)) return;
      const data = event.data as BridgeEnvelope | null;
      if (!data || data.gp !== 1 || typeof data.type !== 'string') return;
      // From here on every reply is addressed to the exact, verified origin.
      target = event.origin;
      const payload = data.payload ?? {};
      switch (data.type) {
        case 'balance-refresh':
          void apiRequest<{ account?: { balance?: number | string } }>('/wallet/balance', { token })
            .then((response) => post('balance', { balance: response.account?.balance ?? null, currency }))
            .catch(() => post('balance', { balance: null, currency }));
          void loadDashboard();
          void refresh();
          break;
        case 'close':
          forgetLastGame();
          update({ gameKind: 'crash', gameId: '', session: null, players: [] });
          post('closed', { reason: 'operator' });
          break;
        case 'limits': {
          const minBet = Number(payload.minBet);
          const maxBet = Number(payload.maxBet);
          if (Number.isFinite(minBet) && Number.isFinite(maxBet) && minBet > 0 && maxBet >= minBet) {
            setLimits({ minBet, maxBet });
            post('limits-applied', { minBet, maxBet });
          } else {
            post('error', { code: 'VALIDATION_FAILED' });
          }
          break;
        }
        case 'theme':
        case 'language': {
          const theme = payload as OperatorTheme;
          const color = String(theme.primaryColor ?? '');
          if (/^#[0-9a-f]{6}$/i.test(color)) setThemeColor(color);
          // Only same-origin paths and https image URLs are accepted. No SVG
          // markup, javascript: URL or arbitrary remote script can be injected.
          const logo = String(theme.logo ?? '');
          if (/^\/[a-zA-Z0-9/._-]*$/.test(logo) || /^https:\/\/\S+$/i.test(logo)) setThemeLogo(logo);
          const language = data.type === 'language' ? payload.language : theme.language;
          if (isLocale(language)) setLocale(language);
          post(data.type === 'language' ? 'language-applied' : 'theme-applied', {});
          break;
        }
        default:
          post('error', { code: 'UNKNOWN_MESSAGE' });
      }
    };
    window.addEventListener('message', onMessage);
    post('ready', { game: 'aviator', version: 1 });
    return () => window.removeEventListener('message', onMessage);
  }, [token, currency, refresh, loadDashboard, forgetLastGame, update]);

  const betFor = useCallback((panel: number) =>
    bets.find((bet) => bet.round_id === round?.id && bet.panel === panel
      && ['pending', 'active', 'cashing_out'].includes(bet.status)) ?? null,
  [bets, round?.id]);

  const elapsed = round?.startedAt ? Math.max(0, now - timeMs(round.startedAt)) : 0;
  const doubling = Number(round?.doublingSeconds) || 3;
  const revealedPoint = Number(round?.crashPoint);
  const cap = Number.isFinite(revealedPoint) && revealedPoint > 0
    ? revealedPoint : Number(round?.maxMultiplier) || 100;
  const interpolated = Number.isFinite(elapsed) ? multiplierFor(elapsed, doubling, cap) : 1;
  const multiplier = serverMult !== null && livePhase === 'FLYING'
    ? Math.min(serverMult, cap) : interpolated;
  const recentHistory = useMemo(() => {
    const source = socketHistory.length
      ? socketHistory.map((point, index) => ({ id: crash.history[index]?.id ?? '', point: Number(point) }))
      : crash.history.map((item) => ({ id: item.id, point: Number(item.crashPoint ?? 0) }));
    return source.filter((item) => Number.isFinite(item.point)).slice(0, 12);
  }, [socketHistory, crash.history]);

  const liveMessages = useMemo(() => {
    const seen = new Set(messages.map((message) => message.id));
    return socketMessages.filter((message) => !seen.has(message.id));
  }, [messages, socketMessages]);

  const chatRows = useMemo(() => [
    ...messages.slice(-8).map((message) => ({
      id: message.id,
      user: String(message.username ?? message.user_id ?? 'player'),
      text: message.content,
      time: Date.parse(message.created_at) || Date.now(),
    })),
    ...liveMessages.map((message) => ({
      id: message.id, user: message.user, text: message.text, time: message.time,
    })),
  ].slice(-8), [messages, liveMessages]);

  useEffect(() => {
    if (!chatOpen) return;
    const log = chatLogRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [chatRows, chatOpen]);

  const visibleStake = useMemo(() => {
    if (activityTab === 'mine') return bets.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    return feed.reduce((sum, row) => sum + Number(row.stake ?? 0), 0);
  }, [activityTab, bets, feed]);

  const stopAuto = async (panel: number) => {
    if (!token) return;
    try {
      await apiRequest(`/crash/auto/${panel}/stop`, { method: 'POST', token });
      notify(t('notifyAutoStopped', { panel }));
      void refresh();
    } catch (error) { notify(errorMessage(error), 'error'); }
  };

  return (
    <div className="aviator-stage" dir={localeDirection(locale)}
      style={themeColor ? ({ '--gp-primary': themeColor } as CSSProperties) : undefined}>
      <span className="sr-only" aria-live="polite">{announcement}</span>
      {socketStatus !== 'live' && (
        <div className="socket-status" role="status">
          {t(socketStatus === 'connecting' ? 'socketConnecting' : 'socketReconnecting')}
        </div>
      )}
      <header className="aviator-header">
        <div className="aviator-brand">
          {themeLogo
            ? <img className="operator-logo" src={themeLogo} alt={t('operatorLogo')} />
            : <span>GP</span>}
          <strong>AVIATOR</strong>
        </div>
        <div className="aviator-balance">
          <small>{t('balance')}</small>
          <strong>{money(socketBalance?.amount ?? balance ?? 0)}</strong>
        </div>
        <nav>
          <label className="game-switch">
            <span className="sr-only">{t('switchGame')}</span>
            <select value={gameKind} onChange={(event) => {
              const next = event.target.value as GameKind;
              forgetLastGame();
              update({ gameKind: next, gameId: '', session: null, players: [] });
            }}>
              <option value="crash">{t('gameCrash')}</option>
              <option value="codenames">{t('gameCodenames')}</option>
              <option value="gin-rummy">{t('gameGinRummy')}</option>
              <option value="pictionary">{t('gamePictionary')}</option>
            </select>
          </label>
          <label className="language-switch">
            <span className="sr-only">{t('language')}</span>
            <select value={locale} onChange={(event) => changeLocale(event.target.value as Locale)}>
              {LOCALES.map((option) => <option key={option} value={option}>{option.toUpperCase()}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => openFairness(round?.id ?? '')}>{t('provablyFair')}</button>
          <button type="button" onClick={() => setModal('rules')}>{t('rules')}</button>
          <button type="button" aria-label={t('toggleSound')} aria-pressed={sound} onClick={toggleSoundWithSettings}>
            {sound ? t('soundOn') : t('soundOff')}
          </button>
          <button type="button" aria-label={t('toggleAnimations')} aria-pressed={animations}
            onClick={toggleAnimationsWithSettings}>
            {animations ? t('animationsOn') : t('animationsOff')}
          </button>
        </nav>
      </header>

      <div className="history-strip" aria-label={t('recentCrashes')}>
        {recentHistory.length === 0 ? <span className="empty">{t('noHistory')}</span>
          : recentHistory.map(({ id, point }, index) => (
            <button key={`${id || point}-${index}`} type="button" className={multClass(point)}
              onClick={() => openFairness(id)} title={t('provablyFair')}>
              {point.toFixed(2)}x
            </button>
          ))}
      </div>

      <FlightCanvas round={round} phase={livePhase} multiplier={multiplier}
        reduced={reduced || !animations} status={socketStatus} t={t} now={now} />

      <div className="aviator-panels">
        {([1, 2] as const).map((index) => (
          <BetPanel key={index} index={index} round={round} phase={livePhase} multiplier={multiplier}
            bet={betFor(index)} token={token} onRefresh={() => void refresh()} notify={notify}
            t={t} money={money} onSound={playSound} limits={limits}
            queued={queued[index]} onQueue={(panel, next) => setQueued((previous) => ({ ...previous, [panel]: next }))}
            onRegisterPlace={registerPlace} connected={socketStatus === 'live'}
            availableBalance={availableBalance} />
        ))}
      </div>

      <div className="aviator-lower">
        <section className="aviator-card">
          <header>
            <h3>{t('liveActivity')}</h3>
            <span>{t('betsCount', { count: activityTab === 'mine' ? bets.length : feed.length })}
              {' · '}{t('totalStake', { amount: money(visibleStake) })}</span>
          </header>
          <div className="activity-tabs" role="tablist">
            {(['all', 'mine', 'top'] as const).map((tab) => (
              <button key={tab} type="button" role="tab" aria-selected={activityTab === tab}
                className={activityTab === tab ? 'active' : ''}
                onClick={() => setActivityTab(tab)}>
                {t(tab === 'all' ? 'tabAllBets' : tab === 'mine' ? 'tabMyBets' : 'tabTop')}
              </button>
            ))}
          </div>
          {activityTab === 'top' ? (
            <div className="activity-list">
              {(top.topMultipliers ?? []).slice(0, 6).map((entry, index) => (
                <div key={index}>
                  <span className="masked">{String(entry.user ?? '')}</span>
                  <span>{Number(entry.mult ?? 0).toFixed(2)}x</span>
                  <span>{money(entry.payout ?? 0)}</span>
                </div>
              ))}
              {(top.topMultipliers ?? []).length === 0 && <em>{t('noWins')}</em>}
            </div>
          ) : activityTab === 'mine' ? (
            <div className="activity-list">
              {bets.slice(0, 6).map((bet) => (
                <div key={bet.id}>
                  <span className="masked">p***{bet.id.slice(-2)}</span>
                  <span>{money(bet.amount)}</span>
                  <span className={bet.status === 'cashed_out' ? 'win' : ''}>
                    {bet.cashout_at ? `${Number(bet.cashout_at).toFixed(2)}x` : bet.status.replace('_', ' ')}
                  </span>
                </div>
              ))}
              {bets.length === 0 && <em>{t('noBets')}</em>}
            </div>
          ) : (
            <div className="activity-list" aria-label={t('liveFeed')}>
              {feed.slice(0, 6).map((row, index) => (
                <div key={`${row.betId ?? 'feed'}-${index}`}>
                  <span className="masked">{row.user}</span>
                  <span>{row.stake ? money(row.stake) : '—'}</span>
                  <span className={row.type === 'cashout' ? 'win' : ''}>
                    {row.type === 'cashout'
                      ? `${row.mult ?? '1.00'}x → ${row.payout ? money(row.payout) : '—'}`
                      : t('actionBet')}
                  </span>
                </div>
              ))}
              {feed.length === 0 && <em>{t('noBets')}</em>}
            </div>
          )}
          <div className="auto-controls">
            <button type="button" onClick={() => void stopAuto(1)}>{t('stopAuto', { panel: 1 })}</button>
            <button type="button" onClick={() => void stopAuto(2)}>{t('stopAuto', { panel: 2 })}</button>
          </div>
        </section>

        <section className="aviator-card">
          <header>
            <h3>{t('topWins')}</h3>
            <label className="period-switch">
              <span className="sr-only">{t('period')}</span>
              <select value={period} onChange={(event) => setPeriod(event.target.value as typeof period)}>
                <option value="day">{t('periodDay')}</option>
                <option value="month">{t('periodMonth')}</option>
                <option value="year">{t('periodYear')}</option>
              </select>
            </label>
          </header>
          <div className="activity-list">
            {(top.topWins ?? []).slice(0, 6).map((entry, index) => (
              <div key={index}>
                <span className="masked">{String(entry.user ?? '')}</span>
                <span>{money(entry.payout ?? 0)}</span>
                <span className="win">{String(entry.roundId ?? '').slice(0, 6)}</span>
              </div>
            ))}
            {(top.topWins ?? []).length === 0 && <em>{t('noWins')}</em>}
          </div>
        </section>

        <section className={`aviator-card chat-card ${chatOpen ? 'open' : ''}`}>
          <header>
            <h3>{t('chatTitle')}</h3>
            <button type="button" aria-label={t('toggleChat')} onClick={() => setChatOpen((v) => !v)}>
              {chatOpen ? t('chatHide') : t('chatShow')}
            </button>
          </header>
          {chatOpen && (
            <>
              <div className="chat-log" ref={chatLogRef}>
                {chatRows.map((message) => (
                  <p key={message.id}><strong>{message.user}:</strong> {message.text}
                    <time dateTime={new Date(message.time).toISOString()}>
                      {formatDate(new Date(message.time).toISOString(), locale)}
                    </time>
                  </p>
                ))}
                {chatRows.length === 0 && <em>{t('chatEmpty')}</em>}
              </div>
              <form onSubmit={(event) => {
                event.preventDefault();
                void submitChat();
              }}>
                <input aria-label={t('chatMessage')} maxLength={200} value={chatText}
                  onChange={(event) => { setChatText(event.target.value); setChatError(''); }}
                  placeholder={t('chatPlaceholder')} />
                <button type="submit" disabled={!chatText.trim()}>{t('chatSend')}</button>
              </form>
              {chatError && <p className="panel-error" role="alert">{chatError}</p>}
            </>
          )}
        </section>
      </div>

      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => <div key={toast.id} className={toast.kind}>{toast.message}</div>)}
      </div>

      {modal === 'fairness' && <FairnessModal onClose={closeModal} notify={notify} t={t}
        token={token} roundId={modalRoundId || round?.id || ''}
        houseEdge={Number(rules?.houseEdge ?? round?.houseEdge ?? 0.02)} />}
      {modal === 'rules' && <RulesModal rules={rules} onClose={closeModal} t={t} />}
    </div>
  );
}

