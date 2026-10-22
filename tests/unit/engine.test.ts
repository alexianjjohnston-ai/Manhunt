import { describe, expect, it } from 'vitest';
import { GameError } from '../../server/engine';
import { BASE, locate, makeEngine, run, send, setupGame, view } from '../helpers';

const MIN = 60_000;
const TEAMS = { Host: 'hunter', H2: 'hunter', R1: 'runner', R2: 'runner' } as const;

function startedGame(settings = {}) {
  const h = makeEngine();
  const t = setupGame(h, ['Host', 'H2', 'R1', 'R2'], { headStartMin: 5, pingIntervalSec: 300, durationMin: 60, ...settings }, { ...TEAMS });
  send(h, t.game, t.host, { type: 'host.start' });
  return { h, ...t };
}

const err = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(GameError);
    return (e as GameError).code;
  }
  throw new Error('expected GameError');
};

describe('private room creation and joining', () => {
  it('creates a game with a 6-char code and a hashed host token', () => {
    const h = makeEngine();
    const { game, token } = h.engine.createGame({
      hostName: 'Alex',
      settings: { name: 'Friday Night', maxPlayers: 6, durationMin: 30, pingIntervalSec: 300, headStartMin: 3, revealAtHeadStartEnd: false, teamAssignment: 'auto', extraPlayerTeam: 'hunter', captureMethod: 'runner_confirm', tagCodeEnabled: true, allowSpectators: false, hunterTeammatesVisible: true, runnerTeammatesVisible: true, lobbyLocked: false },
      boundary: null,
      safetyAck: true,
    });
    expect(game.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(JSON.stringify(game)).not.toContain(token);
    expect(game.players[0]!.tokenHash).not.toBe(token);
  });

  it('requires the safety acknowledgement to create', () => {
    const h = makeEngine();
    expect(err(() => h.engine.createGame({ hostName: 'A', settings: {}, boundary: null }))).toBe('invalid');
  });

  it('rejects unknown codes, wrong passwords, full games, locked lobbies and duplicate names', () => {
    const h = makeEngine();
    const { game } = h.engine.createGame({
      hostName: 'Host',
      settings: { name: 'G', maxPlayers: 2, durationMin: 30, pingIntervalSec: 300, headStartMin: 0, revealAtHeadStartEnd: false, teamAssignment: 'auto', extraPlayerTeam: 'hunter', captureMethod: 'runner_confirm', tagCodeEnabled: true, allowSpectators: false, hunterTeammatesVisible: true, runnerTeammatesVisible: true, lobbyLocked: false },
      boundary: null,
      password: 'secret',
      safetyAck: true,
    });
    expect(err(() => h.engine.joinGame('ZZZZZZ', { name: 'X' }))).toBe('not_found');
    expect(err(() => h.engine.joinGame(game.code, { name: 'X', password: 'nope' }))).toBe('bad_password');
    expect(err(() => h.engine.joinGame(game.code, { name: 'host', password: 'secret' }))).toBe('name_taken');
    h.engine.joinGame(game.code, { name: 'B', password: 'secret' });
    expect(err(() => h.engine.joinGame(game.code, { name: 'C', password: 'secret' }))).toBe('full');
    game.settings.maxPlayers = 10;
    game.settings.lobbyLocked = true;
    expect(err(() => h.engine.joinGame(game.code, { name: 'C', password: 'secret' }))).toBe('locked');
  });

  it('blocks joining a started game unless spectators are allowed', () => {
    const { h, game } = startedGame();
    expect(err(() => h.engine.joinGame(game.code, { name: 'Late' }))).toBe('in_progress');
    game.settings.allowSpectators = true;
    const j = h.engine.joinGame(game.code, { name: 'Late' });
    expect(j.player.team).toBe('spectator');
  });

  it('auto-assigns joiners to keep teams balanced with the extra going to hunters', () => {
    const h = makeEngine();
    const t = setupGame(h, ['A', 'B', 'C', 'D', 'E']);
    const teams = t.game.players.map((p) => p.team);
    expect(teams.filter((x) => x === 'runner').length).toBe(2);
    expect(teams.filter((x) => x === 'hunter').length).toBe(3);
  });
});

describe('reconnection', () => {
  it('re-authenticates the same player with their token (no duplicates)', () => {
    const h = makeEngine();
    const t = setupGame(h, ['Host', 'Bob']);
    const before = t.game.players.length;
    const a = h.engine.authenticate(t.game.id, t.tokens.Bob!);
    const b = h.engine.authenticate(t.game.id, t.tokens.Bob!);
    expect(a.player.id).toBe(t.ids.Bob);
    expect(b.player.id).toBe(t.ids.Bob);
    expect(t.game.players.length).toBe(before);
  });

  it('rejects bad tokens, kicked and departed players', () => {
    const h = makeEngine();
    const t = setupGame(h, ['Host', 'Bob', 'Cat']);
    expect(err(() => h.engine.authenticate(t.game.id, 'x'.repeat(43)))).toBe('unauthorized');
    send(h, t.game, t.host, { type: 'host.kick', playerId: t.ids.Bob! });
    expect(err(() => h.engine.authenticate(t.game.id, t.tokens.Bob!))).toBe('kicked');
    send(h, t.game, t.ids.Cat!, { type: 'leave' });
    expect(err(() => h.engine.authenticate(t.game.id, t.tokens.Cat!))).toBe('left');
  });

  it('survives a server restart (state persisted to SQLite)', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const db = join(mkdtempSync(join(tmpdir(), 'mh-')), 'test.db');
    const h1 = makeEngine({ dbPath: db });
    const t = setupGame(h1, ['Host', 'H2', 'R1', 'R2'], { headStartMin: 0, pingIntervalSec: 60 }, { ...TEAMS });
    send(h1, t.game, t.host, { type: 'host.start' });
    run(h1, 30_000);
    h1.store.close();
    const h2 = makeEngine({ dbPath: db, clock: h1.clock });
    const g = h2.engine.getGame(t.game.id)!;
    expect(g.status).toBe('running');
    expect(h2.engine.authenticate(g.id, t.tokens.R1!).player.id).toBe(t.ids.R1);
    // Live fixes are memory-only: none survive the restart.
    expect(h2.engine.fixesFor(g.id).size).toBe(0);
    run(h2, 31_000);
    expect(g.reveals.length).toBe(1);
  });
});

