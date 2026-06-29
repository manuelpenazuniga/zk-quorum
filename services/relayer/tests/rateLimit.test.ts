import { describe, it, expect } from "vitest";
import { createTokenBucketRateLimiter } from "../src/services/rateLimit.js";

describe("rateLimit", () => {
  it("allows up to limit, then rejects", () => {
    const rl = createTokenBucketRateLimiter({ limit: 3, windowMs: 1000 });
    expect(rl.check("k", 0).allowed).toBe(true);
    expect(rl.check("k", 0).allowed).toBe(true);
    expect(rl.check("k", 0).allowed).toBe(true);
    const r = rl.check("k", 0);
    expect(r.allowed).toBe(false);
    expect(r.resetMs).toBe(1000);
  });

  it("resets after window", () => {
    const rl = createTokenBucketRateLimiter({ limit: 2, windowMs: 100 });
    expect(rl.check("k", 0).allowed).toBe(true);
    expect(rl.check("k", 0).allowed).toBe(true);
    expect(rl.check("k", 50).allowed).toBe(false);
    expect(rl.check("k", 200).allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    const rl = createTokenBucketRateLimiter({ limit: 1, windowMs: 1000 });
    expect(rl.check("a", 0).allowed).toBe(true);
    expect(rl.check("a", 0).allowed).toBe(false);
    expect(rl.check("b", 0).allowed).toBe(true);
  });

  it("reset clears bucket", () => {
    const rl = createTokenBucketRateLimiter({ limit: 1, windowMs: 1000 });
    rl.check("k", 0);
    rl.reset("k");
    expect(rl.check("k", 0).allowed).toBe(true);
  });

  it("rejects invalid options", () => {
    expect(() => createTokenBucketRateLimiter({ limit: 0, windowMs: 100 })).toThrow();
    expect(() => createTokenBucketRateLimiter({ limit: 1, windowMs: 0 })).toThrow();
  });
});
