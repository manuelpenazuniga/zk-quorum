import { describe, it, expect } from "vitest";
import { bytesToHex, hexToBytes, bytesToBigEndianBigInt, assertByteLength } from "../src/hash.js";
import { ZkqProtocolError } from "../src/errors.js";

describe("hash", () => {
  it("round trips bytes <-> hex", () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 255, 128, 64, 32]);
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
  });

  it("rejects bad hex", () => {
    expect(() => hexToBytes("0xzz")).toThrow(ZkqProtocolError);
    expect(() => hexToBytes("0xabc")).toThrow(ZkqProtocolError);
    expect(() => hexToBytes("not-a-hex")).toThrow(ZkqProtocolError);
  });

  it("rejects bad byte length", () => {
    expect(() => assertByteLength(new Uint8Array(2), 4, "thing")).toThrow(ZkqProtocolError);
  });

  it("bytesToBigEndianBigInt is big-endian", () => {
    const bytes = new Uint8Array([0x00, 0x00, 0x01]);
    expect(bytesToBigEndianBigInt(bytes)).toBe(1n);
    const twoFiftySix = new Uint8Array([0x01, 0x00]);
    expect(bytesToBigEndianBigInt(twoFiftySix)).toBe(256n);
  });
});