describe('host permissions', () => {
  it('rejects every host.* message from non-hosts', () => {
    const h = makeEngine();
    const t = setupGame(h, ['Host', 'Bob', 'Cat']);
    const msgs = [
      { type: 'host.start' },
      { type: 'host.balanceTeams' },
      { type: 'host.kick', playerId: t.host },
      { type: 'host.transferHost', playerId: t.ids.Bob! },
      { type: 'host.setTeam', playerId: t.ids.Bob!, team: 'runner' },
      { type: 'host.updateSettings', settings: { durationMin: 10 } },
      { type: 'host.end' },
      { type: 'host.announce', text: 'hi' },
    ] as const;
    for (const m of msgs) expect(err(() => send(h, t.game, t.ids.Bob!, m as never))).toBe('forbidden');
  });

  it('transfers host and the old host loses privileges', () => {
    const h = makeEngine();
    const t = setupGame(h, ['Host', 'Bob', 'Cat']);
    send(h, t.game, t.host, { type: 'host.transferHost', playerId: t.ids.Bob! });
    expect(t.game.hostId).toBe(t.ids.Bob);
    expect(err(() => send(h, t.game, t.host, { type: 'host.balanceTeams' }))).toBe('forbidden');
  });

  it('auto-transfers host when the host leaves', () => {
    const h = makeEngine();
    const t = setupGame(h, ['Host', 'Bob', 'Cat']);
    send(h, t.game, t.host, { type: 'leave' });
    expect(t.game.hostId).not.toBe(t.host);
    expect(t.game.players.find((p) => p.id === t.game.hostId)!.status).toBe('active');
  });

  it('will not start without both teams and safety acknowledgements', () => {
    const h = makeEngine();
    const t = setupGame(h, ['Host', 'Bob'], { teamAssignment: 'manual' });
    expect(err(() => send(h, t.game, t.host, { type: 'host.start' }))).toBe('cannot_start');
    send(h, t.game, t.host, { type: 'host.setTeam', playerId: t.host, team: 'hunter' });
    send(h, t.game, t.host, { type: 'host.setTeam', playerId: t.ids.Bob!, team: 'runner' });
    // setTeam resets readiness; force skips the ready check only.
    send(h, t.game, t.host, { type: 'host.start', force: true });
    expect(t.game.status).toBe('running');
  });

  it('requires ready players unless forced', () => {
    const h = makeEngine();
    const t = setupGame(h, ['Host', 'Bob', 'Cat', 'Dee']);
    send(h, t.game, t.ids.Cat!, { type: 'setReady', ready: false });
    const code = err(() => send(h, t.game, t.host, { type: 'host.start' }));
    expect(code).toBe('cannot_start');
  });

  it('enforces the production minimum ping interval when fast pings are disabled', () => {
    const h = makeEngine({ allowFastPings: false });
    expect(() => setupGame(h, ['Host'], { pingIntervalSec: 30 })).toThrow(/at least 60/);
  });
});

