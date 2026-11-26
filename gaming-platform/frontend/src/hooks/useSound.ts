import { useCallback, useEffect, useRef, useState } from 'react';

export type SoundCue = 'bet' | 'cashout' | 'crash' | 'roundStart';

const STORAGE_KEY = 'gp.aviator.sound';

type Cue = { from: number; to: number; duration: number; type: OscillatorType; volume: number };

const CUES: Record<SoundCue, Cue> = {
  bet: { from: 440, to: 660, duration: 0.12, type: 'triangle', volume: 0.06 },
  cashout: { from: 660, to: 990, duration: 0.18, type: 'sine', volume: 0.08 },
  crash: { from: 240, to: 80, duration: 0.26, type: 'sawtooth', volume: 0.07 },
  roundStart: { from: 330, to: 440, duration: 0.14, type: 'sine', volume: 0.05 },
};

/** Short Web Audio cues. Audio starts disabled and is only created after a
 * user gesture, in line with browser autoplay policies. The preference is
 * stored locally; no account or server state is involved. */
export function useSound() {
  const [enabled, setEnabled] = useState(false);
  const contextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    try {
      setEnabled(window.localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      setEnabled(false);
    }
  }, []);

  useEffect(() => () => {
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }, []);

  const toggle = useCallback(() => {
    const next = !enabled;
    setEnabled(next);
    try { window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0'); } catch { /* storage blocked */ }
    // Create/resume the context inside the user gesture that enabled sound.
    // Without this, a later frame-driven cue can be blocked by autoplay rules.
    if (next) {
      try {
        const Constructor = window.AudioContext
          ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Constructor) {
          const context = contextRef.current ?? new Constructor();
          contextRef.current = context;
          if (context.state === 'suspended') void context.resume().catch(() => undefined);
        }
      } catch {
        // Audio is decorative; never let it interrupt the UI.
      }
    }
  }, [enabled]);

  const play = useCallback((cue: SoundCue) => {
    if (!enabled) return;
    try {
      const Constructor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Constructor) return;
      const context = contextRef.current ?? new Constructor();
      contextRef.current = context;
      if (context.state === 'suspended') void context.resume().catch(() => undefined);
      const config = CUES[cue];
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = config.type;
      oscillator.frequency.setValueAtTime(config.from, now);
      oscillator.frequency.exponentialRampToValueAtTime(config.to, now + config.duration);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(config.volume, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + config.duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + config.duration + 0.02);
    } catch {
      // Audio is decorative; never let it interrupt a wager.
    }
  }, [enabled]);

  return { enabled, toggle, play };
}
