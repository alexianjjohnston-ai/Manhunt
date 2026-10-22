/**
 * Team size targets: a 50/50 split, with the odd player going to `extra`.
 */
export function teamTargets(playerCount: number, extra: 'runner' | 'hunter'): { runner: number; hunter: number } {
  const half = Math.floor(playerCount / 2);
  const odd = playerCount % 2 === 1;
  return {
    runner: half + (odd && extra === 'runner' ? 1 : 0),
    hunter: half + (odd && extra === 'hunter' ? 1 : 0),
  };
}

/** Fisher–Yates shuffle using an injectable RNG (crypto in production, seeded in tests). */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Randomly assign ids to balanced teams. */
export function balanceTeams(
  ids: readonly string[],
  extra: 'runner' | 'hunter',
  rng: () => number,
): Map<string, 'runner' | 'hunter'> {
  const targets = teamTargets(ids.length, extra);
  const order = shuffle(ids, rng);
  const out = new Map<string, 'runner' | 'hunter'>();
  order.forEach((id, i) => out.set(id, i < targets.runner ? 'runner' : 'hunter'));
  return out;
}

/** Whether a manual assignment is within the allowed one-player difference. */
export function isBalanced(runners: number, hunters: number): boolean {
  return Math.abs(runners - hunters) <= 1;
}
