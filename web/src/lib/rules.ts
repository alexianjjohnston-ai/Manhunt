import { DEFAULT_SETTINGS } from '@shared/constants';
import type { GameSettings } from '@shared/types';

export const fmtInterval = (sec: number) => (sec % 60 === 0 ? `${sec / 60} min` : sec > 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec}s`);

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  settings: Partial<GameSettings>;
}

/** One-tap setups. Everything stays editable under "Advanced rules". */
export const PRESETS: Preset[] = [
  {
    id: 'quick',
    name: 'Quick chase',
    blurb: '30 min · ping every 3 min · 3 min head start',
    settings: { durationMin: 30, pingIntervalSec: 180, headStartMin: 3, finalPhaseMin: 10, mode: 'classic', cloaksPerRunner: 1, sweepsPerGame: 1 },
  },
  {
    id: 'classic',
    name: 'Classic',
    blurb: '60 min · ping every 5 min · 5 min head start',
    settings: { durationMin: 60, pingIntervalSec: 300, headStartMin: 5, finalPhaseMin: 15, mode: 'classic', cloaksPerRunner: 1, sweepsPerGame: 1 },
  },
  {
    id: 'infection',
    name: 'Infection',
    blurb: '45 min · caught runners join the hunters',
    settings: { durationMin: 45, pingIntervalSec: 240, headStartMin: 3, finalPhaseMin: 10, mode: 'infection', cloaksPerRunner: 1, sweepsPerGame: 1 },
  },
  {
    id: 'long',
    name: 'Long game',
    blurb: '2 hours · ping every 10 min · more tricks',
    settings: { durationMin: 120, pingIntervalSec: 600, headStartMin: 10, finalPhaseMin: 20, mode: 'classic', cloaksPerRunner: 2, sweepsPerGame: 2 },
  },
];

export function presetFor(s: GameSettings): string | null {
  const keys = ['durationMin', 'pingIntervalSec', 'headStartMin', 'finalPhaseMin', 'mode', 'cloaksPerRunner', 'sweepsPerGame'] as const;
  return PRESETS.find((p) => keys.every((k) => p.settings[k] === s[k]))?.id ?? null;
}

/** Plain-language rules for this game, shown at setup, in the lobby and in-game. */
export function rulesSummary(raw: Partial<GameSettings>): string[] {
  const s = { ...DEFAULT_SETTINGS, ...raw };
  const out: string[] = [];
  out.push(
    s.headStartMin > 0
      ? `Runners get a ${s.headStartMin}-minute head start, then hunters are released. The game lasts ${s.durationMin} minutes.`
      : `Hunters chase from the start. The game lasts ${s.durationMin} minutes.`,
  );
  const fast = Math.max(60, Math.round(s.pingIntervalSec / 2));
  out.push(
    `Every ${fmtInterval(s.pingIntervalSec)}, hunters see where every runner is${
      s.finalPhaseMin ? `, every ${fmtInterval(Math.min(s.pingIntervalSec, fast))} in the final ${s.finalPhaseMin} minutes` : ''
    }.`,
  );
  if (s.cloaksPerRunner) out.push(`Each runner has ${s.cloaksPerRunner} cloak${s.cloaksPerRunner > 1 ? 's' : ''} to hide from one ping.`);
  if (s.sweepsPerGame) out.push(`Hunters share ${s.sweepsPerGame} radar sweep${s.sweepsPerGame > 1 ? 's' : ''}: an extra ping on demand.`);
  out.push(
    s.mode === 'infection'
      ? 'Caught runners switch sides and hunt the rest. Hunters win when nobody is left running.'
      : 'Caught runners are out. Hunters win by catching everyone; runners win if anyone is still free at the end.',
  );
  out.push(
    s.captureMethod === 'runner_confirm'
      ? `To catch someone, tag them, then tap Capture. They confirm on their phone${s.tagCodeEnabled ? ', or show you their tag code' : ''}.`
      : 'To catch someone, tag them, then tap Capture. The host confirms.',
  );
  return out;
}
