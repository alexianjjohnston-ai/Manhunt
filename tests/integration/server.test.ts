import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { DEFAULT_SETTINGS, type ClientMessage, type GameView, type ServerMessage } from '@shared/protocol';
import { createApp, type App } from '../../server/app';
import { loadConfig } from '../../server/config';
import { ManualClock } from '../helpers';

let app: App;
let base: string;
const clock = new ManualClock();
clock.t = Date.now();

beforeAll(async () => {
  const config = { ...loadConfig({ NODE_ENV: 'test' }), databasePath: ':memory:', host: '127.0.0.1', staticDir: null };
  app = createApp(config, { now: clock.now, autoTick: false });
  const port = await app.listen(0);
  base = `127.0.0.1:${port}`;
});

afterAll(async () => {
  await app?.close();
});

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`http://${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, string> };
}

class Client {
  ws!: WebSocket;
  messages: ServerMessage[] = [];
  view: GameView | null = null;
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];

  async connect(gameId: string, token: string) {
    this.ws = new WebSocket(`ws://${base}/ws`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      this.messages.push(m);
      if (m.type === 'state') this.view = m.view;
      this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.resolve(m), false) : true));
    });
    await new Promise((r) => this.ws.once('open', r));
    this.send({ type: 'auth', gameId, token });
    return this.waitFor((m) => m.type === 'welcome' || m.type === 'error');
  }

  send(m: ClientMessage | Record<string, unknown>) {
    this.ws.send(JSON.stringify(m));
  }

  waitFor(pred: (m: ServerMessage) => boolean, timeout = 3000): Promise<ServerMessage> {
    const existing = this.messages.find(pred);
    if (existing) {
      this.messages = this.messages.filter((m) => m !== existing);
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting for message')), timeout);
      this.waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(t);
          this.messages = this.messages.filter((x) => x !== m);
          resolve(m);
        },
      });
    });
  }

  waitView(pred: (v: GameView) => boolean) {
    if (this.view && pred(this.view)) return Promise.resolve(this.view);
    return this.waitFor((m) => m.type === 'state' && pred(m.view)).then((m) => (m as { view: GameView }).view);
  }

  close() {
    this.ws.close();
  }
}