describe('server-authoritative timers and pings', () => {
  it('reveals every 5 minutes after the head start, simultaneously for all runners', () => {
    const { h, game, ids } = startedGame();
    const reveals: number[] = [];
    run(h, 61 * MIN, () => {
      locate(h, game, ids.R1!, BASE.lat + 0.001, BASE.lng);
      locate(h, game, ids.R2!, BASE.lat - 0.001, BASE.lng);
      if (game.reveals.length > reveals.length) reveals.push(game.reveals.at(-1)!.elapsedMs);
    });
    // head start 5 → pings at 10, 15, … 55 min; game ends at 60.
    expect(reveals).toEqual([10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => m * MIN));
    for (const r of game.reveals) {
      expect(r.entries.map((e) => e.playerId).sort()).toEqual([ids.R1, ids.R2].sort());
      expect(r.entries.every((e) => e.status === 'ok')).toBe(true);
    }
    expect(game.status).toBe('ended');
    expect(game.winner).toBe('runners');
  });

  it('asks runners for a fresh fix 30 s before each reveal', () => {
    const { h, game, ids } = startedGame();
    run(h, 10 * MIN - 31_000);
    expect(h.sent.filter((s) => s.msg.type === 'pingRequest')).toHaveLength(0);
    run(h, 2_000);
    const reqs = h.sent.filter((s) => s.msg.type === 'pingRequest');
    expect(reqs.map((r) => r.playerId).sort()).toEqual([ids.R1, ids.R2].sort());
  });

  it('pausing freezes the clock and the ping schedule; device clocks are irrelevant', () => {
    const { h, game, host } = startedGame();
    run(h, 9 * MIN);
    send(h, game, host, { type: 'host.pause' });
    run(h, 30 * MIN);
    expect(game.reveals.length).toBe(0);
    send(h, game, host, { type: 'host.resume' });
    run(h, 1 * MIN);
    expect(game.reveals.length).toBe(1);
    expect(game.reveals[0]!.elapsedMs).toBe(10 * MIN);
  });

  it('supports an optional reveal at the end of the head start', () => {
    const { h, game } = startedGame({ revealAtHeadStartEnd: true });
    run(h, 5 * MIN);
    expect(game.reveals.length).toBe(1);
    expect(game.reveals[0]!.elapsedMs).toBe(5 * MIN);
  });

  it('host can change the ping interval mid-game', () => {
    const { h, game, host } = startedGame();
    run(h, 10 * MIN); // ping #1 at 10m
    send(h, game, host, { type: 'host.updateSettings', settings: { pingIntervalSec: 120 } });
    run(h, 2 * MIN);
    expect(game.reveals.map((r) => r.elapsedMs)).toEqual([10 * MIN, 12 * MIN]);
  });

  it('collapses missed slots after downtime instead of bursting', () => {
    const { h, game } = startedGame();
    h.clock.advance(23 * MIN); // server "down", no ticks
    h.engine.tick();
    expect(game.reveals.length).toBe(1);
    expect(game.nextPingElapsed).toBe(25 * MIN);
  });
});

