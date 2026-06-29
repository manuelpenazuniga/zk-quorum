import { bytesToBigEndianBigInt, hexToBytes, assertByteLength } from "./hash.js";
import { ZkqProtocolError } from "./errors.js";
import { ZKQ_ELECTION_SCOPE_DOMAIN_TAG } from "./version.js";
import type { Bytes32Hex } from "./ids.js";
import { isHex32 } from "./ids.js";

export interface ElectionScopeInput {
  readonly networkPassphrase: string;
  readonly contractId: Bytes32Hex;
  readonly electionId: Bytes32Hex;
  readonly version: number;
}

export const BLS12_381_SCALAR_MODULUS = (1n << 255n) - 19n;
export const SCOPE_REJECTION_MAX_COUNTER = 256;

const TEXT_ENCODER = new TextEncoder();

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function u32Be(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
    throw new ZkqProtocolError("INVALID_FIELD_ELEMENT", "u32 out of range", { value: n });
  }
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function u8(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xff) {
    throw new ZkqProtocolError("INVALID_FIELD_ELEMENT", "u8 out of range", { value: n });
  }
  return new Uint8Array([n & 0xff]);
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.subtle) {
    const buf = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
    return new Uint8Array(buf);
  }
  throw new ZkqProtocolError("ADAPTER_NOT_CONFIGURED", "no SubtleCrypto available; provide an injected digest");
}

export interface ScopeDigest {
  (bytes: Uint8Array): Promise<Uint8Array> | Uint8Array;
}

export interface ScopeDerivationOptions {
  readonly domainTag?: string;
  readonly maxCounter?: number;
  readonly digest?: ScopeDigest;
}

export function canonicalScopeMessage(input: ElectionScopeInput, domainTag: string = ZKQ_ELECTION_SCOPE_DOMAIN_TAG): Uint8Array {
  if (!isHex32(input.contractId)) {
    throw new ZkqProtocolError("INVALID_HEX", "contractId must be 32-byte hex", { contractId: input.contractId });
  }
  if (!isHex32(input.electionId)) {
    throw new ZkqProtocolError("INVALID_HEX", "electionId must be 32-byte hex", { electionId: input.electionId });
  }
  if (!Number.isInteger(input.version) || input.version < 0 || input.version > 0xff) {
    throw new ZkqProtocolError("INVALID_FIELD_ELEMENT", "version must fit in u8", { version: input.version });
  }
  const tag = TEXT_ENCODER.encode(domainTag);
  const net = TEXT_ENCODER.encode(input.networkPassphrase);
  const contractBytes = hexToBytes(input.contractId);
  const electionBytes = hexToBytes(input.electionId);
  assertByteLength(contractBytes, 32, "contractId");
  assertByteLength(electionBytes, 32, "electionId");

  return concatBytes([
    u32Be(tag.length), tag,
    u32Be(net.length), net,
    u32Be(contractBytes.length), contractBytes,
    u32Be(electionBytes.length), electionBytes,
    u8(input.version),
  ]);
}

export async function deriveElectionScope(
  input: ElectionScopeInput,
  options: ScopeDerivationOptions = {},
): Promise<Bytes32Hex> {
  const domainTag = options.domainTag ?? ZKQ_ELECTION_SCOPE_DOMAIN_TAG;
  const maxCounter = options.maxCounter ?? SCOPE_REJECTION_MAX_COUNTER;
  const digest = options.digest ?? sha256;
  const message = canonicalScopeMessage(input, domainTag);
  const mod = BLS12_381_SCALAR_MODULUS;

  for (let counter = 0; counter <= maxCounter; counter += 1) {
    const buf = concatBytes([message, u8(counter)]);
    const out = await digest(buf);
    assertByteLength(out, 32, "sha256 output");
    const candidate = bytesToBigEndianBigInt(out);
    if (candidate > 0n && candidate < mod) {
      const bytes = new Uint8Array(32);
      let value = candidate;
      for (let i = 31; i >= 0; i -= 1) {
        bytes[i] = Number(value & 0xffn);
        value >>= 8n;
      }
      return ("0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")) as Bytes32Hex;
    }
  }
  throw new ZkqProtocolError("SCOPE_DERIVATION_FAILED", "no candidate accepted in rejection sampling", {
    maxCounter,
  });
}
