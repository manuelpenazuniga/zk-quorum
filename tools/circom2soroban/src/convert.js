// circom2soroban — Convert snarkjs Groth16 BLS12-381 JSON artifacts to Soroban canonical bytes
//
// Byte formats match `crates/zk/src/lib.rs`:
//   VK: alpha G1(48) | beta G2(96) | gamma G2(96) | delta G2(96) | ic_len u32 BE | IC[i] G1(48)
//   Proof: A G1(48) | B G2(96) | C G1(48)
//   PublicSignals: len u32 BE | Fr[i] 32-byte BE
//
// G1 is 96 bytes (x || y, each 48-byte BE)
// G2 is 192 bytes (x.c0 || x.c1 || y.c0 || y.c1, each 48-byte BE)

// BLS12-381 base field modulus (Fq) — 381-bit prime
const FQ_MODULUS = 0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn;
const FQ_BYTES = 48;

// BLS12-381 scalar field modulus (Fr) — 255-bit prime
const FR_MODULUS = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;
const FR_BYTES = 32;

// G1 serialized size: 96 bytes
const G1_SIZE = 96;
// G2 serialized size: 192 bytes
const G2_SIZE = 192;

const G1_IDENTITY_FLAG = 0x40; // arkworks uncompressed infinity flag

/**
 * Convert a decimal string (big integer) to N-byte big-endian buffer.
 * Rejects values >= 2^(N*8) that would overflow N bytes.
 */
function bigIntToBE(valueStr, byteLen) {
  const val = BigInt(valueStr);
  if (val < 0n) {
    throw new Error(`Negative value not allowed: ${valueStr}`);
  }
  const maxVal = (1n << BigInt(byteLen * 8)) - 1n;
  if (val > maxVal) {
    throw new Error(`Value ${valueStr} exceeds ${byteLen} bytes (max ${maxVal})`);
  }
  const hex = val.toString(16).padStart(byteLen * 2, '0');
  return Buffer.from(hex, 'hex');
}

/**
 * Validate a bigint is in the base field Fq (0 <= v < FQ_MODULUS).
 */
function validateFq(valueStr) {
  const val = BigInt(valueStr);
  if (val < 0n || val >= FQ_MODULUS) {
    throw new Error(`Fq coordinate out of range: ${valueStr}`);
  }
}

/**
 * Validate a bigint is in the scalar field Fr (0 <= v < FR_MODULUS).
 */
function validateFr(valueStr) {
  const val = BigInt(valueStr);
  if (val < 0n || val >= FR_MODULUS) {
    throw new Error(`Fr scalar non-canonical: ${valueStr}`);
  }
}

/**
 * Parse a snarkjs G1 point ["x","y","flag"] into a 96-byte buffer.
 * flag "1" = affine, flag "0" = infinity.
 */
function parseG1(point) {
  if (!Array.isArray(point) || point.length !== 3) {
    throw new Error(`Invalid G1 point: expected array of 3 elements`);
  }
  const [x, y, flag] = point.map(String);
  if (flag === '0') {
    // Point at infinity
    const buf = Buffer.alloc(G1_SIZE, 0);
    buf[0] = G1_IDENTITY_FLAG;
    return buf;
  }
  if (flag !== '1') {
    throw new Error(`Invalid G1 flag: ${flag}`);
  }
  validateFq(x);
  validateFq(y);
  const xBytes = bigIntToBE(x, FQ_BYTES);
  const yBytes = bigIntToBE(y, FQ_BYTES);
  return Buffer.concat([xBytes, yBytes]);
}

/**
 * Parse a snarkjs G2 point [["x1","x2"],["y1","y2"],[c0,c1]] into a 192-byte buffer.
 * Last element ["1","0"] = affine, ["0","0"] = infinity.
 */
function parseG2(point) {
  if (!Array.isArray(point) || point.length !== 3) {
    throw new Error(`Invalid G2 point: expected array of 3 elements`);
  }
  const x = point[0];
  const y = point[1];
  const z = point[2];
  if (!Array.isArray(x) || x.length !== 2 || !Array.isArray(y) || y.length !== 2 || !Array.isArray(z) || z.length !== 2) {
    throw new Error(`Invalid G2 point structure`);
  }
  const [x1, x2] = x.map(String);
  const [y1, y2] = y.map(String);
  const [c0, c1] = z.map(String);

  if (c0 === '0' && c1 === '0') {
    // Point at infinity
    const buf = Buffer.alloc(G2_SIZE, 0);
    buf[0] = G1_IDENTITY_FLAG;
    return buf;
  }
  if (c0 !== '1' || c1 !== '0') {
    throw new Error(`Invalid G2 flag: [${c0}, ${c1}]`);
  }
  validateFq(x1);
  validateFq(x2);
  validateFq(y1);
  validateFq(y2);
  // Arkworks BLS12-381 Fq2 (QuadExtField) serialization is c1 || c0 (NOT c0 || c1).
  // Each Fq2 element = c0 + c1*u where u^2 = -1.
  // Serialization order: u-coefficient first (c1), then constant (c0).
  // G2Affine serialized as: x.c1 || x.c0 || y.c1 || y.c0 (each 48 bytes BE)
  const xc0Bytes = bigIntToBE(x1, FQ_BYTES);
  const xc1Bytes = bigIntToBE(x2, FQ_BYTES);
  const yc0Bytes = bigIntToBE(y1, FQ_BYTES);
  const yc1Bytes = bigIntToBE(y2, FQ_BYTES);
  return Buffer.concat([xc1Bytes, xc0Bytes, yc1Bytes, yc0Bytes]);
}

