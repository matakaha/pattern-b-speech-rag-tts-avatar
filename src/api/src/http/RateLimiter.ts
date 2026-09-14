interface WindowEntry {
  used: number;
  resetsAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export class FixedWindowRateLimiter {
  readonly #entries = new Map<string, WindowEntry>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  consume(key: string, cost = 1, now = Date.now()): RateLimitResult {
    const current = this.#entries.get(key);
    const entry =
      !current || current.resetsAt <= now ? { used: 0, resetsAt: now + this.windowMs } : current;
    if (entry.used + cost > this.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.resetsAt - now) / 1_000)),
      };
    }

    entry.used += cost;
    this.#entries.set(key, entry);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  clear(key: string): void {
    this.#entries.delete(key);
  }
}
