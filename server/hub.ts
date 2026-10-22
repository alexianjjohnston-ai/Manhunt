import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { clientMessageSchema, type ServerMessage } from '@shared/protocol';
import type { GameEvent } from '@shared/types';
import { GameEngine, GameError } from './engine';
import { canSeeEvent, project } from './projection';
import { RateLimiter } from './ratelimit';
import type { GameState } from './state';

interface Conn {
  ws: WebSocket;
  gameId?: string;
  playerId?: string;
  lastSent?: string;
  alive: boolean;
  ip: string;
}

const AUTH_TIMEOUT_MS = 10_000;
const MAX_MESSAGE_BYTES = 8 * 1024;

/**
 * WebSocket hub: authenticates sockets, validates and rate-limits messages, and pushes
 * per-player projections. A socket is bound to exactly one (game, player) pair.
 */
export class SocketHub {
  readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false });
  private conns = new Map<string, Map<string, Set<Conn>>>();
  private dirty = new Set<string>();
  private flushTimer: NodeJS.Timeout | null = null;
  private msgLimiter: RateLimiter;
  private authLimiter: RateLimiter;
  private heartbeat: NodeJS.Timeout;

  constructor(
    private engine: GameEngine,
    private opts: { fastPingsAllowed: boolean; simulationAllowed: boolean; allowedOrigins: string[] | null; locationRetentionMs: number },
  ) {
    this.msgLimiter = new RateLimiter(30, 10, () => engine.now());
    this.authLimiter = new RateLimiter(20, 0.5, () => engine.now());
    engine.hooks = {
      changed: (g) => this.markDirty(g.id),
      event: (g, e) => this.broadcastEvent(g, e),
      send: (gameId, playerId, msg) => this.sendTo(gameId, playerId, msg),
      disconnect: (gameId, playerId) => this.closePlayer(gameId, playerId),
      isConnected: (gameId, playerId) => (this.conns.get(gameId)?.get(playerId)?.size ?? 0) > 0,
    };
    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage, ip: string) => this.onConnection(ws, ip));
    this.heartbeat = setInterval(() => {
      for (const ws of this.wss.clients) {
        const c = (ws as WebSocket & { conn?: Conn }).conn;
        if (c && !c.alive) {
          ws.terminate();
          continue;
        }
        if (c) c.alive = false;
        ws.ping();
      }
    }, 20_000);
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, ip: string) {
    const origin = req.headers.origin;
    if (this.opts.allowedOrigins && origin && !this.opts.allowedOrigins.includes(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req, ip));
  }

  private onConnection(ws: WebSocket, ip: string) {
    const conn: Conn = { ws, alive: true, ip };
    (ws as WebSocket & { conn?: Conn }).conn = conn;
    ws.on('pong', () => (conn.alive = true));
    const authTimer = setTimeout(() => {
      if (!conn.playerId) ws.close(4001, 'auth timeout');
    }, AUTH_TIMEOUT_MS);

    ws.on('message', (data, isBinary) => {
      if (isBinary) return ws.close(1003, 'binary not supported');
      conn.alive = true;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return this.send(conn, { type: 'error', code: 'invalid', message: 'Malformed message' });
      }
      const r = clientMessageSchema.safeParse(parsed);
      if (!r.success) {
        return this.send(conn, { type: 'error', code: 'invalid', message: r.error.issues[0]?.message ?? 'Invalid message' });
      }
      const msg = r.data;
      if (msg.type === 'ping') {
        return this.send(conn, { type: 'pong', t: msg.t, serverNow: this.engine.now() });
      }
      if (msg.type === 'auth') {
        if (conn.playerId) return;
        if (!this.authLimiter.take(ip)) {
          this.send(conn, { type: 'error', code: 'rate_limited', message: 'Too many attempts' });
          return ws.close(4029, 'rate limited');
        }
        try {
          const { game, player } = this.engine.authenticate(msg.gameId, msg.token);
          clearTimeout(authTimer);
          conn.gameId = game.id;
          conn.playerId = player.id;
          this.register(conn);
          this.send(conn, { type: 'welcome', playerId: player.id, gameId: game.id, serverNow: this.engine.now() });
          this.engine.onConnect(game, player);
          this.pushState(game, conn, true);
        } catch (err) {
          const e = err instanceof GameError ? err : new GameError('error', 'Authentication failed');
          this.send(conn, { type: 'error', code: e.code, message: e.message });
          ws.close(4003, e.code);
        }
        return;
      }
      if (!conn.gameId || !conn.playerId) {
        return this.send(conn, { type: 'error', code: 'unauthorized', message: 'Authenticate first' });
      }
      const cost = msg.type === 'location' ? 1 : 2;
      if (!this.msgLimiter.take(`${conn.gameId}:${conn.playerId}`, cost)) {
        return this.send(conn, { type: 'error', code: 'rate_limited', message: 'Too many messages, slow down' });
      }
      try {
        this.engine.handle(conn.gameId, conn.playerId, msg);
      } catch (err) {
        if (err instanceof GameError) {
          this.send(conn, { type: 'error', code: err.code, message: err.message, ref: msg.type });
        } else {
          console.error('handler error', err);
          this.send(conn, { type: 'error', code: 'internal', message: 'Something went wrong', ref: msg.type });
        }
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (!conn.gameId || !conn.playerId) return;
      const set = this.conns.get(conn.gameId)?.get(conn.playerId);
      set?.delete(conn);
      const g = this.engine.getGame(conn.gameId);
      const p = g?.players.find((x) => x.id === conn.playerId);
      if (g && p) this.engine.onDisconnect(g, p);
    });
    ws.on('error', () => ws.terminate());
  }

  private register(conn: Conn) {
    let byPlayer = this.conns.get(conn.gameId!);
    if (!byPlayer) this.conns.set(conn.gameId!, (byPlayer = new Map()));
    let set = byPlayer.get(conn.playerId!);
    if (!set) byPlayer.set(conn.playerId!, (set = new Set()));
    set.add(conn);
  }

  private send(conn: Conn, msg: ServerMessage) {
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(msg));
  }

  private sendTo(gameId: string, playerId: string, msg: ServerMessage) {
    for (const c of this.conns.get(gameId)?.get(playerId) ?? []) this.send(c, msg);
  }

  private closePlayer(gameId: string, playerId: string) {
    const set = this.conns.get(gameId)?.get(playerId);
    if (!set) return;
    // Flush the final state first so the client sees why it was disconnected.
    for (const c of set) setTimeout(() => c.ws.close(4000, 'removed'), 100);
    this.conns.get(gameId)?.delete(playerId);
  }

  private markDirty(gameId: string) {
    this.dirty.add(gameId);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 25);
  }

  flush() {
    this.flushTimer = null;
    const ids = [...this.dirty];
    this.dirty.clear();
    for (const id of ids) {
      const g = this.engine.getGame(id);
      if (!g) continue;
      for (const set of this.conns.get(id)?.values() ?? []) for (const c of set) this.pushState(g, c);
    }
  }

  private pushState(g: GameState, conn: Conn, force = false) {
    if (!conn.playerId) return;
    const view = project(g, conn.playerId, {
      now: this.engine.now(),
      fixes: this.engine.fixesFor(g.id),
      isConnected: (pid) => (this.conns.get(g.id)?.get(pid)?.size ?? 0) > 0,
      warnings: (pid) => this.engine.warningsFor(g.id, pid),
      fastPingsAllowed: this.opts.fastPingsAllowed,
      simulationAllowed: this.opts.simulationAllowed,
      locationRetentionMs: this.opts.locationRetentionMs,
    });
    // Skip identical views (ignoring the server timestamp) to save bandwidth.
    const key = JSON.stringify({ ...view, serverNow: 0 });
    if (!force && key === conn.lastSent) return;
    conn.lastSent = key;
    this.send(conn, { type: 'state', view });
  }

  private broadcastEvent(g: GameState, e: GameEvent) {
    for (const [pid, set] of this.conns.get(g.id) ?? []) {
      const p = g.players.find((x) => x.id === pid);
      if (!p || !canSeeEvent(e, p, g.hostId === p.id)) continue;
      for (const c of set) this.send(c, { type: 'event', event: e });
    }
  }

  connectionCount() {
    return this.wss.clients.size;
  }

  close() {
    clearInterval(this.heartbeat);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
  }
}
