import { describe, expect, it } from 'vitest';
import {
  elapsedMs,
  firstPingElapsed,
  formatAge,
  formatDuration,
  freshThresholdMs,
  nextPingAfter,
  phaseAt,
  remainingMs,
} from '@shared/clock';
import { boundaryStatus, destination, distanceM, isInsideBoundary, pointInPolygon } from '@shared/geo';
import { DEFAULT_SETTINGS, clientMessageSchema, displayNameSchema, joinCodeSchema } from '@shared/protocol';
import { evaluateWinner } from '@shared/rules';
import { balanceTeams, isBalanced, teamTargets } from '@shared/teams';
import { seededRng } from '../helpers';

describe('team balancing', () => {
  it('splits even counts 50/50', () => {
    for (const n of [2, 4, 6, 10, 40]) {
      const t = teamTargets(n, 'hunter');
      expect(t.runner).toBe(n / 2);
      expect(t.hunter).toBe(n / 2);
    }
  });

  it('gives the extra player of an odd count to the chosen team', () => {
    expect(teamTargets(5, 'hunter')).toEqual({ runner: 2, hunter: 3 });
    expect(teamTargets(5, 'runner')).toEqual({ runner: 3, hunter: 2 });
    expect(teamTargets(1, 'runner')).toEqual({ runner: 1, hunter: 0 });
  });

  it('balanceTeams assigns everyone and respects targets', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const m = balanceTeams(ids, 'runner', seededRng(7));
    expect(m.size).toBe(7);
    const runners = [...m.values()].filter((t) => t === 'runner').length;
    expect(runners).toBe(4);
    expect(isBalanced(runners, 7 - runners)).toBe(true);
  });

  it('balanceTeams is random but deterministic for a seed', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const a = [...balanceTeams(ids, 'hunter', seededRng(1)).entries()];
    const b = [...balanceTeams(ids, 'hunter', seededRng(1)).entries()];
    const c = [...balanceTeams(ids, 'hunter', seededRng(2)).entries()];
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe('server clock math', () => {
  const settings = { ...DEFAULT_SETTINGS, durationMin: 60, headStartMin: 5, pingIntervalSec: 300 };

  it('excludes paused time and freezes while paused', () => {
    const clock = { startedAt: 0, pausedAt: null, pausedTotalMs: 0, endedAt: null };
    expect(elapsedMs(clock, 10_000)).toBe(10_000);
    const paused = { ...clock, pausedAt: 10_000 };
    expect(elapsedMs(paused, 50_000)).toBe(10_000);
    const resumed = { ...clock, pausedTotalMs: 40_000 };
    expect(elapsedMs(resumed, 60_000)).toBe(20_000);
    expect(remainingMs(resumed, settings, 60_000)).toBe(3_600_000 - 20_000);
  });

  it('computes phases', () => {
    const clock = { startedAt: 0, pausedAt: null, pausedTotalMs: 0, endedAt: null };
    expect(phaseAt('lobby', clock, settings, 0)).toBe('lobby');
    expect(phaseAt('running', clock, settings, 60_000)).toBe('headstart');
    expect(phaseAt('running', clock, settings, 300_000)).toBe('hunting');
    expect(phaseAt('ended', clock, settings, 1)).toBe('ended');
  });

  it('schedules the first ping one interval after the head start by default', () => {
    expect(firstPingElapsed(settings)).toBe(600_000);
    expect(firstPingElapsed({ ...settings, revealAtHeadStartEnd: true })).toBe(300_000);
    expect(firstPingElapsed({ ...settings, headStartMin: 0 })).toBe(300_000);
    expect(nextPingAfter(600_000, settings)).toBe(900_000);
  });

  it('fresh threshold scales with interval within bounds', () => {
    expect(freshThresholdMs({ pingIntervalSec: 300 })).toBe(90_000);
    expect(freshThresholdMs({ pingIntervalSec: 60 })).toBe(30_000);
    expect(freshThresholdMs({ pingIntervalSec: 15 })).toBe(20_000);
  });

  it('formats durations and ages', () => {
    expect(formatDuration(65_000)).toBe('01:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(formatAge(2_000)).toBe('just now');
    expect(formatAge(42_000)).toBe('42s ago');
    expect(formatAge(125_000)).toBe('2m 5s ago');
    expect(formatAge(15 * 60_000)).toBe('15m ago');
  });
});

describe('geo', () => {
  const c = { lat: 51.5, lng: -0.12 };
  it('measures distances', () => {
    const p = destination(c, 90, 1000);
    expect(distanceM(c, p)).toBeCloseTo(1000, 0);
  });
  it('tests circle and polygon boundaries', () => {
    const circle = { type: 'circle' as const, center: c, radiusM: 500 };
    expect(isInsideBoundary(destination(c, 0, 400), circle)).toBe(true);
    expect(isInsideBoundary(destination(c, 0, 600), circle)).toBe(false);
    expect(boundaryStatus(destination(c, 0, 470), circle)).toBe('near_edge');
    const square = [destination(c, 45, 700), destination(c, 135, 700), destination(c, 225, 700), destination(c, 315, 700)];
    expect(pointInPolygon(c, square)).toBe(true);
    expect(pointInPolygon(destination(c, 0, 900), square)).toBe(false);
    expect(boundaryStatus(c, null)).toBe('none');
  });
});

describe('win conditions', () => {
  const P = (team: 'runner' | 'hunter', status: 'active' | 'captured' | 'left' | 'kicked' = 'active') => ({ team, status });
  it('hunters win when every runner is captured or gone', () => {
    expect(evaluateWinner([P('runner', 'captured'), P('runner', 'left'), P('hunter')], false)).toBe('hunters');
  });
  it('game continues while a runner is free and time remains', () => {
    expect(evaluateWinner([P('runner'), P('runner', 'captured'), P('hunter')], false)).toBeNull();
  });
  it('runners win if one is free at time zero', () => {
    expect(evaluateWinner([P('runner'), P('runner', 'captured'), P('hunter')], true)).toBe('runners');
  });
});

describe('validation', () => {
  it('normalises join codes', () => {
    expect(joinCodeSchema.parse(' ab-c2 34 ')).toBe('ABC234');
    expect(joinCodeSchema.safeParse('ABC').success).toBe(false);
  });
  it('sanitises display names', () => {
    expect(displayNameSchema.parse('  Alex\u0000​  ')).toBe('Alex');
    expect(displayNameSchema.safeParse('   ').success).toBe(false);
    expect(displayNameSchema.safeParse('x'.repeat(21)).success).toBe(false);
  });
  it('rejects malformed client messages', () => {
    expect(clientMessageSchema.safeParse({ type: 'location', lat: 999, lng: 0, accuracyM: 5, ageMs: 0 }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: 'host.nuke' }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: 'captureByCode', code: '12a4' }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: 'location', lat: 1, lng: 2, accuracyM: 5, ageMs: 0 }).success).toBe(true);
  });
});
