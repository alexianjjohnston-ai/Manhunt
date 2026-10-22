import type { ClockState, GameSettings, Phase } from './types';

export const MIN = 60_000;
/** Runners are asked for a fresh GPS fix this long before each reveal (30 s, less for very short intervals). */
export const PING_WARNING_MS = 30_000;
export function pingWarningMs(settings: Pick<GameSettings, 'pingIntervalSec'>): number {
  return Math.min(PING_WARNING_MS, settings.pingIntervalSec * 1000 * 0.4);
}

/** Game time elapsed (excludes paused time). Pure function of server timestamps. */
export function elapsedMs(clock: ClockState, now: number): number {
  if (clock.startedAt == null) return 0;
  const end = clock.endedAt ?? clock.pausedAt ?? now;
  return Math.max(0, end - clock.startedAt - clock.pausedTotalMs);
}

export function durationMs(settings: Pick<GameSettings, 'durationMin'>): number {
  return settings.durationMin * MIN;
}

export function headStartMs(settings: Pick<GameSettings, 'headStartMin'>): number {
  return settings.headStartMin * MIN;
}

export function pingIntervalMs(settings: Pick<GameSettings, 'pingIntervalSec'>): number {
  return settings.pingIntervalSec * 1000;
}

export function remainingMs(clock: ClockState, settings: Pick<GameSettings, 'durationMin'>, now: number): number {
  return Math.max(0, durationMs(settings) - elapsedMs(clock, now));
}

export function phaseAt(
  status: 'lobby' | 'running' | 'ended',
  clock: ClockState,
  settings: Pick<GameSettings, 'headStartMin'>,
  now: number,
): Phase {
  if (status === 'lobby') return 'lobby';
  if (status === 'ended') return 'ended';
  return elapsedMs(clock, now) < headStartMs(settings) ? 'headstart' : 'hunting';
}

/** Elapsed time of the first scheduled reveal. */
export function firstPingElapsed(settings: Pick<GameSettings, 'headStartMin' | 'pingIntervalSec' | 'revealAtHeadStartEnd'>): number {
  const hs = headStartMs(settings);
  if (settings.revealAtHeadStartEnd && hs > 0) return hs;
  return hs + pingIntervalMs(settings);
}

/**
 * Given the elapsed time of the last reveal (or null) and the current elapsed time,
 * return the elapsed time of the next reveal. Overdue reveals (server offline) collapse
 * into the next future slot so we never fire a burst of catch-up pings.
 */
export function nextPingAfter(
  lastPingElapsed: number | null,
  settings: Pick<GameSettings, 'headStartMin' | 'pingIntervalSec' | 'revealAtHeadStartEnd'>,
): number {
  if (lastPingElapsed == null) return firstPingElapsed(settings);
  return lastPingElapsed + pingIntervalMs(settings);
}

/** Fix age threshold below which a reveal is considered fresh ("ok"). */
export function freshThresholdMs(settings: Pick<GameSettings, 'pingIntervalSec'>): number {
  return Math.min(90_000, Math.max(20_000, pingIntervalMs(settings) * 0.5));
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** "12s ago", "3m ago", "1h 4m ago". */
export function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return m < 10 && s % 60 ? `${m}m ${s % 60}s ago` : `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}
