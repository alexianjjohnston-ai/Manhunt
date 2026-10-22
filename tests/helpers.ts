import { DEFAULT_SETTINGS, type ClientMessage, type ServerMessage } from '@shared/protocol';
import type { GameSettings } from '@shared/types';
import { GameEngine } from '../server/engine';
import { project } from '../server/projection';
import type { GameState } from '../server/state';
import { GameStore } from '../server/store';

export const BASE = { lat: 51.5007, lng: -0.1246 }; // Westminster

export class ManualClock {
  t = 1_700_000_000_000;
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

export function seededRng(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

export interface Harness {
  engine: GameEngine;
  clock: ManualClock;
  store: GameStore;
  sent: { gameId: string; playerId: string; msg: ServerMessage }[];
  connected: Set<string>;
}

export function makeEngine(
  opts: { allowFastPings?: boolean; dbPath?: string; clock?: ManualClock; allowSimulation?: boolean } = {},
): Harness {
  const clock = opts.clock ?? new ManualClock();
  const store = new GameStore(opts.dbPath ?? ':memory:');
  const engine = new GameEngine(
    store,
    {
      allowFastPings: opts.allowFastPings ?? true,
      allowSimulation: opts.allowSimulation ?? true,
      locationRetentionMinutes: 60,
      gameRetentionHours: 24,
      lobbyIdleHours: 12,
    },
    clock.now,
    seededRng(),
  );
  const sent: Harness['sent'] = [];
  const connected = new Set<string>();
  engine.hooks = {
    changed() {},
    event() {},
    send: (gameId, playerId, msg) => sent.push({ gameId, playerId, msg }),
    disconnect: (_g, p) => connected.delete(p),
    isConnected: (_g, p) => connected.has(p),
  };
  return { engine, clock, store, sent, connected };
}

export interface TestGame {
  game: GameState;
  host: string;
  ids: Record<string, string>;
  tokens: Record<string, string>;
}

/**
 * Create a lobby with the given player names. The first name is the host.
 * Teams are assigned explicitly via host.setTeam unless `teams` is omitted.
 */
export function setupGame(
  h: Harness,
  names: string[],
  settings: Partial<GameSettings> = {},
  teams?: Record<string, 'runner' | 'hunter' | 'spectator'>,
): TestGame {
  const [hostName, ...rest] = names;
  const created = h.engine.createGame({
    hostName,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    boundary: { type: 'circle', center: BASE, radiusM: 2000 },
    safetyAck: true,
  });
  const ids: Record<string, string> = { [hostName!]: created.player.id };
  const tokens: Record<string, string> = { [hostName!]: created.token };
  for (const n of rest) {
    const j = h.engine.joinGame(created.game.code, { name: n });
    ids[n] = j.player.id;
    tokens[n] = j.token;
  }
  for (const id of Object.values(ids)) h.connected.add(id);
  const host = created.player.id;
  if (teams) {
    for (const [n, team] of Object.entries(teams)) send(h, created.game, host, { type: 'host.setTeam', playerId: ids[n]!, team });
  }
  for (const [n, id] of Object.entries(ids)) {
    send(h, created.game, id, { type: 'ackSafety' });
    if (id !== host) send(h, created.game, id, { type: 'setReady', ready: true });
    void n;
  }
  return { game: created.game, host, ids, tokens };
}

export function send(h: Harness, g: GameState, playerId: string, msg: ClientMessage) {
  h.engine.handle(g.id, playerId, msg);
}

export function view(h: Harness, g: GameState, playerId: string) {
  return project(g, playerId, {
    now: h.clock.now(),
    fixes: h.engine.fixesFor(g.id),
    isConnected: (id) => h.connected.has(id),
    warnings: (id) => h.engine.warningsFor(g.id, id),
    fastPingsAllowed: true,
    simulationAllowed: true,
  });
}

export function locate(h: Harness, g: GameState, playerId: string, lat: number, lng: number, accuracyM = 8, ageMs = 0) {
  send(h, g, playerId, { type: 'location', lat, lng, accuracyM, ageMs });
}

/** Advance the clock in 1 s steps, ticking the engine like the real server does. */
export function run(h: Harness, ms: number, each?: () => void) {
  const steps = Math.ceil(ms / 1000);
  for (let i = 0; i < steps; i++) {
    h.clock.advance(1000);
    each?.();
    h.engine.tick();
  }
}
