import { phaseAt } from '@shared/clock';
import type { CaptureView, GameView, LiveMarker, PlayerView, RunnerMarker } from '@shared/protocol';
import type { GameEvent, RevealSnapshot } from '@shared/types';
import type { Fix, GameState, PlayerState } from './state';

export interface ProjectionContext {
  now: number;
  fixes: Map<string, Fix>;
  isConnected: (playerId: string) => boolean;
  warnings: (playerId: string) => string[];
  fastPingsAllowed: boolean;
  simulationAllowed: boolean;
  locationRetentionMs: number;
}

const LIVE_FIX_MAX_AGE_MS = 120_000;
const RECENT_CAPTURE_MS = 5 * 60_000;

/**
 * Build the view of a game for ONE player. This is the only path by which game state
 * reaches clients, so every visibility rule lives here:
 *
 * - Runner coordinates reach hunters only through reveal snapshots (never live).
 * - Runners never receive hunter coordinates.
 * - Captured runners and spectators receive no coordinates while the game runs.
 * - Host extras are health indicators, never coordinates.
 * - Full reveal history is only included after the game has ended (and until purged).
 */
export function project(g: GameState, viewerId: string, ctx: ProjectionContext): GameView {
  const me = g.players.find((p) => p.id === viewerId);
  if (!me) throw new Error('viewer not in game');
  const isHost = g.hostId === me.id;
  const ended = g.status === 'ended';
  const running = g.status === 'running';
  const activeCompetitor = running && me.status === 'active' && (me.team === 'runner' || me.team === 'hunter');
  const shareLocation = running && !g.emergency && activeCompetitor;

  // --- players -------------------------------------------------------------
  const players: PlayerView[] = g.players
    .filter((p) => p.status !== 'kicked')
    .map((p) => {
      const v: PlayerView = {
        id: p.id,
        name: p.name,
        team: p.team,
        startTeam: p.startTeam ?? null,
        status: p.status,
        isHost: p.id === g.hostId,
        ready: p.ready,
        safetyAck: p.safetyAck,
        connected: ctx.isConnected(p.id),
        capturedAt: p.capturedAt,
      };
      if (isHost) {
        const f = ctx.fixes.get(p.id);
        v.health = {
          gps: p.gps,
          lastFixAt: f ? f.fixAt : null,
          accuracyM: f ? Math.round(f.accuracyM) : null,
          lastSeenAt: p.lastSeenAt,
          warnings: ctx.warnings(p.id),
        };
      }
      return v;
    });

  // --- live teammate positions ----------------------------------------------
  const live: LiveMarker[] = [];
  if (running && !g.emergency && activeCompetitor) {
    const allowed =
      (me.team === 'hunter' && g.settings.hunterTeammatesVisible) ||
      (me.team === 'runner' && g.settings.runnerTeammatesVisible);
    if (allowed) {
      for (const p of g.players) {
        if (p.id === me.id || p.team !== me.team || p.status !== 'active') continue;
        const f = ctx.fixes.get(p.id);
        if (!f || ctx.now - f.fixAt > LIVE_FIX_MAX_AGE_MS) continue;
        live.push({ playerId: p.id, lat: f.lat, lng: f.lng, accuracyM: Math.round(f.accuracyM), fixAt: f.fixAt });
      }
    }
  }

  // --- revealed runner markers ----------------------------------------------
  let visibleRunnerIds: Set<string> = new Set();
  if (running && me.status === 'active') {
    if (me.team === 'hunter') {
      visibleRunnerIds = new Set(g.players.filter((p) => p.team === 'runner' && p.status === 'active').map((p) => p.id));
    } else if (me.team === 'runner') {
      // Runners see what the hunters saw about themselves (and teammates, if allowed).
      visibleRunnerIds = new Set(
        g.players
          .filter(
            (p) =>
              p.team === 'runner' &&
              p.status === 'active' &&
              (p.id === me.id || g.settings.runnerTeammatesVisible),
          )
          .map((p) => p.id),
      );
    }
  }
  const runnerMarkers = buildRunnerMarkers(g.reveals, visibleRunnerIds);

  // --- captures -------------------------------------------------------------
  const captures: CaptureView[] = [];
  const seesCaptureLocations = ended || (running && me.team === 'hunter');
  for (const c of g.captures) {
    const involved = c.hunterId === me.id || c.runnerId === me.id;
    const open = c.status === 'pending' || c.status === 'disputed';
    const include =
      c.status === 'confirmed' ||
      (open && (involved || isHost)) ||
      (!open && involved && ctx.now - (c.resolvedAt ?? c.createdAt) < RECENT_CAPTURE_MS);
    if (!include) continue;
    const view: CaptureView = { ...c };
    if (!seesCaptureLocations) delete view.location;
    captures.push(view);
  }

  // --- events -----------------------------------------------------------------
  const events: GameEvent[] = g.events.filter((e) => canSeeEvent(e, me, isHost)).slice(-80);

  const history: RevealSnapshot[] = ended ? g.reveals : [];

  return {
    serverNow: ctx.now,
    game: {
      id: g.id,
      code: g.code,
      name: g.settings.name,
      status: g.status,
      phase: phaseAt(g.status, g.clock, g.settings, ctx.now),
      settings: g.settings,
      boundary: g.boundary,
      hostId: g.hostId,
      hasPassword: !!g.passwordHash,
      clock: g.clock,
      lastPingElapsed: g.lastPingElapsed,
      nextPingElapsed: g.nextPingElapsed,
      pingCount: g.reveals.length,
      sweepsLeft: g.sweepsLeft ?? 0,
      paused: g.clock.pausedAt != null,
      emergency: g.emergency,
      winner: g.winner,
      endReason: g.endReason,
      createdAt: g.createdAt,
      fastPingsAllowed: ctx.fastPingsAllowed,
      simulationAllowed: ctx.simulationAllowed,
      locationsPurgeAt: ended && g.clock.endedAt ? g.clock.endedAt + ctx.locationRetentionMs : null,
      locationsPurged: g.locationsPurged,
    },
    me: {
      id: me.id,
      name: me.name,
      team: me.team,
      status: me.status,
      isHost,
      ready: me.ready,
      safetyAck: me.safetyAck,
      shareLocation,
      tagCode: running && me.team === 'runner' && me.status === 'active' && g.settings.tagCodeEnabled ? me.tagCode : undefined,
      cloaksLeft: me.team === 'runner' ? (me.cloaksLeft ?? 0) : 0,
      cloakArmed: me.team === 'runner' && !!me.cloakArmed,
      lastFixAt: ctx.fixes.get(me.id)?.fixAt ?? null,
    },
    players,
    live,
    runnerMarkers,
    history,
    captures,
    events,
  };
}