describe('location visibility (no premature or live runner access)', () => {
  it('hunters never see live runner positions, only reveal snapshots', () => {
    const { h, game, ids } = startedGame();
    locate(h, game, ids.R1!, 51.501, -0.124);
    locate(h, game, ids.H2!, 51.49, -0.12);
    let v = view(h, game, ids.Host!);
    expect(v.runnerMarkers).toHaveLength(0);
    expect(v.live.map((l) => l.playerId)).toEqual([ids.H2]); // teammate hunter only
    expect(JSON.stringify(v)).not.toContain('51.501');

    run(h, 10 * MIN - 1000, () => locate(h, game, ids.R1!, 51.501, -0.124));
    v = view(h, game, ids.Host!);
    expect(v.runnerMarkers).toHaveLength(0);

    run(h, 1000);
    v = view(h, game, ids.Host!);
    const m = v.runnerMarkers.find((x) => x.playerId === ids.R1)!;
    expect(m.status).toBe('ok');
    expect(m.lat).toBe(51.501);

    // Runner moves; hunters keep the old coordinates until the next reveal.
    run(h, 2 * MIN, () => locate(h, game, ids.R1!, 51.51, -0.13));
    v = view(h, game, ids.Host!);
    expect(v.runnerMarkers.find((x) => x.playerId === ids.R1)!.lat).toBe(51.501);
    expect(JSON.stringify(v)).not.toContain('51.51,');
    expect(v.history).toHaveLength(0);
  });

  it('runners never receive hunter coordinates', () => {
    const { h, game, ids } = startedGame();
    locate(h, game, ids.H2!, 51.4321, -0.1234);
    locate(h, game, ids.Host!, 51.4322, -0.1235);
    locate(h, game, ids.R2!, 51.5, -0.12);
    const v = view(h, game, ids.R1!);
    expect(v.live.map((l) => l.playerId)).toEqual([ids.R2]);
    expect(JSON.stringify(v)).not.toContain('51.432');
  });

  it('respects teammate visibility settings', () => {
    const { h, game, ids, host } = startedGame();
    send(h, game, host, { type: 'host.updateSettings', settings: { runnerTeammatesVisible: false, hunterTeammatesVisible: false } });
    locate(h, game, ids.R2!, 51.5, -0.12);
    locate(h, game, ids.H2!, 51.5, -0.12);
    expect(view(h, game, ids.R1!).live).toHaveLength(0);
    expect(view(h, game, ids.Host!).live).toHaveLength(0);
  });

  it('host health info has no coordinates', () => {
    const { h, game, ids } = startedGame();
    locate(h, game, ids.R1!, 51.4999, -0.1111);
    const v = view(h, game, ids.Host!);
    expect(v.players.find((p) => p.id === ids.R1)!.health!.accuracyM).toBe(8);
    expect(JSON.stringify(v)).not.toContain('51.4999');
  });

  it('captured runners and spectators get no locations', () => {
    const { h, game, ids, host } = startedGame();
    game.settings.allowSpectators = true;
    const spec = h.engine.joinGame(game.code, { name: 'Spec' }).player.id;
    run(h, 10 * MIN, () => {
      locate(h, game, ids.R1!, 51.501, -0.124);
      locate(h, game, ids.R2!, 51.502, -0.124);
    });
    send(h, game, host, { type: 'host.setCaptured', playerId: ids.R1!, captured: true });
    for (const who of [ids.R1!, spec]) {
      const v = view(h, game, who);
      expect(v.live).toHaveLength(0);
      expect(v.runnerMarkers).toHaveLength(0);
      expect(v.history).toHaveLength(0);
      expect(JSON.stringify(v)).not.toContain('51.501');
      expect(JSON.stringify(v)).not.toContain('51.502');
    }
  });

  it('full reveal history is only included after the game ends', () => {
    const { h, game, ids, host } = startedGame();
    run(h, 10 * MIN, () => locate(h, game, ids.R1!, 51.501, -0.124));
    expect(view(h, game, ids.Host!).history).toHaveLength(0);
    send(h, game, host, { type: 'host.end' });
    expect(view(h, game, ids.R2!).history).toHaveLength(1);
  });
});

