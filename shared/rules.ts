import type { PlayerStatus, Team, Winner } from './types';

interface RulePlayer {
  team: Team | null;
  status: PlayerStatus;
}

/** Runners still in play (not captured, not departed). */
export function activeRunners<T extends RulePlayer>(players: readonly T[]): T[] {
  return players.filter((p) => p.team === 'runner' && p.status === 'active');
}

/**
 * Win evaluation while the game is running.
 * - Hunters win once no runner remains free (all captured or left).
 * - Runners win if at least one runner is still free when time runs out.
 * Returns null while the game should continue.
 */
export function evaluateWinner(players: readonly RulePlayer[], timeUp: boolean): Winner | null {
  const runners = players.filter((p) => p.team === 'runner' && p.status !== 'kicked');
  const free = activeRunners(players).length;
  if (runners.length > 0 && free === 0) return 'hunters';
  if (timeUp) return free > 0 ? 'runners' : 'hunters';
  return null;
}
