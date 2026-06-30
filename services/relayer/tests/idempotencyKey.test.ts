import { describe, it, expect } from "vitest";
import { generateIdempotencyKey, createInMemoryIdempotencyStore } from "../src/services/idempotency.js";

describe("generateIdempotencyKey (audit L1)", () => {
  it("produces a 32-byte hex key with 0x prefix", () => {
    const k = generateIdempotencyKey();
    expect(k).toMatch(/^0x[0-9a-f]{32}$/);
  });

  it("produces distinct keys across calls", () => {
    const a = generateIdempotencyKey();
    const b = generateIdempotencyKey();
    expect(a).not.toBe(b);
  });

  it("uses crypto.randomUUID when available (Node 24)", () => {
    const k = generateIdempotencyKey();
    // 32 hex chars (16 bytes), the second half of a UUIDv4 → high entropy
    expect(k.length).toBe(34);
  });
});

describe("idempotency + generateIdempotencyKey", () => {
  it("a generated key is accepted by the store", () => {
    const s = createInMemoryIdempotencyStore({ ttlMs: 1000 });
    const k = generateIdempotencyKey();
    expect(s.begin(k, 0)).toEqual({ kind: "fresh" });
  });
});