/**
 * Convert a snarkjs verification key JSON object into canonical Soroban bytes.
 *
 * Expected JSON structure (from `snarkjs zkey export verificationkey`):
 * {
 *   "protocol": "groth16",
 *   "curve": "bls12381",
 *   "nPublic": N,
 *   "vk_alpha_1": ["x","y","1"],
 *   "vk_beta_2": [["x1","x2"],["y1","y2"],["1","0"]],
 *   "vk_gamma_2": [["x1","x2"],["y1","y2"],["1","0"]],
 *   "vk_delta_2": [["x1","x2"],["y1","y2"],["1","0"]],
 *   "IC": [["x","y","1"], ...]
 * }
 */
export function convertVk(vkJson) {
  if (vkJson.protocol !== 'groth16') {
    throw new Error(`Unsupported protocol: ${vkJson.protocol}`);
  }
  if (vkJson.curve !== 'bls12381') {
    throw new Error(`Unsupported curve: ${vkJson.curve}`);
  }
  if (!Array.isArray(vkJson.IC) || vkJson.IC.length === 0) {
    throw new Error('VK IC must be a non-empty array');
  }

  const alpha = parseG1(vkJson.vk_alpha_1);
  const beta = parseG2(vkJson.vk_beta_2);
  const gamma = parseG2(vkJson.vk_gamma_2);
  const delta = parseG2(vkJson.vk_delta_2);

  const icLen = vkJson.IC.length;
  if (icLen > 0xFFFFFFFF) {
    throw new Error(`IC length too large: ${icLen}`);
  }
  const icLenBuf = Buffer.alloc(4);
  icLenBuf.writeUInt32BE(icLen, 0);

  const icParts = vkJson.IC.map((ic, i) => {
    if (!Array.isArray(ic) || ic.length !== 3) {
      throw new Error(`IC[${i}] is not a valid G1 point`);
    }
    return parseG1(ic);
  });

  return Buffer.concat([alpha, beta, gamma, delta, icLenBuf, ...icParts]);
}

/**
 * Convert a snarkjs proof JSON object into canonical Soroban bytes.
 *
 * Expected JSON structure:
 * {
 *   "pi_a": ["x","y","1"],
 *   "pi_b": [["x1","x2"],["y1","y2"],["1","0"]],
 *   "pi_c": ["x","y","1"],
 *   "protocol": "groth16",
 *   "curve": "bls12381"
 * }
 */
export function convertProof(proofJson) {
  if (proofJson.protocol !== 'groth16') {
    throw new Error(`Unsupported protocol: ${proofJson.protocol}`);
  }
  if (proofJson.curve !== 'bls12381') {
    throw new Error(`Unsupported curve: ${proofJson.curve}`);
  }
  const a = parseG1(proofJson.pi_a);
  const b = parseG2(proofJson.pi_b);
  const c = parseG1(proofJson.pi_c);
  return Buffer.concat([a, b, c]);
}

/**
 * Convert a snarkjs public.json array into canonical Soroban bytes.
 *
 * Expected JSON: array of decimal string scalars in Fr field.
 */
export function convertPublicSignals(publicJson) {
  if (!Array.isArray(publicJson)) {
    throw new Error('Public signals must be a JSON array');
  }
  const len = publicJson.length;
  if (len > 0xFFFFFFFF) {
    throw new Error(`Public signals count too large: ${len}`);
  }
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(len, 0);

  const parts = publicJson.map((s, i) => {
    const str = String(s);
    validateFr(str);
    return bigIntToBE(str, FR_BYTES);
  });

  return Buffer.concat([lenBuf, ...parts]);
}

/**
 * Compute SHA-256 hex digest of a Buffer.
 */
export function sha256(buf) {
  const crypto = (typeof globalThis !== 'undefined' && globalThis.crypto)
    || (typeof require !== 'undefined' ? require('crypto') : null);
  if (!crypto) {
    throw new Error('No crypto module available');
  }
  const hash = crypto.createHash ? crypto.createHash('sha256') : null;
  if (hash) {
    return hash.update(buf).digest('hex');
  }
  // Browser-compatible fallback using subtle crypto
  throw new Error('Only Node.js crypto.createHash is supported');
}

// Re-export sizes for tests
export const SIZES = {
  G1_SIZE,
  G2_SIZE,
  FQ_BYTES,
  FR_BYTES,
  FQ_MODULUS,
  FR_MODULUS,
};
