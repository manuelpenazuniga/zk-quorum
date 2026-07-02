/**
 * Soroban canonical binary encoding — exactly matches circom2soroban Rust tool
 * and the contract's VK/Proof/PublicSignals from_bytes.
 *
 * Byte formats (matching tools/circom2soroban/src/lib.rs and crates/zk):
 *   Proof: A G1(96) | B G2(192) | C G1(96)         = 384 bytes
 *   Public: len u32 BE | Fr[i] 32-byte BE           =   4 + 6*32 = 196 bytes
 *
 * G1 uncompressed: x(48 BE bytes) | y(48 BE bytes)  =  96 bytes
 * G2 uncompressed: x.c0(48) | x.c1(48) | y.c0(48) | y.c1(48) = 192 bytes
 *
 * Each coordinate is a BLS12-381 Fq element (< Fq modulus), serialized
 * as 48-byte big-endian. Each public signal is an Fr element (< Fr modulus),
 * serialized as 32-byte big-endian. Zero is allowed for coordinates;
 * the snarkjs prover guarantees valid points on the curve.
 */

// BLS12-381 base field (Fq) modulus — 381 bits = 48 bytes
const FQ_MODULUS = 0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn;

// BLS12-381 scalar field (Fr) modulus — 255 bits = 32 bytes
const FR_MODULUS = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

const FQ_BYTE_LEN = 48;
const FR_BYTE_LEN = 32;
const G1_UNCOMPRESSED = FQ_BYTE_LEN * 2; // 96
const G2_UNCOMPRESSED = FQ_BYTE_LEN * 4; // 192
export const PROOF_BYTE_LEN = G1_UNCOMPRESSED + G2_UNCOMPRESSED + G1_UNCOMPRESSED; // 384
export const PUBLIC_SIGNALS_BYTE_LEN = 4 + 6 * FR_BYTE_LEN; // 196

// ── Parsing helpers ──

function parseDecimalStrict(s: string): bigint {
  if (typeof s !== "string") throw new Error(`expected string, got ${typeof s}`);
  if (s.length === 0) throw new Error("empty string");
  // reject signs
  if (s[0] === "-" || s[0] === "+") throw new Error(`sign not allowed: "${s}"`);
  // reject leading zeros except for "0" itself
  if (s.length > 1 && s[0] === "0") throw new Error(`leading zeros not allowed: "${s}"`);
  // must be all ascii digits
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) throw new Error(`non-digit character in "${s}" at pos ${i}: '${s[i]}'`);
  }
  const bi = BigInt(s);
  return bi;
}

// ── BigInt → bytes (big-endian, fixed width) ──

function bigintToBytesBE(val: bigint, byteLen: number): Uint8Array {
  if (val < 0n) throw new Error("negative value not allowed");
  const bytes = new Uint8Array(byteLen);
  let v = val;
  for (let i = byteLen - 1; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v > 0n) throw new Error(`value too large for ${byteLen} bytes`);
  return bytes;
}

// ── Fq parsing (validates < Fq modulus) ──

function parseFq(s: string): bigint {
  const val = parseDecimalStrict(s);
  if (val >= FQ_MODULUS) throw new Error(`Fq value >= modulus: ${s}`);
  return val;
}

// ── Fr parsing (validates < Fr modulus) ──

function parseFr(s: string): bigint {
  const val = parseDecimalStrict(s);
  if (val >= FR_MODULUS) throw new Error(`Fr value >= modulus: ${s}`);
  return val;
}

// ── Public types matching snarkjs proof JSON ──

/** Three Fq decimal strings: [x, y, flag] where flag === "1" for affine G1 point */
export type G1Json = [string, string, string];

/** G2 point: [[x.c0, x.c1], [y.c0, y.c1], [flag.c0, flag.c1]] where flag === ["1", "0"] */
export type G2Json = [[string, string], [string, string], [string, string]];

export interface ProofJson {
  readonly protocol: string;
  readonly curve: string;
  readonly pi_a: G1Json;
  readonly pi_b: G2Json;
  readonly pi_c: G1Json;
}

/** Public signals: exactly 6 canonical decimal Fr strings */
export type PublicJson = string[];

// ── G1 serialization (uncompressed: x(48) | y(48)) ──

