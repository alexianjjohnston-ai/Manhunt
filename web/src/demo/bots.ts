/**
 * DEMO BUILD ONLY: bot players for single-device playtesting. They join through the
 * same API, connect like real clients and send simulated GPS (flagged as simulated).
 */
import { boundaryCenter, destination, distanceM } from '@shared/geo';
import type { ClientMessage, GameView, ServerMessage } from '@shared/protocol';
import type { LatLng } from '@shared/types';
import { api, demoEngine, receive, type DemoConn } from './server';
import { demoSpeed } from './speed';

const NAMES = ['Ash', 'Blair', 'Casey', 'Drew', 'Emery', 'Finley', 'Gray', 'Harper', 'Indy', 'Jules', 'Kai', 'Lane', 'Morgan', 'Nico'];
const TAG_RANGE_M = 20;


class Bot {
  view: GameView | null = null;
  pos: LatLng;
  bearing = Math.random() * 360;
  conn: DemoConn;
  lastClaim = new Map<string, number>();

  constructor(
    public gameId: string,
    public playerId: string,
    token: string,
    center: LatLng,
  ) {
    this.pos = destination(center, Math.random() * 360, 200 + Math.random() * 350);
    this.conn = {
      deliver: (m: ServerMessage) => this.onMessage(m),
      close: () => this.stop(),
    };
    receive(this.conn, JSON.stringify({ type: 'auth', gameId, token }));
    this.send({ type: 'ackSafety' });
    this.send({ type: 'setReady', ready: true });
  }

  timer = window.setInterval(() => this.step(2), 2000);

  stop() {
    window.clearInterval(this.timer);
  }

  send(m: ClientMessage) {
    receive(this.conn, JSON.stringify(m));
  }

  onMessage(m: ServerMessage) {
    if (m.type === 'state') {
      this.view = m.view;
      if (m.view.game.status === 'lobby' && !m.view.me.ready) this.send({ type: 'setReady', ready: true });
      this.reactToCaptures();
    }
    if (m.type === 'pingRequest') this.sendLocation();
    if (m.type === 'kicked') this.stop();
  }

  fixes() {
    return demoEngine.fixesFor(this.gameId);
  }

  /** Runners concede when the claiming hunter is really close, otherwise dispute. */
  reactToCaptures() {
    const v = this.view!;
    for (const c of v.captures) {
      if (c.runnerId !== this.playerId || c.status !== 'pending' || this.lastClaim.has(c.id)) continue;
      this.lastClaim.set(c.id, Date.now());
      const hunter = c.hunterId ? this.fixes().get(c.hunterId) : undefined;
      const close = hunter ? distanceM(hunter, this.pos) <= TAG_RANGE_M * 2 : false;
      window.setTimeout(() => this.send({ type: 'captureRespond', captureId: c.id, accept: close }), 1500 + Math.random() * 1500);
    }
  }

  sendLocation() {
    if (!this.view?.me.shareLocation) return;
    this.send({ type: 'location', lat: this.pos.lat, lng: this.pos.lng, accuracyM: 6 + Math.random() * 10, ageMs: 0, speed: null, simulated: true });
  }

  step(dt: number) {
    const v = this.view;
    if (!v || v.game.status !== 'running' || v.game.paused || v.me.status !== 'active') return;
    const center = v.game.boundary ? boundaryCenter(v.game.boundary) : this.pos;
    const radius = v.game.boundary?.type === 'circle' ? v.game.boundary.radiusM : 600;
    let speed = 1.4 * demoSpeed.value;
    if (v.me.team === 'hunter' && v.game.phase === 'hunting') {
      speed = 2.2 * demoSpeed.value;
      const target = [...v.runnerMarkers].filter((r) => r.lat != null).sort((a, b) => b.revealedAt - a.revealedAt)[0];
      if (target) this.bearing = bearingTo(this.pos, { lat: target.lat!, lng: target.lng! }) + (Math.random() - 0.5) * 40;
      else this.bearing += (Math.random() - 0.5) * 50;
      this.tryTag(v);
    } else if (v.me.team === 'hunter') {
      speed = 0.3; // waiting out the head start
    } else {
      this.bearing += (Math.random() - 0.5) * 60;
    }
    if (distanceM(this.pos, center) > radius * 0.85) this.bearing = bearingTo(this.pos, center);
    this.pos = destination(this.pos, this.bearing, speed * dt);
    this.sendLocation();
  }

  /** A hunter "physically" next to a runner (true simulated positions) claims the tag. */
  tryTag(v: GameView) {
    if (v.captures.some((c) => c.hunterId === this.playerId && (c.status === 'pending' || c.status === 'disputed'))) return;
    for (const p of v.players) {
      if (p.team !== 'runner' || p.status !== 'active') continue;
      const f = this.fixes().get(p.id);
      if (!f || distanceM(f, this.pos) > TAG_RANGE_M) continue;
      if (Date.now() - (this.lastClaim.get(p.id) ?? 0) < 30_000) continue;
      this.lastClaim.set(p.id, Date.now());
      this.send({ type: 'captureRequest', runnerId: p.id });
      return;
    }
  }
}

function bearingTo(from: LatLng, to: LatLng) {
  const dy = to.lat - from.lat;
  const dx = (to.lng - from.lng) * Math.cos((from.lat * Math.PI) / 180);
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

const bots: Bot[] = [];

/** Add `n` bots to a lobby. Returns the names that joined. */
export function addBots(gameId: string, code: string, n: number): string[] {
  const g = demoEngine.getGame(gameId);
  if (!g) return [];
  const center = g.boundary ? boundaryCenter(g.boundary) : { lat: 51.5025, lng: -0.134 };
  const taken = new Set(g.players.map((p) => p.name));
  const added: string[] = [];
  for (const name of NAMES) {
    if (added.length >= n) break;
    if (taken.has(name)) continue;
    const res = api('POST', `/api/games/${code}/join`, { name });
    if (res.status !== 201) break;
    const j = res.json as { playerId: string; token: string };
    bots.push(new Bot(gameId, j.playerId, j.token, center));
    added.push(name);
  }
  return added;
}

/** Host-side helper for the quick demo: put the human on a team and split the bots around them. */
export function arrangeTeams(gameId: string, hostId: string, role: 'runner' | 'hunter') {
  const g = demoEngine.getGame(gameId);
  if (!g) return;
  const others = g.players.filter((p) => p.id !== hostId && p.status === 'active' && p.team !== 'spectator');
  const total = others.length + 1;
  const runnersWanted = Math.floor(total / 2) || 1;
  const send = (playerId: string, team: 'runner' | 'hunter') => demoEngine.handle(gameId, hostId, { type: 'host.setTeam', playerId, team });
  send(hostId, role);
  let runners = role === 'runner' ? 1 : 0;
  for (const p of others) {
    const team = runners < runnersWanted ? 'runner' : 'hunter';
    if (team === 'runner') runners++;
    send(p.id, team);
  }
  for (const p of others) demoEngine.handle(gameId, p.id, { type: 'setReady', ready: true });
}