export function canSeeEvent(e: GameEvent, me: PlayerState, isHost: boolean): boolean {
  switch (e.visibility) {
    case 'all':
      return true;
    case 'host':
      return isHost;
    // Team-only events reach the host only when the host is not playing for the other team.
    case 'hunter':
      return me.team === 'hunter' || (isHost && me.team !== 'runner');
    case 'runner':
      return me.team === 'runner' || (isHost && me.team !== 'hunter');
  }
}

/** Latest reveal entry per visible runner, with the last successful one kept for missed pings. */
export function buildRunnerMarkers(reveals: RevealSnapshot[], visible: Set<string>): RunnerMarker[] {
  if (visible.size === 0) return [];
  const out = new Map<string, RunnerMarker>();
  for (const r of reveals) {
    for (const e of r.entries) {
      if (!visible.has(e.playerId)) continue;
      const prev = out.get(e.playerId);
      const marker: RunnerMarker = {
        playerId: e.playerId,
        seq: r.seq,
        revealedAt: r.revealedAt,
        status: e.status,
        reason: e.reason,
      };
      if ((e.status === 'ok' || e.status === 'stale') && e.lat != null && e.lng != null) {
        marker.lat = e.lat;
        marker.lng = e.lng;
        marker.accuracyM = e.accuracyM;
        marker.fixAt = e.fixAt;
      } else if (prev) {
        // Carry forward the last successful reveal, explicitly labelled as old.
        if (prev.lat != null && prev.lng != null) {
          marker.lastKnown = {
            lat: prev.lat,
            lng: prev.lng,
            accuracyM: prev.accuracyM ?? 0,
            fixAt: prev.fixAt ?? prev.revealedAt,
            revealedAt: prev.revealedAt,
            seq: prev.seq,
          };
        } else if (prev.lastKnown) {
          marker.lastKnown = prev.lastKnown;
        }
      }
      out.set(e.playerId, marker);
    }
  }
  return [...out.values()];
}

export { LIVE_FIX_MAX_AGE_MS };