function serializeG1Uncompressed(g1: G1Json, label: string): Uint8Array {
  if (g1[2] !== "1") throw new Error(`${label}: flag must be "1" (affine), got "${g1[2]}"`);
  const x = parseFq(g1[0]);
  const y = parseFq(g1[1]);
  const out = new Uint8Array(G1_UNCOMPRESSED);
  out.set(bigintToBytesBE(x, FQ_BYTE_LEN), 0);
  out.set(bigintToBytesBE(y, FQ_BYTE_LEN), FQ_BYTE_LEN);
  return out;
}

// ── G2 serialization (uncompressed: x.c0(48) | x.c1(48) | y.c0(48) | y.c1(48)) ──

function serializeG2Uncompressed(g2: G2Json, label: string): Uint8Array {
  const flag = g2[2];
  if (flag[0] !== "1" || flag[1] !== "0") {
    throw new Error(`${label}: flag must be ["1","0"] (affine), got ["${flag[0]}","${flag[1]}"]`);
  }
  const x0 = parseFq(g2[0][0]);
  const x1 = parseFq(g2[0][1]);
  const y0 = parseFq(g2[1][0]);
  const y1 = parseFq(g2[1][1]);
  const out = new Uint8Array(G2_UNCOMPRESSED);
  let off = 0;
  out.set(bigintToBytesBE(x0, FQ_BYTE_LEN), off); off += FQ_BYTE_LEN;
  out.set(bigintToBytesBE(x1, FQ_BYTE_LEN), off); off += FQ_BYTE_LEN;
  out.set(bigintToBytesBE(y0, FQ_BYTE_LEN), off); off += FQ_BYTE_LEN;
  out.set(bigintToBytesBE(y1, FQ_BYTE_LEN), off);
  return out;
}

// ── Public API ──

/**
 * Convert a snarkjs proof JSON object to Soroban canonical proof bytes (384 bytes).
 * Format: A G1(96) | B G2(192) | C G1(96)
 */
export function encodeProof(proof: ProofJson): Uint8Array {
  if (proof.protocol !== "groth16") throw new Error(`unsupported protocol: ${proof.protocol}`);
  if (proof.curve !== "bls12381") throw new Error(`unsupported curve: ${proof.curve}`);
  const a = serializeG1Uncompressed(proof.pi_a, "pi_a");
  const b = serializeG2Uncompressed(proof.pi_b, "pi_b");
  const c = serializeG1Uncompressed(proof.pi_c, "pi_c");
  const out = new Uint8Array(PROOF_BYTE_LEN);
  let off = 0;
  out.set(a, off); off += a.length;
  out.set(b, off); off += b.length;
  out.set(c, off);
  return out;
}

/**
 * Convert R0 public signals (exactly 6 canonical decimal Fr strings) to
 * Soroban canonical public bytes (196 bytes).
 * Format: u32 BE len (6) | Fr[0](32 BE) | ... | Fr[5](32 BE)
 */
export function encodePublicSignals(signals: PublicJson): Uint8Array {
  if (signals.length !== 6) {
    throw new Error(`public signals must have exactly 6 elements, got ${signals.length}`);
  }
  const out = new Uint8Array(PUBLIC_SIGNALS_BYTE_LEN);
  // u32 BE length
  const len = 6;
  out[0] = (len >>> 24) & 0xff;
  out[1] = (len >>> 16) & 0xff;
  out[2] = (len >>> 8) & 0xff;
  out[3] = len & 0xff;
  let off = 4;
  for (let i = 0; i < signals.length; i++) {
    const fr = parseFr(signals[i]!);
    const frBytes = bigintToBytesBE(fr, FR_BYTE_LEN);
    out.set(frBytes, off);
    off += FR_BYTE_LEN;
  }
  return out;
}

/**
 * Parse a string that is a canonical decimal Fr element.
 * Rejects: empty, signs, leading zeros (except "0"), non-digits, >= modulus.
 * Accepts: "0" or non-empty sequence of ascii digits where first is 1-9.
 */
export function isCanonicalDecimalFr(s: unknown): s is string {
  if (typeof s !== "string") return false;
  if (s.length === 0) return false;
  if (s === "0") return true;
  if (s[0] === "0") return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  try {
    const bi = BigInt(s);
    return bi < FR_MODULUS;
  } catch {
    return false;
  }
}