describe('missing and stale GPS', () => {
  it('marks a runner with no fix as missed (no fabricated coordinates)', () => {
    const { h, game, ids } = startedGame();
    run(h, 10 * MIN, () => locate(h, game, ids.R1!, 51.501, -0.124));
    const r = game.reveals[0]!;
    const e2 = r.entries.find((e) => e.playerId === ids.R2)!;
    expect(e2.status).toBe('missed');
    expect(e2.lat).toBeUndefined();
    expect(e2.reason).toBe('No GPS fix received');
  });

  it('classifies an old fix as stale and a very old fix as missed', () => {
    const { h, game, ids } = startedGame();
    run(h, 10 * MIN - 120_000);
    locate(h, game, ids.R1!, 51.501, -0.124, 10); // 2 min before reveal → stale (fresh ≤ 90s)
    locate(h, game, ids.R2!, 51.502, -0.124, 10, 0);
    run(h, 120_000);
    const r1 = game.reveals[0]!.entries.find((e) => e.playerId === ids.R1)!;
    expect(r1.status).toBe('stale');
    expect(r1.lat).toBe(51.501);
    run(h, 5 * MIN); // no new fixes: >5 min old now → missed
    const r2 = game.reveals[1]!.entries.find((e) => e.playerId === ids.R1)!;
    expect(r2.status).toBe('missed');
    // Hunters still see the last successful reveal, flagged as last-known, not current.
    const m = view(h, game, ids.Host!).runnerMarkers.find((x) => x.playerId === ids.R1)!;
    expect(m.status).toBe('missed');
    expect(m.lat).toBeUndefined();
    expect(m.lastKnown?.lat).toBe(51.501);
    expect(m.lastKnown?.seq).toBe(1);
  });

  it('uses the device-reported fix age, not arrival time', () => {
    const { h, game, ids } = startedGame();
    run(h, 10 * MIN - 1000);
    locate(h, game, ids.R1!, 51.501, -0.124, 10, 100_000); // measured 100 s ago
    run(h, 1000);
    expect(game.reveals[0]!.entries.find((e) => e.playerId === ids.R1)!.status).toBe('stale');
  });

  it('location sharing opt-out drops the fix and reports the reason', () => {
    const { h, game, ids } = startedGame();
    run(h, 9 * MIN, () => locate(h, game, ids.R1!, 51.501, -0.124));
    send(h, game, ids.R1!, { type: 'gpsStatus', state: 'off' });
    expect(h.engine.fixesFor(game.id).has(ids.R1!)).toBe(false);
    run(h, 1 * MIN);
    const e = game.reveals[0]!.entries.find((x) => x.playerId === ids.R1)!;
    expect(e.status).toBe('missed');
    expect(e.reason).toMatch(/paused/);
  });

  it('ignores locations outside an active game (lobby, ended, captured)', () => {
    const h = makeEngine();
    const t = setupGame(h, ['Host', 'H2', 'R1', 'R2'], {}, { ...TEAMS });
    locate(h, t.game, t.ids.R1!, 51.5, -0.12);
    expect(h.engine.fixesFor(t.game.id).size).toBe(0);
  });

  it('flags implausible runner speed and out-of-bounds as host-only warnings', () => {
    const { h, game, ids } = startedGame();
    locate(h, game, ids.R1!, BASE.lat, BASE.lng, 5);
    h.clock.advance(10_000);
    locate(h, game, ids.R1!, BASE.lat + 0.01, BASE.lng, 5); // ~1.1 km in 10 s
    h.clock.advance(1000);
    locate(h, game, ids.R1!, BASE.lat + 0.05, BASE.lng, 5); // outside 2 km circle
    const warnings = game.events.filter((e) => e.type === 'warning');
    expect(warnings.length).toBe(2);
    expect(warnings.every((w) => w.visibility === 'host')).toBe(true);
    expect(view(h, game, ids.R2!).events.some((e) => e.type === 'warning')).toBe(false);
    expect(game.players.find((p) => p.id === ids.R1)!.status).toBe('active'); // warnings never penalise
  });
});

