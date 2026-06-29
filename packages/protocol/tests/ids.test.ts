import { describe, it, expect } from "vitest";
import { isHex32, isHex64, isHex, HEX32_RE, HEX64_RE } from "../src/ids.js";

describe("ids", () => {
  it("matches 32-byte hex", () => {
    expect(isHex32("0x" + "00".repeat(32))).toBe(true);
    expect(isHex32("0x" + "ff".repeat(32))).toBe(true);
  });

  it("rejects bad 32-byte hex", () => {
    expect(isHex32("0x1234")).toBe(false);
    expect(isHex32("not hex")).toBe(false);
    expect(isHex32(123)).toBe(false);
    expect(HEX32_RE.test("0x" + "ab".repeat(31))).toBe(false);
  });

  it("matches 64-byte hex", () => {
    expect(isHex64("0x" + "ab".repeat(64))).toBe(true);
    expect(isHex64("0x" + "00".repeat(64))).toBe(true);
  });

  it("rejects bad 64-byte hex", () => {
    expect(isHex64("0x" + "ab".repeat(32))).toBe(false);
    expect(HEX64_RE.test("0x1234")).toBe(false);
  });

  it("isHex handles even/odd", () => {
    expect(isHex("0x")).toBe(true);
    expect(isHex("0xab12")).toBe(true);
    expect(isHex("0xabc")).toBe(false);
    expect(isHex("0xzz")).toBe(false);
    expect(isHex(42)).toBe(false);
  });
});
