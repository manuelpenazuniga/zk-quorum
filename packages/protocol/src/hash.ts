import type { Sha256Hex } from "./ids.js";
import { isHex } from "./ids.js";
import { ZkqProtocolError } from "./errors.js";

export const SHA256_HEX_RE = /^0x[0-9a-fA-F]{64}$/;

export function isSha256Hex(value: unknown): value is Sha256Hex {
  return typeof value === "string" && SHA256_HEX_RE.test(value);
}

const HEX_CHARS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"];

const HEX_LOOKUP: Record<string, number> = (() => {
  const t: Record<string, number> = {};
  for (let i = 0; i < HEX_CHARS.length; i += 1) {
    t[HEX_CHARS[i]!] = i;
  }
  return t;
})();

export function hexToBytes(hex: string): Uint8Array {
  if (!isHex(hex)) {
    throw new ZkqProtocolError("INVALID_HEX", "expected 0x-prefixed hex", { value: hex });
  }
  if ((hex.length - 2) % 2 !== 0) {
    throw new ZkqProtocolError("INVALID_HEX_LENGTH", "hex must have even length", { len: hex.length - 2 });
  }
  const out = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < out.length; i += 1) {
    const a = HEX_LOOKUP[hex[2 + i * 2]!.toLowerCase()];
    const b = HEX_LOOKUP[hex[3 + i * 2]!.toLowerCase()];
    if (a === undefined || b === undefined) {
      throw new ZkqProtocolError("INVALID_HEX", "non-hex character", { index: 2 + i * 2 });
    }
    out[i] = (a << 4) | b;
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = "0x";
  for (let i = 0; i < bytes.length; i += 1) {
    s += HEX_CHARS[(bytes[i]! >> 4) & 0x0f]!;
    s += HEX_CHARS[bytes[i]! & 0x0f]!;
  }
  return s;
}

export function bytesToBigEndianBigInt(bytes: Uint8Array): bigint {
  let acc = 0n;
  for (let i = 0; i < bytes.length; i += 1) {
    acc = (acc << 8n) | BigInt(bytes[i]!);
  }
  return acc;
}

export function assertByteLength(bytes: Uint8Array, expected: number, label: string): void {
  if (bytes.length !== expected) {
    throw new ZkqProtocolError("INVALID_BYTE_LENGTH", `${label} must be ${expected} bytes`, {
      actual: bytes.length,
      expected,
      label,
    });
  }
}