describe('captures', () => {
  function hunting() {
    const s = startedGame();
    run(s.h, 5 * MIN);
    return s;
  }

  it('hunter requests, runner confirms, runner is removed from future pings', () => {
    const { h, game, ids } = hunting();
    locate(h, game, ids.R1!, 51.501, -0.124);
    send(h, game, ids.H2!, { type: 'captureRequest', runnerId: ids.R1! });
    const c = game.captures[0]!;
    expect(c.status).toBe('pending');
    expect(view(h, game, ids.R1!).captures.map((x) => x.id)).toContain(c.id);
    expect(view(h, game, ids.R2!).captures).toHaveLength(0);
    send(h, game, ids.R1!, { type: 'captureRespond', captureId: c.id, accept: true });
    expect(c.status).toBe('confirmed');
    expect(game.players.find((p) => p.id === ids.R1)!.status).toBe('captured');
    expect(h.engine.fixesFor(game.id).has(ids.R1!)).toBe(false);
    expect(h.sent.some((s) => s.playerId === ids.R1 && s.msg.type === 'stopSharing')).toBe(true);
    locate(h, game, ids.R1!, 51.6, -0.1); // ignored
    run(h, 5 * MIN);
    expect(game.reveals[0]!.entries.map((e) => e.playerId)).toEqual([ids.R2]);
  });

  it('only active hunters can request; runners cannot capture; not during head start', () => {
    const s = startedGame();
    expect(err(() => send(s.h, s.game, s.ids.H2!, { type: 'captureRequest', runnerId: s.ids.R1! }))).toBe('headstart');
    run(s.h, 5 * MIN);
    expect(err(() => send(s.h, s.game, s.ids.R2!, { type: 'captureRequest', runnerId: s.ids.R1! }))).toBe('forbidden');
    expect(err(() => send(s.h, s.game, s.ids.H2!, { type: 'captureRequest', runnerId: s.ids.Host! }))).toBe('invalid');
  });

  it('only the targeted runner can confirm', () => {
    const { h, game, ids } = hunting();
    send(h, game, ids.H2!, { type: 'captureRequest', runnerId: ids.R1! });
    const c = game.captures[0]!;
    expect(err(() => send(h, game, ids.R2!, { type: 'captureRespond', captureId: c.id, accept: true }))).toBe('not_found');
    expect(err(() => send(h, game, ids.H2!, { type: 'captureRespond', captureId: c.id, accept: true }))).toBe('not_found');
    expect(c.status).toBe('pending');
  });

  it('disputes go to the host, who can confirm or reject', () => {
    const { h, game, ids, host } = hunting();
    send(h, game, ids.H2!, { type: 'captureRequest', runnerId: ids.R1! });
    const c = game.captures[0]!;
    send(h, game, ids.R1!, { type: 'captureRespond', captureId: c.id, accept: false });
    expect(c.status).toBe('disputed');
    expect(view(h, game, host).captures.map((x) => x.id)).toContain(c.id);
    send(h, game, host, { type: 'host.resolveCapture', captureId: c.id, confirm: false });
    expect(c.status).toBe('rejected');
    expect(game.players.find((p) => p.id === ids.R1)!.status).toBe('active');
  });

  it('prevents duplicate requests and double confirmation races', () => {
    const { h, game, ids, host } = hunting();
    send(h, game, ids.H2!, { type: 'captureRequest', runnerId: ids.R1! });
    expect(err(() => send(h, game, host, { type: 'captureRequest', runnerId: ids.R1! }))).toBe('duplicate');
    const c = game.captures[0]!;
    send(h, game, ids.R1!, { type: 'captureRespond', captureId: c.id, accept: true });
    expect(err(() => send(h, game, ids.R1!, { type: 'captureRespond', captureId: c.id, accept: true }))).toBe('stale');
    expect(err(() => send(h, game, host, { type: 'host.resolveCapture', captureId: c.id, confirm: true }))).toBe('stale');
    expect(game.events.filter((e) => e.type === 'runner_captured')).toHaveLength(1);
  });

  it('pending requests expire', () => {
    const { h, game, ids } = hunting();
    send(h, game, ids.H2!, { type: 'captureRequest', runnerId: ids.R1! });
    run(h, 91_000);
    expect(game.captures[0]!.status).toBe('expired');
  });

  it('tag codes capture instantly and are rate limited', () => {
    const { h, game, ids } = hunting();
    const code = game.players.find((p) => p.id === ids.R2)!.tagCode;
    expect(view(h, game, ids.R2!).me.tagCode).toBe(code);
    expect(view(h, game, ids.H2!).me.tagCode).toBeUndefined();
    expect(JSON.stringify(view(h, game, ids.H2!))).not.toContain(`"tagCode"`);
    const wrong = code === '0000' ? '0001' : '0000';
    expect(err(() => send(h, game, ids.H2!, { type: 'captureByCode', code: wrong }))).toBe('bad_code');
    send(h, game, ids.H2!, { type: 'captureByCode', code });
    expect(game.players.find((p) => p.id === ids.R2)!.status).toBe('captured');
    for (let i = 0; i < 3; i++) err(() => send(h, game, ids.H2!, { type: 'captureByCode', code: wrong }));
    expect(err(() => send(h, game, ids.H2!, { type: 'captureByCode', code: wrong }))).toBe('rate_limited');
  });

  it('hunters win when the last runner is captured', () => {
    const { h, game, ids, host } = hunting();
    send(h, game, host, { type: 'host.setCaptured', playerId: ids.R1!, captured: true });
    expect(game.status).toBe('running');
    send(h, game, host, { type: 'host.setCaptured', playerId: ids.R2!, captured: true });
    expect(game.status).toBe('ended');
    expect(game.winner).toBe('hunters');
  });

  it('host can release a wrongly captured runner', () => {
    const { h, game, ids, host } = hunting();
    send(h, game, host, { type: 'host.setCaptured', playerId: ids.R1!, captured: true });
    send(h, game, host, { type: 'host.setCaptured', playerId: ids.R1!, captured: false });
    expect(game.players.find((p) => p.id === ids.R1)!.status).toBe('active');
  });

  it('confirmation after the game ended is rejected', () => {
    const { h, game, ids, host } = hunting();
    send(h, game, ids.H2!, { type: 'captureRequest', runnerId: ids.R1! });
    const c = game.captures[0]!;
    send(h, game, host, { type: 'host.end' });
    expect(err(() => send(h, game, ids.R1!, { type: 'captureRespond', captureId: c.id, accept: true }))).toBe('wrong_state');
    expect(c.status).toBe('cancelled');
  });
});

