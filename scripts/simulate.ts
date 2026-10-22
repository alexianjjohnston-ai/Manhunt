/**
 * SIMULATION MODE (development / testing only).
 *
 * Plays a complete game against a running MANHUNT server with fictional bot players
 * walking simulated GPS paths. Every location the bots send is flagged `simulated`,
 * so the server must be started with ALLOW_SIMULATION=true (the default outside
 * production).
 *
 *   npm run dev:server                      # terminal 1
 *   npm run simulate -- --players 6         # terminal 2
 *
 * Options:
 *   --url http://localhost:8787   server base URL
 *   --players 6                   number of bots (incl. the bot host)
 *   --interval 30                 ping interval in seconds (needs ALLOW_FAST_PINGS below 60)
 *   --duration 10                 game length in minutes
 *   --wait 0                      seconds to wait in the lobby so humans can join with the code
 *   --lat 51.5007 --lng -0.1246   centre of the play area
 *   --speedup 1                   multiplies bot movement speed (not game time)
 */
import WebSocket from 'ws';
import { destination, distanceM } from '../shared/geo';
import type { ClientMessage, GameView, ServerMessage } from '../shared/protocol';
import type { LatLng } from '../shared/types';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1] ?? '');
const URL_BASE = args.get('url') ?? 'http://localhost:8787';
const N = Number(args.get('players') ?? 6);
const INTERVAL = Number(args.get('interval') ?? 30);
const DURATION = Number(args.get('duration') ?? 10);
const WAIT = Number(args.get('wait') ?? 0);
const SPEEDUP = Number(args.get('speedup') ?? 1);
const CENTER: LatLng = { lat: Number(args.get('lat') ?? 51.5007), lng: Number(args.get('lng') ?? -0.1246) };
const RADIUS = 900;
const NAMES = ['Ash', 'Blair', 'Casey', 'Drew', 'Emery', 'Finley', 'Gray', 'Harper', 'Indy', 'Jules', 'Kai', 'Lane'];

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(URL_BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${path}: ${json.error}`);
  return json;
}

class Bot {
  ws!: WebSocket;
  view: GameView | null = null;
  pos: LatLng;
  bearing = Math.random() * 360;
  timer: NodeJS.Timeout | null = null;

  constructor(
    public name: string,
    public gameId: string,
    public token: string,
    public playerId: string,
  ) {
    this.pos = destination(CENTER, Math.random() * 360, Math.random() * RADIUS * 0.6);
  }

  connect(onState?: (b: Bot) => void) {
    return new Promise<void>((resolve) => {
      this.ws = new WebSocket(URL_BASE.replace(/^http/, 'ws') + '/ws');
      this.ws.on('open', () => this.send({ type: 'auth', gameId: this.gameId, token: this.token }));
      this.ws.on('message', (d) => {
        const m = JSON.parse(d.toString()) as ServerMessage;
        if (m.type === 'welcome') resolve();
        if (m.type === 'state') {
          this.view = m.view;
          onState?.(this);
        }
        if (m.type === 'event' && this.playerId === hostId) log(`[event] ${m.event.text}`);
        if (m.type === 'error') log(`[${this.name}] error: ${m.message}`);
        if (m.type === 'pingRequest') this.sendLocation();
      });
    });
  }

  send(m: ClientMessage) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  get team() {
    return this.view?.me.team;
  }

  sendLocation() {
    if (!this.view?.me.shareLocation) return;
    this.send({ type: 'location', lat: this.pos.lat, lng: this.pos.lng, accuracyM: 5 + Math.random() * 15, ageMs: 0, speed: null, simulated: true });
  }

  /** Runners wander on foot; hunters walk/jog toward the freshest revealed runner. */
  step(dt: number) {
    const v = this.view;
    if (!v || v.game.status !== 'running' || v.game.paused || v.me.status !== 'active') return;
    let speed = 1.4 * SPEEDUP;
    if (this.team === 'hunter') {
      speed = 2.5 * SPEEDUP;
      const target = v.runnerMarkers.filter((m) => m.lat != null).sort((a, b) => b.revealedAt - a.revealedAt)[0];
      if (target && v.game.phase === 'hunting') {
        const dy = target.lat! - this.pos.lat;
        const dx = (target.lng! - this.pos.lng) * Math.cos((this.pos.lat * Math.PI) / 180);
        this.bearing = (Math.atan2(dx, dy) * 180) / Math.PI + (Math.random() - 0.5) * 30;
      } else this.bearing += (Math.random() - 0.5) * 40;
    } else {
      this.bearing += (Math.random() - 0.5) * 50;
    }
    if (distanceM(this.pos, CENTER) > RADIUS * 0.9) {
      const dy = CENTER.lat - this.pos.lat;
      const dx = (CENTER.lng - this.pos.lng) * Math.cos((this.pos.lat * Math.PI) / 180);
      this.bearing = (Math.atan2(dx, dy) * 180) / Math.PI;
    }
    this.pos = destination(this.pos, this.bearing, speed * dt);
    this.sendLocation();
  }
}

let hostId = '';

async function main() {
  log(`Simulating ${N} bots against ${URL_BASE} (ping every ${INTERVAL}s, ${DURATION} min)`);
  const created = await post<{ gameId: string; code: string; token: string; playerId: string }>('/api/games', {
    hostName: 'SimHost',
    settings: {
      name: 'Simulation',
      maxPlayers: Math.max(N + 4, 8),
      durationMin: DURATION,
      pingIntervalSec: INTERVAL,
      headStartMin: 1,
      revealAtHeadStartEnd: true,
      teamAssignment: 'auto',
      extraPlayerTeam: 'hunter',
      captureMethod: 'runner_confirm',
      tagCodeEnabled: true,
      allowSpectators: true,
      hunterTeammatesVisible: true,
      runnerTeammatesVisible: true,
      lobbyLocked: false,
    },
    boundary: { type: 'circle', center: CENTER, radiusM: RADIUS },
    safetyAck: true,
  });
  hostId = created.playerId;
  log(`Game code ${created.code}. Humans can join at ${URL_BASE}/join/${created.code}`);

  const bots = [new Bot('SimHost', created.gameId, created.token, created.playerId)];
  for (let i = 1; i < N; i++) {
    const name = NAMES[i % NAMES.length]! + (i >= NAMES.length ? i : '');
    const j = await post<{ token: string; playerId: string }>(`/api/games/${created.code}/join`, { name });
    bots.push(new Bot(name, created.gameId, j.token, j.playerId));
  }
  const host = bots[0]!;
  const byId = new Map(bots.map((b) => [b.playerId, b]));

  // Bots react to capture requests: usually confirm, sometimes dispute (host then decides).
  const handled = new Set<string>();
  const onState = (b: Bot) => {
    const v = b.view!;
    for (const c of v.captures) {
      if (c.runnerId === b.playerId && c.status === 'pending' && !handled.has(c.id)) {
        handled.add(c.id);
        const accept = Math.random() < 0.8;
        setTimeout(() => b.send({ type: 'captureRespond', captureId: c.id, accept }), 1500);
      }
      if (b === host && c.status === 'disputed' && !handled.has(`d:${c.id}`)) {
        handled.add(`d:${c.id}`);
        const hunter = byId.get(c.hunterId ?? '');
        const runner = byId.get(c.runnerId);
        const close = hunter && runner && distanceM(hunter.pos, runner.pos) < 25;
        setTimeout(() => b.send({ type: 'host.resolveCapture', captureId: c.id, confirm: !!close }), 2000);
      }
    }
  };
  await Promise.all(bots.map((b) => b.connect(onState)));
  for (const b of bots) {
    b.send({ type: 'ackSafety' });
    if (b !== host) b.send({ type: 'setReady', ready: true });
  }
  if (WAIT > 0) {
    log(`Waiting ${WAIT}s for humans to join…`);
    await new Promise((r) => setTimeout(r, WAIT * 1000));
  }
  await new Promise((r) => setTimeout(r, 500));
  host.send({ type: 'host.start', force: true });

  let last = Date.now();
  const loop = setInterval(() => {
    const now = Date.now();
    const dt = (now - last) / 1000;
    last = now;
    for (const b of bots) b.step(dt);
    // Hunters "tag" a runner when physically (simulated) within 15 m.
    for (const h of bots.filter((b) => b.team === 'hunter' && b.view?.me.status === 'active')) {
      for (const r of bots.filter((b) => b.team === 'runner' && b.view?.me.status === 'active')) {
        if (distanceM(h.pos, r.pos) < 15 && !h.view!.captures.some((c) => c.hunterId === h.playerId && c.status === 'pending')) {
          if (Math.random() < 0.5 && r.view?.me.tagCode) h.send({ type: 'captureByCode', code: r.view.me.tagCode });
          else h.send({ type: 'captureRequest', runnerId: r.playerId });
        }
      }
    }
    if (host.view?.game.status === 'ended') {
      clearInterval(loop);
      const v = host.view;
      log(`GAME OVER: ${v.game.winner} — ${v.game.endReason}`);
      log(`Pings: ${v.game.pingCount}, captures: ${v.captures.filter((c) => c.status === 'confirmed').length}`);
      for (const b of bots) b.ws.close();
      process.exit(0);
    }
  }, 3000);

  const statusTimer = setInterval(() => {
    const v = host.view;
    if (!v || v.game.status !== 'running') return;
    const free = v.players.filter((p) => p.team === 'runner' && p.status === 'active').length;
    log(`status: phase=${v.game.phase} pings=${v.game.pingCount} free runners=${free}`);
  }, 30_000);
  statusTimer.unref();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
