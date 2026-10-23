import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { joinCodeSchema } from '@shared/protocol';
import type { ServerConfig } from './config';
import { GameEngine, GameError } from './engine';
import { SocketHub } from './hub';
import { RateLimiter } from './ratelimit';
import { GameStore } from './store';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

export interface App {
  server: Server;
  engine: GameEngine;
  hub: SocketHub;
  store: GameStore;
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
}

export function createApp(config: ServerConfig, opts: { now?: () => number; autoTick?: boolean } = {}): App {
  const store = new GameStore(config.databasePath);
  const engine = new GameEngine(store, config, opts.now ?? Date.now);
  const allowedOrigins = config.publicOrigin ? config.publicOrigin.split(',').map((s) => s.trim()) : null;
  const hub = new SocketHub(engine, {
    fastPingsAllowed: config.allowFastPings,
    simulationAllowed: config.allowSimulation,
    allowedOrigins,
    locationRetentionMs: config.locationRetentionMinutes * 60_000,
  });

  // Per-IP limits for the REST endpoints. Failed code lookups have their own stricter bucket
  // so join codes cannot be brute-forced.
  const k = config.rateLimitScale;
  const createLimiter = new RateLimiter(5 * k, (5 * k) / 600);
  // Generous enough for a whole group joining from one venue Wi-Fi (shared NAT IP).
  const joinLimiter = new RateLimiter(40 * k, (30 * k) / 60);
  const missLimiter = new RateLimiter(20 * k, (20 * k) / 600);

  /**
   * Client IP for rate limiting. Behind a trusted proxy, prefer the platform header
   * (Fly-Client-IP) and otherwise the LAST X-Forwarded-For hop — the one our proxy
   * appended. Earlier hops are client-controlled and would allow limit bypass.
   */
  const clientIp = (req: IncomingMessage) => {
    if (config.trustProxy) {
      const fly = req.headers['fly-client-ip'];
      if (typeof fly === 'string' && fly) return fly.trim();
      const fwd = req.headers['x-forwarded-for'];
      const v = Array.isArray(fwd) ? fwd.join(',') : fwd;
      if (v) return v.split(',').at(-1)!.trim();
    }
    return req.socket.remoteAddress ?? 'unknown';
  };

  const securityHeaders = (res: ServerResponse) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Origin only: invite codes in paths never leak, while Google API keys restricted to
    // this site (HTTP-referrer restriction) still work.
    res.setHeader('Referrer-Policy', 'strict-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=(), payment=(), usb=()');
    if (config.production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        "connect-src 'self' ws: wss: https:",
        "worker-src 'self' blob:",
        "child-src blob:",
        "manifest-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'self'",
      ].join('; '),
    );
  };

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  };

  const readBody = (req: IncomingMessage): Promise<unknown> =>
    new Promise((resolveBody, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > 64 * 1024) {
          reject(new GameError('too_large', 'Request too large', 413));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolveBody(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
        } catch {
          reject(new GameError('invalid', 'Malformed JSON'));
        }
      });
      req.on('error', reject);
    });

  const parseCode = (raw: string) => {
    const r = joinCodeSchema.safeParse(decodeURIComponent(raw));
    if (!r.success) throw new GameError('not_found', 'No active game with that code', 404);
    return r.data;
  };

  async function api(req: IncomingMessage, res: ServerResponse, path: string) {
    const ip = clientIp(req);
    const method = req.method ?? 'GET';
    if (method === 'POST' && req.headers['content-type']?.split(';')[0] !== 'application/json') {
      throw new GameError('unsupported', 'Expected application/json', 415);
    }
    if (path === '/api/health' && method === 'GET') {
      return json(res, 200, { ok: true, games: engine.games.size, sockets: hub.connectionCount() });
    }
    if (path === '/api/config' && method === 'GET') {
      return json(res, 200, {
        fastPingsAllowed: config.allowFastPings,
        simulationAllowed: config.allowSimulation,
        // A browser key: it ends up in tile URLs anyway, so restrict it by HTTP referrer + API in Google Cloud.
        googleMapsApiKey: config.googleMapsApiKey,
      });
    }
    if (path === '/api/games' && method === 'POST') {
      if (!createLimiter.take(ip)) throw new GameError('rate_limited', 'Too many games created. Try again later.', 429);
      const { game, player, token } = engine.createGame(await readBody(req));
      return json(res, 201, { gameId: game.id, code: game.code, playerId: player.id, token });
    }
    const m = path.match(/^\/api\/games\/([^/]+)\/(preview|join)$/);
    if (m) {
      if (!joinLimiter.take(ip)) throw new GameError('rate_limited', 'Too many requests. Slow down.', 429);
      const code = parseCode(m[1]!);
      try {
        if (m[2] === 'preview' && method === 'GET') return json(res, 200, engine.preview(code));
        if (m[2] === 'join' && method === 'POST') {
          const body = await readBody(req);
          const { game, player, token } = engine.joinGame(code, body);
          return json(res, 201, { gameId: game.id, code: game.code, playerId: player.id, token });
        }
      } catch (err) {
        if (err instanceof GameError && (err.code === 'not_found' || err.code === 'bad_password')) {
          if (!missLimiter.take(ip)) throw new GameError('rate_limited', 'Too many failed attempts. Try again in a few minutes.', 429);
        }
        throw err;
      }
    }
    throw new GameError('not_found', 'Not found', 404);
  }

  const staticRoot = config.staticDir ? resolve(config.staticDir) : null;

  function serveStatic(req: IncomingMessage, res: ServerResponse, path: string) {
    if (!staticRoot) return json(res, 404, { error: 'Static files are served by Vite in development (npm run dev)' });
    const safe = normalize(decodeURIComponent(path)).replace(/^(\.\.[/\\])+/, '');
    let file = join(staticRoot, safe);
    if (!file.startsWith(staticRoot)) return json(res, 400, { error: 'bad path' });
    let isFallback = false;
    if (!existsSync(file) || statSync(file).isDirectory()) {
      // SPA fallback (client-side routing), but never for asset-looking paths.
      if (extname(safe) && extname(safe) !== '.html') return json(res, 404, { error: 'not found' });
      file = join(staticRoot, 'index.html');
      isFallback = true;
    }
    const ext = extname(file);
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
    if (path.startsWith('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    else if (isFallback || ext === '.html' || path === '/sw.js') res.setHeader('Cache-Control', 'no-cache');
    else res.setHeader('Cache-Control', 'public, max-age=3600');
    createReadStream(file).pipe(res);
  }

  const server = createServer(async (req, res) => {
    securityHeaders(res);
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url.pathname);
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
      return serveStatic(req, res, url.pathname);
    } catch (err) {
      if (err instanceof GameError) return json(res, err.status, { error: err.message, code: err.code });
      console.error(err);
      return json(res, 500, { error: 'Internal error', code: 'internal' });
    }
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') return socket.destroy();
    hub.handleUpgrade(req, socket, head, clientIp(req));
  });

  const ticker = opts.autoTick === false ? null : setInterval(() => engine.tick(), 1000);

  return {
    server,
    engine,
    hub,
    store,
    listen(port = config.port) {
      return new Promise((res) => {
        server.listen(port, config.host, () => {
          const addr = server.address();
          res(typeof addr === 'object' && addr ? addr.port : port);
        });
      });
    },
    close() {
      if (ticker) clearInterval(ticker);
      hub.close();
      return new Promise((res) => {
        server.close(() => {
          store.close();
          res();
        });
        server.closeAllConnections?.();
      });
    },
  };
}
