/** Simple token-bucket limiter keyed by arbitrary strings. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; updated: number }>();

  constructor(
    private capacity: number,
    private refillPerSec: number,
    private now: () => number = Date.now,
  ) {}

  take(key: string, cost = 1): boolean {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, updated: t };
    b.tokens = Math.min(this.capacity, b.tokens + ((t - b.updated) / 1000) * this.refillPerSec);
    b.updated = t;
    const ok = b.tokens >= cost;
    if (ok) b.tokens -= cost;
    this.buckets.set(key, b);
    if (this.buckets.size > 50_000) this.sweep();
    return ok;
  }

  private sweep() {
    const t = this.now();
    for (const [k, b] of this.buckets) {
      if (t - b.updated > (this.capacity / this.refillPerSec) * 1000) this.buckets.delete(k);
    }
  }
}
