import { describe, it, expect } from "vitest";
import { createInMemoryIdempotencyStore } from "../src/services/idempotency.js";

describe("idempotency", () => {
  it("returns fresh on first call", () => {
    const s = createInMemoryIdempotencyStore({ ttlMs: 1000 });
    expect(s.begin("k", 0)).toEqual({ kind: "fresh" });
  });

  it("returns in-flight when not completed", () => {
    const s = createInMemoryIdempotencyStore({ ttlMs: 1000 });
    s.begin("k", 0);
    expect(s.begin("k", 0)).toEqual({ kind: "in-flight" });
  });

  it("returns replay with stored result", () => {
    const s = createInMemoryIdempotencyStore({ ttlMs: 1000 });
    s.begin("k", 0);
    s.complete("k", { ok: true }, 0);
    expect(s.begin("k", 0)).toEqual({ kind: "replay", result: { ok: true } });
  });

  it("evicts after ttl", () => {
    const s = createInMemoryIdempotencyStore({ ttlMs: 100 });
    s.begin("k", 0);
    s.complete("k", "x", 0);
    expect(s.begin("k", 0)).toEqual({ kind: "replay", result: "x" });
    expect(s.begin("k", 200)).toEqual({ kind: "fresh" });
  });

  it("size reflects stored entries", () => {
    const s = createInMemoryIdempotencyStore({ ttlMs: 1000 });
    s.begin("a", 0);
    s.begin("b", 0);
    expect(s.size()).toBe(2);
  });

  it("rejects invalid options", () => {
    expect(() => createInMemoryIdempotencyStore({ ttlMs: 0 })).toThrow();
  });
});
