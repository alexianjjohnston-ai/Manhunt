/**
 * DEMO BUILD ONLY: an in-page stand-in for the Node server. It runs the real
 * GameEngine and projection, and mirrors server/hub.ts (auth, validation, per-player
 * views, events) and the REST routes in server/app.ts. Nothing leaves the browser tab.
 */
import { clientMessageSchema, joinCodeSchema, type ServerMessage } from '@shared/protocol';
import type { GameEvent } from '@shared/types';
import { GameEngine, GameError } from '../../../server/engine';
import { canSeeEvent, project } from '../../../server/projection';
import type { GameState } from '../../../server/state';
import type { GameStore } from '../../../server/store';

export interface DemoConn {
  gameId?: string;
  playerId?: string;
  lastSent?: string;
  deliver(msg: ServerMessage): void;
  close(code: number): void;
}

const memoryStore = {
  save() {},
  delete() {},
  codeExists: () => false,
  loadAll: () => [],
  close() {},
} as unknown as GameStore;

const engine = new GameEngine(memoryStore, {
  allowFastPings: true,
  allowSimulation: true,
  locationRetentionMinutes: 60,
  gameRetentionHours: 24,
  lobbyIdleHours: 12,
});

const conns = new Map<string, Map<string, Set<DemoConn>>>();
const dirty = new Set<string>();
let flushTimer: number | null = null;

const connected = (gameId: string, playerId: string) => (conns.get(gameId)?.get(playerId)?.size ?? 0) > 0;

engine.hooks = {
  changed: (g) => {
    dirty.add(g.id);
    if (!flushTimer) flushTimer = window.setTimeout(flush, 25);
  },
  event: (g, e) => broadcastEvent(g, e),
  send: (gameId, playerId, msg) => {
    for (const c of conns.get(gameId)?.get(playerId) ?? []) c.deliver(msg);
  },
  disconnect: (gameId, playerId) => {
    const set = conns.get(gameId)?.get(playerId);
    if (!set) return;
    for (const c of set) window.setTimeout(() => c.close(4000), 100);
    conns.get(gameId)?.delete(playerId);
  },
  isConnected: connected,
};

window.setInterval(() => engine.tick(), 1000);

function flush() {
  flushTimer = null;
  const ids = [...dirty];
  dirty.clear();
  for (const id of ids) {
    const g = engine.getGame(id);
    if (!g) continue;
    for (const set of conns.get(id)?.values() ?? []) for (const c of set) pushState(g, c);
  }
}

function pushState(g: GameState, c: DemoConn, force = false) {
  if (!c.playerId) return;
  const view = project(g, c.playerId, {
    now: engine.now(),
    fixes: engine.fixesFor(g.id),
    isConnected: (pid) => connected(g.id, pid),
    warnings: (pid) => engine.warningsFor(g.id, pid),
    fastPingsAllowed: true,
    simulationAllowed: true,
    locationRetentionMs: 3_600_000,
  });
  const key = JSON.stringify({ ...view, serverNow: 0 });
  if (!force && key === c.lastSent) return;
  c.lastSent = key;
  c.deliver({ type: 'state', view });
}

function broadcastEvent(g: GameState, e: GameEvent) {
  for (const [pid, set] of conns.get(g.id) ?? []) {
    const p = g.players.find((x) => x.id === pid);
    if (!p || !canSeeEvent(e, p, g.hostId === p.id)) continue;
    for (const c of set) c.deliver({ type: 'event', event: e });
  }
}

/** Handle one raw message from a client connection (same rules as the real hub). */
export function receive(c: DemoConn, raw: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return c.deliver({ type: 'error', code: 'invalid', message: 'Malformed message' });
  }
  const r = clientMessageSchema.safeParse(parsed);
  if (!r.success) return c.deliver({ type: 'error', code: 'invalid', message: r.error.issues[0]?.message ?? 'Invalid message' });
  const msg = r.data;
  if (msg.type === 'ping') return c.deliver({ type: 'pong', t: msg.t, serverNow: engine.now() });
  if (msg.type === 'auth') {
    try {
      const { game, player } = engine.authenticate(msg.gameId, msg.token);
      c.gameId = game.id;
      c.playerId = player.id;
      let byPlayer = conns.get(game.id);
      if (!byPlayer) conns.set(game.id, (byPlayer = new Map()));
      let set = byPlayer.get(player.id);
      if (!set) byPlayer.set(player.id, (set = new Set()));
      set.add(c);
      c.deliver({ type: 'welcome', playerId: player.id, gameId: game.id, serverNow: engine.now() });
      engine.onConnect(game, player);
      pushState(game, c, true);
    } catch (err) {
      const e = err instanceof GameError ? err : new GameError('error', 'Authentication failed');
      c.deliver({ type: 'error', code: e.code, message: e.message });
      c.close(4003);
    }
    return;
  }
  if (!c.gameId || !c.playerId) return c.deliver({ type: 'error', code: 'unauthorized', message: 'Authenticate first' });
  try {
    engine.handle(c.gameId, c.playerId, msg);
  } catch (err) {
    if (err instanceof GameError) c.deliver({ type: 'error', code: err.code, message: err.message, ref: msg.type });
    else {
      console.error(err);
      c.deliver({ type: 'error', code: 'internal', message: 'Something went wrong', ref: msg.type });
    }
  }
}

export function disconnect(c: DemoConn) {
  if (!c.gameId || !c.playerId) return;
  conns.get(c.gameId)?.get(c.playerId)?.delete(c);
  const g = engine.getGame(c.gameId);
  const p = g?.players.find((x) => x.id === c.playerId);
  if (g && p) engine.onDisconnect(g, p);
}

/** The REST routes from server/app.ts. */
export function api(method: string, path: string, body: unknown): { status: number; json: unknown } {
  try {
    if (path === '/api/health') return { status: 200, json: { ok: true } };
    if (path === '/api/config') return { status: 200, json: { fastPingsAllowed: true, simulationAllowed: true, googleMapsApiKey: null } };
    if (path === '/api/games' && method === 'POST') {
      const { game, player, token } = engine.createGame(body);
      return { status: 201, json: { gameId: game.id, code: game.code, playerId: player.id, token } };
    }
    const m = path.match(/^\/api\/games\/([^/]+)\/(preview|join)$/);
    if (m) {
      const code = joinCodeSchema.safeParse(decodeURIComponent(m[1]!));
      if (!code.success) throw new GameError('not_found', 'No active game with that code', 404);
      if (m[2] === 'preview') return { status: 200, json: engine.preview(code.data) };
      const { game, player, token } = engine.joinGame(code.data, body);
      return { status: 201, json: { gameId: game.id, code: game.code, playerId: player.id, token } };
    }
    throw new GameError('not_found', 'Not found', 404);
  } catch (err) {
    if (err instanceof GameError) return { status: err.status, json: { error: err.message, code: err.code } };
    console.error(err);
    return { status: 500, json: { error: 'Internal error', code: 'internal' } };
  }
}

export { engine as demoEngine };
