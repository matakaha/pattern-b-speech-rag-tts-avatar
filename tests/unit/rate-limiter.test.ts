import { describe, expect, it } from 'vitest';

import { FixedWindowRateLimiter } from '../../src/api/src/http/RateLimiter.js';

describe('FixedWindowRateLimiter', () => {
  it('rejects weighted usage over the limit and reports retry time', () => {
    const limiter = new FixedWindowRateLimiter(10, 1_000);

    expect(limiter.consume('session', 6, 1_000).allowed).toBe(true);
    expect(limiter.consume('session', 5, 1_100)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
  });

  it('starts a fresh window after expiry', () => {
    const limiter = new FixedWindowRateLimiter(1, 1_000);

    expect(limiter.consume('session', 1, 1_000).allowed).toBe(true);
    expect(limiter.consume('session', 1, 2_000).allowed).toBe(true);
  });
});