describe('game termination and safety', () => {
  it('ending stops all location sharing immediately', () => {
    const { h, game, ids, host } = startedGame();
    locate(h, game, ids.R1!, 51.5, -0.12);
    send(h, game, host, { type: 'host.end', winner: 'none' });
    expect(game.status).toBe('ended');
    expect(h.engine.fixesFor(game.id).size).toBe(0);
    const stops = new Set(h.sent.filter((s) => s.msg.type === 'stopSharing').map((s) => s.playerId));
    expect(stops.size).toBe(4);
    expect(view(h, game, ids.R1!).me.shareLocation).toBe(false);
  });

  it('any player can trigger an emergency stop that pauses and halts sharing', () => {
    const { h, game, ids, host } = startedGame();
    locate(h, game, ids.R1!, 51.5, -0.12);
    send(h, game, ids.R2!, { type: 'emergencyStop' });
    expect(game.emergency?.byId).toBe(ids.R2);
    expect(game.clock.pausedAt).not.toBeNull();
    expect(h.engine.fixesFor(game.id).size).toBe(0);
    locate(h, game, ids.R1!, 51.5, -0.12);
    expect(h.engine.fixesFor(game.id).size).toBe(0);
    expect(view(h, game, ids.H2!).me.shareLocation).toBe(false);
    run(h, 30 * MIN);
    expect(game.reveals).toHaveLength(0);
    send(h, game, host, { type: 'host.resume' });
    expect(game.emergency).toBeNull();
  });

  it('runners leaving counts toward the hunters win; leaving stops sharing', () => {
    const { h, game, ids } = startedGame();
    send(h, game, ids.R1!, { type: 'leave' });
    expect(h.sent.some((s) => s.playerId === ids.R1 && s.msg.type === 'stopSharing')).toBe(true);
    send(h, game, ids.R2!, { type: 'leave' });
    expect(game.status).toBe('ended');
    expect(game.winner).toBe('hunters');
  });

  it('purges reveal coordinates after the retention window', () => {
    const { h, game, ids, host } = startedGame();
    run(h, 10 * MIN, () => locate(h, game, ids.R1!, 51.501, -0.124));
    send(h, game, host, { type: 'host.end' });
    run(h, 61 * MIN);
    expect(game.locationsPurged).toBe(true);
    expect(JSON.stringify(game.reveals)).not.toContain('51.501');
  });

  it('rematch returns everyone to the lobby with fresh state', () => {
    const { h, game, host } = startedGame();
    send(h, game, host, { type: 'host.end' });
    send(h, game, host, { type: 'host.rematch' });
    expect(game.status).toBe('lobby');
    expect(game.reveals).toHaveLength(0);
    expect(game.players.every((p) => p.status === 'active')).toBe(true);
  });
});