describe('HTTP + WebSocket server', () => {
  it('serves health and security headers', async () => {
    const res = await fetch(`http://${base}/api/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('validates input and content type', async () => {
    const bad = await post('/api/games', { hostName: '', settings: {} });
    expect(bad.status).toBe(400);
    const res = await fetch(`http://${base}/api/games`, { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } });
    expect(res.status).toBe(415);
  });

  it('plays a full game over real sockets: create, join, reconnect, ping, capture, win', async () => {
    const created = await post('/api/games', {
      hostName: 'Host',
      settings: { ...DEFAULT_SETTINGS, name: 'Integration', headStartMin: 1, pingIntervalSec: 60, durationMin: 20 },
      boundary: null,
      safetyAck: true,
    });
    expect(created.status).toBe(201);
    const { gameId, code, token: hostToken } = created.body as { gameId: string; code: string; token: string };

    const preview = await fetch(`http://${base}/api/games/${code.toLowerCase()}/preview`).then((r) => r.json());
    expect(preview).toMatchObject({ name: 'Integration', players: 1 });

    const join = async (name: string) => (await post(`/api/games/${code}/join`, { name })).body as { token: string; playerId: string };
    const runnerJ = await join('Runner');
    const hunterJ = await join('Hunter2');

    const host = new Client();
    const runner = new Client();
    const hunter = new Client();
    expect((await host.connect(gameId, hostToken)).type).toBe('welcome');
    await runner.connect(gameId, runnerJ.token);
    await hunter.connect(gameId, hunterJ.token);

    // Manual teams: host + Hunter2 hunt, Runner runs.
    host.send({ type: 'host.updateSettings', settings: { teamAssignment: 'manual' } });
    host.send({ type: 'host.setTeam', playerId: host.view!.me.id, team: 'hunter' });
    host.send({ type: 'host.setTeam', playerId: hunterJ.playerId, team: 'hunter' });
    host.send({ type: 'host.setTeam', playerId: runnerJ.playerId, team: 'runner' });
    await host.waitView((v) => v.players.filter((p) => p.team === 'hunter').length === 2 && v.players.some((p) => p.team === 'runner'));

    // Non-host start is rejected server-side.
    runner.send({ type: 'host.start' });
    const e = (await runner.waitFor((m) => m.type === 'error')) as { code: string };
    expect(e.code).toBe('forbidden');

    for (const c of [runner, hunter]) {
      c.send({ type: 'ackSafety' });
      c.send({ type: 'setReady', ready: true });
    }
    await host.waitView((v) => v.players.filter((p) => p.ready).length === 2);
    host.send({ type: 'host.start' });
    await runner.waitView((v) => v.game.status === 'running');
    expect(runner.view!.me.shareLocation).toBe(true);
    expect(runner.view!.me.tagCode).toMatch(/^\d{4}$/);

    // Reconnect with the same token: no duplicate player.
    runner.close();
    const runner2 = new Client();
    await runner2.connect(gameId, runnerJ.token);
    const rv = await runner2.waitView((v) => v.game.status === 'running');
    expect(rv.players).toHaveLength(3);
    expect(rv.me.id).toBe(runnerJ.playerId);

    runner2.send({ type: 'location', lat: 48.8584, lng: 2.2945, accuracyM: 6, ageMs: 500 });
    await new Promise((r) => setTimeout(r, 60));
    // Before the reveal, hunters have nothing.
    expect(JSON.stringify(hunter.view)).not.toContain('48.8584');

    // Advance to 20 s before the first ping (head start 1m + 60s interval = 2m; warning lead is 24 s).
    clock.advance(100_000);
    app.engine.tick();
    const req = await runner2.waitFor((m) => m.type === 'pingRequest');
    expect(req.type).toBe('pingRequest');
    runner2.send({ type: 'location', lat: 48.8585, lng: 2.2946, accuracyM: 5, ageMs: 0 });
    await new Promise((r) => setTimeout(r, 60));
    clock.advance(20_000);
    app.engine.tick();
    const hv = await hunter.waitView((v) => v.runnerMarkers.length === 1);
    expect(hv.runnerMarkers[0]).toMatchObject({ playerId: runnerJ.playerId, status: 'ok', lat: 48.8585 });
    const toast = await hunter.waitFor((m) => m.type === 'event' && m.event.type === 'ping_revealed');
    expect(toast.type).toBe('event');

    // Capture flow over the wire.
    hunter.send({ type: 'captureRequest', runnerId: runnerJ.playerId });
    const pending = await runner2.waitView((v) => v.captures.some((c) => c.status === 'pending'));
    const captureId = pending.captures.find((c) => c.status === 'pending')!.id;
    runner2.send({ type: 'captureRespond', captureId, accept: true });
    const final = await host.waitView((v) => v.game.status === 'ended');
    expect(final.game.winner).toBe('hunters');
    expect(final.history).toHaveLength(1);
    await runner2.waitFor((m) => m.type === 'stopSharing');

    host.close();
    runner2.close();
    hunter.close();
  });

  it('rejects unauthenticated messages and tokens from another game', async () => {
    const mk = async (name: string) =>
      (await post('/api/games', { hostName: name, settings: DEFAULT_SETTINGS, boundary: null, safetyAck: true })).body as {
        gameId: string;
        token: string;
      };
    const a = await mk('A');
    const b = await mk('B');
    const c = new Client();
    c.ws = new WebSocket(`ws://${base}/ws`);
    await new Promise((r) => c.ws.once('open', r));
    const msgs: ServerMessage[] = [];
    c.ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    c.ws.send(JSON.stringify({ type: 'host.start' }));
    c.ws.send(JSON.stringify({ type: 'auth', gameId: b.gameId, token: a.token }));
    await new Promise((r) => c.ws.once('close', r));
    expect(msgs.map((m) => m.type === 'error' && m.code)).toEqual(['unauthorized', 'unauthorized']);
  });

  it('rate-limits join attempts with bad codes', async () => {
    let limited = false;
    for (let i = 0; i < 40 && !limited; i++) {
      const r = await post('/api/games/ZZZZZ9/join', { name: 'x' }, { 'x-forwarded-for': '9.9.9.9' });
      if (r.status === 429) limited = true;
    }
    expect(limited).toBe(true);
  });
});

describe('behind a trusted proxy', () => {
  it('rate-limits by the proxy-appended hop, so spoofed X-Forwarded-For prefixes do not bypass limits', async () => {
    const config = { ...loadConfig({ NODE_ENV: 'test' }), databasePath: ':memory:', host: '127.0.0.1', staticDir: null, trustProxy: true };
    const proxied = createApp(config, { autoTick: false });
    const port = await proxied.listen(0);
    try {
      let limited = false;
      for (let i = 0; i < 60 && !limited; i++) {
        const res = await fetch(`http://127.0.0.1:${port}/api/games/ZZZZZ9/preview`, {
          headers: { 'x-forwarded-for': `10.0.0.${i}, 203.0.113.7` },
        });
        if (res.status === 429) limited = true;
      }
      expect(limited).toBe(true);
    } finally {
      await proxied.close();
    }
  });
});
