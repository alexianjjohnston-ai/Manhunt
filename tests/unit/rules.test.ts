import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/protocol';
import { GameError } from '../../server/engine';
import { locate, makeEngine, run, send, setupGame, view } from '../helpers';

const MIN = 60_000;
const TEAMS = { Host: 'hunter', H2: 'hunter', R1: 'runner', R2: 'runner' } as const;

function game(settings = {}) {
  const h = makeEngine();
  const t = setupGame(h, ['Host', 'H2', 'R1', 'R2'], { headStartMin: 0, pingIntervalSec: 300, durationMin: 60, finalPhaseMin: 0, ...settings }, { ...TEAMS });
  send(h, t.game, t.host, { type: 'host.start' });
  return { h, ...t };
}

const code = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(GameError);
    return (e as GameError).code;
  }
  throw new Error('expected GameError');
};

const walk = (s: ReturnType<typeof game>) => () => {
  locate(s.h, s.game, s.ids.R1!, 51.501, -0.124);
  locate(s.h, s.game, s.ids.R2!, 51.502, -0.124);
};

describe('final phase', () => {
  it('halves the ping interval for the last N minutes and announces it', () => {
    const s = game({ finalPhaseMin: 20 });
    const times: number[] = [];
    run(s.h, 61 * MIN, () => {
      walk(s)();
      if (s.game.reveals.length > times.length) times.push(s.game.reveals.at(-1)!.elapsedMs / MIN);
    });
    // 5-minute pings until 40 min, then every 2.5 min.
    expect(times).toEqual([5, 10, 15, 20, 25, 30, 35, 40, 42.5, 45, 47.5, 50, 52.5, 55, 57.5]);
    expect(s.game.events.some((e) => e.type === 'final_phase')).toBe(true);
  });

  it('never goes below the minimum interval', () => {
    const h = makeEngine({ allowFastPings: false });
    const t = setupGame(h, ['Host', 'R'], { headStartMin: 0, pingIntervalSec: 60, durationMin: 10, finalPhaseMin: 5 }, { Host: 'hunter', R: 'runner' });
    send(h, t.game, t.host, { type: 'host.start' });
    expect(h.engine.intervalAt(t.game, 9 * MIN)).toBe(60_000);
  });
});

describe('cloaks', () => {
  it('hide a runner from exactly one reveal, and hunters are told it was a cloak', () => {
    const s = game({ cloaksPerRunner: 1 });
    expect(view(s.h, s.game, s.ids.R1!).me.cloaksLeft).toBe(1);
    run(s.h, 5 * MIN, walk(s)); // ping 1: both visible
    send(s.h, s.game, s.ids.R1!, { type: 'useCloak' });
    expect(view(s.h, s.game, s.ids.R1!).me).toMatchObject({ cloaksLeft: 0, cloakArmed: true });
    // Hunters can't see that a cloak is armed before the ping.
    expect(JSON.stringify(view(s.h, s.game, s.host))).not.toContain('cloakArmed":true');
    expect(view(s.h, s.game, s.host).events.some((e) => e.type === 'cloak_used')).toBe(false);
    expect(view(s.h, s.game, s.ids.R2!).events.some((e) => e.type === 'cloak_used')).toBe(true);
    run(s.h, 5 * MIN, walk(s)); // ping 2: R1 cloaked
    const e = s.game.reveals[1]!.entries.find((x) => x.playerId === s.ids.R1)!;
    expect(e).toMatchObject({ status: 'cloaked' });
    expect(e.lat).toBeUndefined();
    const m = view(s.h, s.game, s.host).runnerMarkers.find((x) => x.playerId === s.ids.R1)!;
    expect(m.status).toBe('cloaked');
    expect(m.lastKnown?.seq).toBe(1); // last real position, labelled as old
    run(s.h, 5 * MIN, walk(s)); // ping 3: visible again
    expect(s.game.reveals[2]!.entries.find((x) => x.playerId === s.ids.R1)!.status).toBe('ok');
    expect(s.game.events.find((x) => x.text.startsWith('Ping #2'))!.text).toContain('1 cloaked');
  });

  it('are limited and runner-only', () => {
    const s = game({ cloaksPerRunner: 1 });
    expect(code(() => send(s.h, s.game, s.ids.H2!, { type: 'useCloak' }))).toBe('forbidden');
    send(s.h, s.game, s.ids.R1!, { type: 'useCloak' });
    expect(code(() => send(s.h, s.game, s.ids.R1!, { type: 'useCloak' }))).toBe('duplicate');
    run(s.h, 5 * MIN, walk(s));
    expect(code(() => send(s.h, s.game, s.ids.R1!, { type: 'useCloak' }))).toBe('none_left');
  });

  it('can be disabled', () => {
    const s = game({ cloaksPerRunner: 0 });
    expect(code(() => send(s.h, s.game, s.ids.R1!, { type: 'useCloak' }))).toBe('none_left');
  });
});

