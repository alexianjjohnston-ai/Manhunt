import { usePrefs } from './prefs';

/**
 * Sound + haptic feedback. Sounds are synthesised with WebAudio (no assets).
 * The AudioContext is unlocked on the first user gesture (iOS requirement).
 */
let ctx: AudioContext | null = null;

export function unlockAudio() {
  if (ctx) return;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    void ctx.resume();
  } catch {
    ctx = null;
  }
}

if (typeof window !== 'undefined') {
  const once = () => {
    unlockAudio();
    window.removeEventListener('pointerdown', once);
  };
  window.addEventListener('pointerdown', once);
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.18, slideTo?: number) {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export type Cue = 'ping' | 'incoming' | 'capture' | 'alert' | 'tap' | 'success' | 'start';

const patterns: Record<Cue, number | number[]> = {
  ping: [30, 60, 30],
  incoming: 20,
  capture: [80, 50, 120],
  alert: [200, 100, 200, 100, 200],
  tap: 8,
  success: [20, 40, 40],
  start: [40, 60, 120],
};

export function cue(kind: Cue, opts: { silent?: boolean } = {}) {
  const p = usePrefs.getState();
  if (p.haptics && 'vibrate' in navigator) {
    try {
      navigator.vibrate(patterns[kind]);
    } catch {
      /* ignore */
    }
  }
  if (!p.sound || opts.silent || !ctx) return;
  switch (kind) {
    case 'ping': // sonar
      tone(1240, 0, 0.9, 'sine', 0.22, 880);
      tone(1240, 0.18, 0.7, 'sine', 0.08, 900);
      break;
    case 'incoming':
      tone(660, 0, 0.12, 'triangle', 0.12);
      tone(880, 0.14, 0.12, 'triangle', 0.12);
      break;
    case 'capture':
      tone(220, 0, 0.25, 'sawtooth', 0.08, 110);
      tone(330, 0.2, 0.35, 'square', 0.05, 165);
      break;
    case 'alert':
      for (let i = 0; i < 3; i++) tone(960, i * 0.3, 0.18, 'square', 0.08);
      break;
    case 'success':
      tone(523, 0, 0.12, 'triangle', 0.12);
      tone(784, 0.1, 0.22, 'triangle', 0.12);
      break;
    case 'start':
      tone(392, 0, 0.12, 'triangle', 0.12);
      tone(523, 0.12, 0.12, 'triangle', 0.12);
      tone(784, 0.24, 0.3, 'triangle', 0.14);
      break;
    case 'tap':
      break;
  }
}