describe('cross-game isolation', () => {
  it('tokens only work for their own game and views only contain their own game', () => {
    const h = makeEngine();
    const a = setupGame(h, ['A1', 'A2', 'A3', 'A4'], {}, { A1: 'hunter', A2: 'hunter', A3: 'runner', A4: 'runner' });
    const b = setupGame(h, ['B1', 'B2', 'B3', 'B4'], {}, { B1: 'hunter', B2: 'hunter', B3: 'runner', B4: 'runner' });
    expect(err(() => h.engine.authenticate(b.game.id, a.tokens.A1!))).toBe('unauthorized');
    expect(err(() => send(h, b.game, a.ids.A1!, { type: 'host.start' }))).toBe('not_found');
    send(h, a.game, a.host, { type: 'host.start' });
    send(h, b.game, b.host, { type: 'host.start' });
    run(h, 10 * MIN, () => {
      locate(h, a.game, a.ids.A3!, 40.1, -70.1);
      locate(h, b.game, b.ids.B3!, 10.1, 20.1);
    });
    const va = JSON.stringify(view(h, a.game, a.host));
    expect(va).toContain('40.1');
    expect(va).not.toContain('10.1');
    expect(va).not.toContain(b.game.id);
    expect(va).not.toContain(b.ids.B3!);
  });
});
