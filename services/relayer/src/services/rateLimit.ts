export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetMs: number;
}

export interface RateLimiter {
  check(key: string, now: number): RateLimitDecision;
  reset(key: string): void;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export interface TokenBucketRateLimiterOptions {
  readonly limit: number;
  readonly windowMs: number;
  readonly now?: () => number;
}

export function createTokenBucketRateLimiter(options: TokenBucketRateLimiterOptions): RateLimiter {
  if (!Number.isInteger(options.limit) || options.limit < 1) {
    throw new Error("rate limit must be a positive integer");
  }
  if (!Number.isInteger(options.windowMs) || options.windowMs < 1) {
    throw new Error("rate window must be a positive integer");
  }
  const _now: () => number = options.now ?? Date.now;
  void _now;
  const buckets = new Map<string, Bucket>();

  const check = (key: string, t: number): RateLimitDecision => {
    let b = buckets.get(key);
    if (b === undefined || t >= b.resetAt) {
      b = { count: 0, resetAt: t + options.windowMs };
      buckets.set(key, b);
    }
    if (b.count >= options.limit) {
      return { allowed: false, remaining: 0, resetMs: b.resetAt - t };
    }
    b.count += 1;
    return { allowed: true, remaining: options.limit - b.count, resetMs: b.resetAt - t };
  };

  return {
    check: (key, t) => check(key, t),
    reset: (key) => {
      buckets.delete(key);
    },
  };
}
