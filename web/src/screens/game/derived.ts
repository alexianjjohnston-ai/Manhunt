import { durationMs, elapsedMs, phaseAt } from '@shared/clock';
import type { GameView, PlayerView, RunnerMarker } from '@shared/protocol';
import type { PingMarker, MateMarker, CaptureMarker } from '@/components/map/GameMap';

export interface ClockInfo {
  elapsed: number;
  remaining: number;
  phase: 'lobby' | 'headstart' | 'hunting' | 'ended';
  headStartLeft: number;
  nextPingIn: number | null;
  pingProgress: number;
  paused: boolean;
}

/** Derive every countdown from server timestamps + estimated server "now". */
export function clockInfo(view: GameView, now: number): ClockInfo {
  const { clock, settings } = view.game;
  const elapsed = elapsedMs(clock, now);
  const remaining = Math.max(0, durationMs(settings) - elapsed);
  const phase = phaseAt(view.game.status, clock, settings, now);
  const headStartLeft = Math.max(0, settings.headStartMin * 60_000 - elapsed);
  const next = view.game.nextPingElapsed;
  const nextPingIn = next == null ? null : Math.max(0, next - elapsed);
  const prev = view.game.lastPingElapsed ?? (settings.revealAtHeadStartEnd ? 0 : settings.headStartMin * 60_000);
  const span = next != null ? Math.max(1, next - prev) : 1;
  const pingProgress = next == null ? 0 : Math.min(1, Math.max(0, (elapsed - prev) / span));
  return { elapsed, remaining, phase, headStartLeft, nextPingIn, pingProgress, paused: view.game.paused };
}

export function playerMap(view: GameView): Map<string, PlayerView> {
  return new Map(view.players.map((p) => [p.id, p]));
}

export function toPingMarkers(markers: RunnerMarker[], players: Map<string, PlayerView>): PingMarker[] {
  const out: PingMarker[] = [];
  for (const m of markers) {
    const name = players.get(m.playerId)?.name ?? 'Runner';
    if (m.status !== 'missed' && m.lat != null && m.lng != null) {
      out.push({ id: m.playerId, name, lat: m.lat, lng: m.lng, accuracyM: m.accuracyM ?? 0, fixAt: m.fixAt ?? m.revealedAt, seq: m.seq, kind: m.status === 'stale' ? 'stale' : 'ok' });
    } else if (m.lastKnown) {
      out.push({ id: m.playerId, name, ...m.lastKnown, kind: 'old' });
    }
  }
  return out;
}

export function toMateMarkers(view: GameView, players: Map<string, PlayerView>): MateMarker[] {
  return view.live.map((l) => {
    const p = players.get(l.playerId);
    return { id: l.playerId, name: p?.name ?? '?', team: p?.team === 'hunter' ? 'hunter' : 'runner', lat: l.lat, lng: l.lng, accuracyM: l.accuracyM, fixAt: l.fixAt };
  });
}

export function toCaptureMarkers(view: GameView, players: Map<string, PlayerView>): CaptureMarker[] {
  return view.captures
    .filter((c) => c.status === 'confirmed' && c.location)
    .map((c) => ({ id: c.id, lat: c.location!.lat, lng: c.location!.lng, label: players.get(c.runnerId)?.name ?? 'Runner' }));
}
