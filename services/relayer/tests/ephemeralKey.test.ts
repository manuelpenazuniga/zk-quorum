import { describe, it, expect } from "vitest";
import { createEphemeralClientKeyer } from "../src/services/ephemeralClientKey.js";

describe("EphemeralKeyer (audit H1)", () => {
  it("returns a 64-hex-char key", () => {
    const k = createEphemeralClientKeyer({ rotationMs: 60_000, now: () => 0 });
    expect(k.keyFor("1.2.3.4")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("two addresses in the same window produce different keys", () => {
    const k = createEphemeralClientKeyer({ rotationMs: 60_000, now: () => 0 });
    expect(k.keyFor("1.2.3.4")).not.toBe(k.keyFor("1.2.3.5"));
  });

  it("the same address in the same window produces the same key", () => {
    let t = 0;
    const k = createEphemeralClientKeyer({ rotationMs: 60_000, now: () => t });
    const a = k.keyFor("1.2.3.4");
    t = 30_000;
    const b = k.keyFor("1.2.3.4");
    expect(a).toBe(b);
  });

  it("rotates on schedule and produces a different key for the same address", () => {
    let t = 0;
    const k = createEphemeralClientKeyer({ rotationMs: 60_000, now: () => t });
    const a = k.keyFor("1.2.3.4");
    t = 60_001;
    const b = k.keyFor("1.2.3.4");
    expect(a).not.toBe(b);
  });

  it("rotate() forces immediate rotation", () => {
    const k = createEphemeralClientKeyer({ rotationMs: 60_000, now: () => 0 });
    const saltA = k.currentSaltHex();
    k.rotate();
    const saltB = k.currentSaltHex();
    expect(saltA).not.toBe(saltB);
  });

  it("rejects rotationMs < 1000", () => {
    expect(() => createEphemeralClientKeyer({ rotationMs: 999 })).toThrow();
  });
});