describe('radar sweep', () => {
  it('reveals every runner immediately without moving the regular schedule', () => {
    const s = game({ sweepsPerGame: 1 });
    run(s.h, 6 * MIN, walk(s));
    const next = s.game.nextPingElapsed;
    send(s.h, s.game, s.ids.H2!, { type: 'radarSweep' });
    expect(s.game.reveals.at(-1)!.kind).toBe('sweep');
    expect(s.game.reveals.at(-1)!.entries.every((e) => e.status === 'ok')).toBe(true);
    expect(s.game.nextPingElapsed).toBe(next);
    expect(view(s.h, s.game, s.ids.R1!).game.sweepsLeft).toBe(0);
    expect(code(() => send(s.h, s.game, s.ids.H2!, { type: 'radarSweep' }))).toBe('none_left');
  });

  it('is hunter-only, not during head start, and not right before a ping', () => {
    const h = makeEngine();
    const t = setupGame(h, ['Host', 'H2', 'R1', 'R2'], { headStartMin: 2, pingIntervalSec: 300, durationMin: 60 }, { ...TEAMS });
    send(h, t.game, t.host, { type: 'host.start' });
    expect(code(() => send(h, t.game, t.ids.H2!, { type: 'radarSweep' }))).toBe('headstart');
    run(h, 2 * MIN);
    expect(code(() => send(h, t.game, t.ids.R1!, { type: 'radarSweep' }))).toBe('forbidden');
    run(h, 4.5 * MIN); // next ping at 7 min → 30 s away
    expect(code(() => send(h, t.game, t.ids.H2!, { type: 'radarSweep' }))).toBe('too_soon');
  });

  it('respects a cloak', () => {
    const s = game();
    run(s.h, 6 * MIN, walk(s));
    send(s.h, s.game, s.ids.R2!, { type: 'useCloak' });
    send(s.h, s.game, s.host, { type: 'radarSweep' });
    expect(s.game.reveals.at(-1)!.entries.find((e) => e.playerId === s.ids.R2)!.status).toBe('cloaked');
  });
});

describe('infection mode', () => {
  it('turns caught runners into hunters who keep playing and sharing', () => {
    const s = game({ mode: 'infection' });
    send(s.h, s.game, s.host, { type: 'host.setCaptured', playerId: s.ids.R1!, captured: true });
    const r1 = s.game.players.find((p) => p.id === s.ids.R1)!;
    expect(r1).toMatchObject({ team: 'hunter', status: 'active', startTeam: 'runner' });
    expect(s.h.sent.some((x) => x.playerId === s.ids.R1 && x.msg.type === 'stopSharing')).toBe(false);
    const v = view(s.h, s.game, s.ids.R1!);
    expect(v.me.shareLocation).toBe(true);
    expect(v.me.tagCode).toBeUndefined();
    // Now hunts: can request captures of remaining runners.
    send(s.h, s.game, s.ids.R1!, { type: 'captureRequest', runnerId: s.ids.R2! });
    expect(s.game.captures.at(-1)!.hunterId).toBe(s.ids.R1);
    expect(s.game.status).toBe('running');
  });

  it('hunters win when the last runner is converted; runners win if one survives', () => {
    const a = game({ mode: 'infection' });
    send(a.h, a.game, a.host, { type: 'host.setCaptured', playerId: a.ids.R1!, captured: true });
    send(a.h, a.game, a.host, { type: 'host.setCaptured', playerId: a.ids.R2!, captured: true });
    expect(a.game).toMatchObject({ status: 'ended', winner: 'hunters' });

    const b = game({ mode: 'infection', durationMin: 10 });
    send(b.h, b.game, b.host, { type: 'host.setCaptured', playerId: b.ids.R1!, captured: true });
    run(b.h, 10 * MIN);
    expect(b.game).toMatchObject({ status: 'ended', winner: 'runners' });
  });

  it('host can release a converted runner back to the runners', () => {
    const s = game({ mode: 'infection' });
    send(s.h, s.game, s.host, { type: 'host.setCaptured', playerId: s.ids.R1!, captured: true });
    send(s.h, s.game, s.host, { type: 'host.setCaptured', playerId: s.ids.R1!, captured: false });
    expect(s.game.players.find((p) => p.id === s.ids.R1)).toMatchObject({ team: 'runner', status: 'active' });
  });
});

describe('rematch', () => {
  it('restores starting teams, optionally swapped', () => {
    const s = game({ mode: 'infection' });
    send(s.h, s.game, s.host, { type: 'host.setCaptured', playerId: s.ids.R1!, captured: true });
    send(s.h, s.game, s.host, { type: 'host.end' });
    send(s.h, s.game, s.host, { type: 'host.rematch', swapTeams: true });
    const team = (n: string) => s.game.players.find((p) => p.id === s.ids[n])!.team;
    expect([team('Host'), team('H2'), team('R1'), team('R2')]).toEqual(['runner', 'runner', 'hunter', 'hunter']);
  });
});

describe('compatibility', () => {
  it('fills in new rules for clients that do not send them', () => {
    const h = makeEngine();
    const legacy: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const k of ['mode', 'cloaksPerRunner', 'sweepsPerGame', 'finalPhaseMin']) delete legacy[k];
    const { game: g } = h.engine.createGame({ hostName: 'Old', settings: legacy, boundary: null, safetyAck: true });
    expect(g.settings).toMatchObject({ mode: 'classic', cloaksPerRunner: 1, sweepsPerGame: 1, finalPhaseMin: 10 });
  });
});

describe('team-only events', () => {
  it('a host playing as a hunter does not receive runner-team events (and vice versa)', () => {
    const s = game();
    send(s.h, s.game, s.ids.R1!, { type: 'useCloak' });
    expect(view(s.h, s.game, s.host).events.some((e) => e.type === 'cloak_used')).toBe(false);
    run(s.h, 5 * MIN, walk(s));
    send(s.h, s.game, s.ids.H2!, { type: 'captureRequest', runnerId: s.ids.R2! });
    // Runner teammates don't see a hunter's claim on someone else.
    expect(view(s.h, s.game, s.ids.R1!).events.some((e) => e.type === 'capture_requested')).toBe(false);
  });
});
