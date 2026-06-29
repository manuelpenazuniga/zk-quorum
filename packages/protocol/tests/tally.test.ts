import { describe, it, expect } from "vitest";
import {
  bucketForNullifier,
  createTallyState,
  incrementTally,
  tallyAll,
  tallyTotal,
} from "../src/tally.js";
import { ZkqProtocolError } from "../src/errors.js";

describe("tally", () => {
  it("bucketForNullifier returns low nibble", () => {
    const b0 = bucketForNullifier(("0x" + "00".repeat(31) + "00") as `0x${string}`);
    const b5 = bucketForNullifier(("0x" + "00".repeat(31) + "05") as `0x${string}`);
    const b15 = bucketForNullifier(("0x" + "ff".repeat(31) + "0f") as `0x${string}`);
    expect(b0).toBe(0);
    expect(b5).toBe(5);
    expect(b15).toBe(15);
  });

  it("rejects non-32 byte nullifier", () => {
    expect(() => bucketForNullifier("0x1234")).toThrow(ZkqProtocolError);
  });

  it("createTallyState validates bucket count", () => {
    expect(() => createTallyState(5, 0)).toThrow(ZkqProtocolError);
    expect(() => createTallyState(5, 257)).toThrow(ZkqProtocolError);
    expect(() => createTallyState(0)).toThrow(ZkqProtocolError);
  });

  it("incrementTally + tallyTotal accumulates per option", () => {
    let s = createTallyState(3, 4);
    s = incrementTally(s, 0, 0);
    s = incrementTally(s, 0, 0);
    s = incrementTally(s, 1, 0);
    s = incrementTally(s, 2, 1);
    expect(tallyTotal(s, 0)).toBe(3n);
    expect(tallyTotal(s, 1)).toBe(1n);
    expect(tallyTotal(s, 2)).toBe(0n);
  });

  it("tallyAll sums every option across buckets", () => {
    let s = createTallyState(2, 4);
    s = incrementTally(s, 0, 0);
    s = incrementTally(s, 1, 0);
    s = incrementTally(s, 0, 1);
    expect(tallyAll(s)).toEqual([2n, 1n]);
  });

  it("rejects out-of-range option or bucket", () => {
    const s = createTallyState(2, 4);
    expect(() => incrementTally(s, 4, 0)).toThrow(ZkqProtocolError);
    expect(() => incrementTally(s, 0, 5)).toThrow(ZkqProtocolError);
  });

  it("rejects negative increment", () => {
    const s = createTallyState(2, 4);
    expect(() => incrementTally(s, 0, 0, -1n)).toThrow(ZkqProtocolError);
  });
});
