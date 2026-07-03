/**
 * T0 Testnet R0 protocol helpers.
 * Parameterized by future contract ID for scope derivation and proof generation.
 *
 * These helpers exist only in the prepare-only / replay phases; they never
 * generate or hold secret material. Stellar secret-key (StrKey S...) scanning
 * is embedded in every evidence-reading code path.
 */
import { deriveElectionScope, BLS12_381_FR_MODULUS } from "./scope.js";
import { ZkqProtocolError } from "./errors.js";
import { isHex32 } from "./ids.js";
import type { Bytes32Hex } from "./ids.js";

// ── Constants ────────────────────────────────────────────────────────────────

export const T0_NETWORK = "testnet" as const;
export const T0_PASSPHRASE = "Test SDF Network ; September 2015" as const;
export const T0_SOURCE_IDENTITY = "zkq-t0-20260702" as const;
export const T0_EXPECTED_PUBLIC_ADDRESS =
  "GCWZZEAFBUN2S2WOV5FFBX4QVRA7AORQLMUHJDCIMZZCO24YDXVTLDAG" as const;

export const T0_HISTORICAL_VERIFIER =
  "CACFO5YAVIUZYINQTFDVHE5GBLYJ7ALQERA7AXB235KMWBIPHRRKZ57M" as const;

// Frozen WASM hashes from brief §3
export const T0_VERIFIER_WASM_SHA256 =
  "d6f6bb12d2e8f88ab34b076ef8800c8ea53c0e504ea8c85269b6cb6b75fa94ab" as const;
export const T0_ZK_QUORUM_WASM_SHA256 =
  "b9c6b42bafd7f1fe5b01884593793b804d0a88ed6be01eabab94c34fa0508c30" as const;

// Frozen C0 asset hashes from brief §3
export const T0_R0_ZKEY_SHA256 =
  "519cc5cb6f34227da36c0a11b75e7b684a3f2e85109b36e8485ea5adbd8330d1" as const;
export const T0_R1_ZKEY_SHA256 =
  "7ce3539ef7a2a160386e961edfd316e3c8b2f155957e1b46ff19e015eac5a8fb" as const;
export const T0_PTAU_SHA256 =
  "25f790d3e910135f71985f198b67ca10c7365b334f631e1d5a0c3a02d1c6c71f" as const;

export const T0_REQUIRED_TOOLS = {
  node: { major: 24, description: "Node 24" },
  rust: { major: 1, minor: 96, description: "Rust 1.96" },
  circom: { version: "2.2.3", description: "Circom 2.2.3" },
  snarkjs: { version: "0.7.6", description: "snarkjs 0.7.6" },
  stellar: { major: 27, description: "Stellar CLI 27" },
} as const;

// ── Secret scanning ──────────────────────────────────────────────────────────

const STRKEY_SECRET_RE = /\bS[A-Z2-7]{55}\b/g;

export function scanSecrets(text: string): string[] {
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = STRKEY_SECRET_RE.exec(text)) !== null) {
    matches.push(m[0]);
  }
  return matches;
}

export function assertNoSecrets(text: string, label: string): void {
  const found = scanSecrets(text);
  if (found.length > 0) {
    throw new ZkqProtocolError("BUNDLE_INVALID", `${label}: prohibited StrKey secret(s) found`, {
      label,
      count: found.length,
    });
  }
}

// ── Scope derivation (parameterized by contract ID) ──────────────────────────

export interface T0ElectionScopeParams {
  readonly contractId: Bytes32Hex;
  readonly electionId: Bytes32Hex;
  readonly networkPassphrase?: string;
}

export async function deriveT0Scope(params: T0ElectionScopeParams): Promise<Bytes32Hex> {
  const passphrase = params.networkPassphrase ?? T0_PASSPHRASE;
  if (passphrase !== T0_PASSPHRASE) {
    throw new ZkqProtocolError(
      "ELECTION_SCOPE_MISMATCH",
      "T0 scope derivation requires testnet passphrase",
      { passphrase },
    );
  }
  if (!isHex32(params.contractId)) {
    throw new ZkqProtocolError("INVALID_HEX", "contractId must be 0x-prefixed 32-byte hex", {
      contractId: params.contractId,
    });
  }
  if (!isHex32(params.electionId)) {
    throw new ZkqProtocolError("INVALID_HEX", "electionId must be 0x-prefixed 32-byte hex", {
      electionId: params.electionId,
    });
  }

  return deriveElectionScope({
    networkPassphrase: passphrase,
    contractId: params.contractId,
    electionId: params.electionId,
  });
}

// ── Random election ID generator ─────────────────────────────────────────────

export function generateElectionId(): Bytes32Hex {
  if (
    typeof globalThis.crypto === "undefined" ||
    typeof globalThis.crypto.getRandomValues !== "function"
  ) {
    throw new ZkqProtocolError("BUNDLE_INVALID", "globalThis.crypto.getRandomValues is not available");
  }
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `0x${hex}` as Bytes32Hex;
}

// ── Fr canonical validation ──────────────────────────────────────────────────

export function isValidFrDecimal(decStr: string): boolean {
  if (typeof decStr !== "string" || !/^[0-9]+$/.test(decStr)) return false;
  if (decStr.length > 1 && decStr[0] === "0") return false;
  try {
    const bi = BigInt(decStr);
    return bi >= 0n && bi < BLS12_381_FR_MODULUS;
  } catch {
    return false;
  }
}

export function frDecimalToCanonicalHex32(decStr: string): string {
  if (!isValidFrDecimal(decStr)) {
    throw new ZkqProtocolError("INVALID_FIELD_ELEMENT", "not a canonical Fr decimal", {
      value: decStr,
    });
  }
  const bi = BigInt(decStr);
  let hex = bi.toString(16);
  hex = hex.padStart(64, "0");
  return hex;
}

// ── Proof input preparation ──────────────────────────────────────────────────

export interface T0ProofInputOverrides {
  readonly electionScope: string; // BLS12-381 Fr decimal string
}

export interface T0ProofInput {
  readonly vote: string;
  readonly optionCount: string;
  readonly stateRoot: string;
  readonly associationRoot: string;
  readonly electionScope: string;
  readonly label: string;
  readonly nullifierSecret: string;
  readonly trapdoor: string;
  readonly stateIndex: string;
  readonly stateSiblings: string[];
  readonly associationIndex: string;
  readonly associationSiblings: string[];
}

/**
 * Creates a T0 proof input by overlaying a fixture with the real electionScope.
 * All values are kept as decimal strings (snarkjs canonical form).
 * The fixture MUST be r0-vote-0.json.
 */
export function prepareT0ProofInput(
  fixture: T0ProofInput,
  overrides: T0ProofInputOverrides,
): T0ProofInput {
  if (!isValidFrDecimal(overrides.electionScope)) {
    throw new ZkqProtocolError(
      "INVALID_FIELD_ELEMENT",
      "electionScope override is not a canonical Fr decimal",
      { value: overrides.electionScope },
    );
  }
  // Validate required fixture fields
  if (!fixture.vote) throw new ZkqProtocolError("MISSING_PUBLIC_SIGNAL", "fixture missing vote");
  if (!fixture.optionCount)
    throw new ZkqProtocolError("MISSING_PUBLIC_SIGNAL", "fixture missing optionCount");
  if (!fixture.stateRoot)
    throw new ZkqProtocolError("MISSING_PUBLIC_SIGNAL", "fixture missing stateRoot");
  if (!fixture.associationRoot)
    throw new ZkqProtocolError("MISSING_PUBLIC_SIGNAL", "fixture missing associationRoot");

  return {
    ...fixture,
    electionScope: overrides.electionScope,
  };
}

// ── Manifest schema for T0 evidence ──────────────────────────────────────────

export const T0_MANIFEST_REQUIRED_STRING_KEYS = [
  "network",
  "passphrase",
  "source_public_address",
  "verifier_wasm_sha256",
  "zkquorum_wasm_sha256",
  "vk_r0_sha256",
  "vk_r1_sha256",
  "election_id",
  "election_scope",
  "state_root",
  "association_root",
  "schema",
] as const;

export const T0_MANIFEST_REQUIRED_NUMBER_KEYS = [
  "option_count",
  "start_ledger",
  "end_ledger",
] as const;

export const T0_MANIFEST_ALL_KNOWN_KEYS = new Set<string>([
  ...T0_MANIFEST_REQUIRED_STRING_KEYS,
  ...T0_MANIFEST_REQUIRED_NUMBER_KEYS,
  "contract_ids",
  "tx_hashes",
  "proof_sha256",
  "public_sha256",
  "costs",
  "timestamp",
  "version",
]);

export interface T0Manifest {
  network: string;
  passphrase: string;
  source_public_address: string;
  verifier_wasm_sha256: string;
  zkquorum_wasm_sha256: string;
  vk_r0_sha256: string;
  vk_r1_sha256: string;
  election_id: string;
  election_scope: string;
  state_root: string;
  association_root: string;
  option_count: number;
  start_ledger: number;
  end_ledger: number;
  contract_ids?: Record<string, string>;
  tx_hashes?: Record<string, string>;
  proof_sha256?: string;
  public_sha256?: string;
  costs?: Record<string, string>;
  timestamp?: string;
  version?: string;
  [key: string]: unknown;
}

export function validateT0Manifest(manifest: unknown): manifest is T0Manifest {
  if (typeof manifest !== "object" || manifest === null)
    throw new ZkqProtocolError("MANIFEST_INVALID", "manifest must be a plain object");
  const m = manifest as Record<string, unknown>;

  for (const k of Object.keys(m)) {
    if (!T0_MANIFEST_ALL_KNOWN_KEYS.has(k)) {
      throw new ZkqProtocolError("MANIFEST_INVALID", `unknown key in manifest: ${k}`, { key: k });
    }
  }
  for (const k of T0_MANIFEST_REQUIRED_STRING_KEYS) {
    if (!(k in m)) throw new ZkqProtocolError("MANIFEST_INVALID", `missing required key: ${k}`);
    if (typeof m[k] !== "string")
      throw new ZkqProtocolError("MANIFEST_INVALID", `${k} must be string`);
  }
  for (const k of T0_MANIFEST_REQUIRED_NUMBER_KEYS) {
    if (!(k in m)) throw new ZkqProtocolError("MANIFEST_INVALID", `missing required key: ${k}`);
    const val = m[k];
    if (typeof val !== "number" || val < 0 || !Number.isInteger(val)) {
      throw new ZkqProtocolError("MANIFEST_INVALID", `${k} must be a non-negative integer`);
    }
  }
  if (m.schema !== "PUBLIC_SCHEMA_V1_R0")
    throw new ZkqProtocolError("MANIFEST_INVALID", "schema must be PUBLIC_SCHEMA_V1_R0");
  if (m.network !== T0_NETWORK)
    throw new ZkqProtocolError("MANIFEST_INVALID", "network must be testnet");
  if (m.passphrase !== T0_PASSPHRASE)
    throw new ZkqProtocolError("MANIFEST_INVALID", "wrong testnet passphrase");
  if (m.source_public_address !== T0_EXPECTED_PUBLIC_ADDRESS)
    throw new ZkqProtocolError("MANIFEST_INVALID", "wrong source public address");

  // verify 32-byte hex strings where applicable
  for (const k of [
    "verifier_wasm_sha256",
    "zkquorum_wasm_sha256",
    "vk_r0_sha256",
    "vk_r1_sha256",
  ]) {
    const v = m[k] as string;
    if (!/^[0-9a-f]{64}$/.test(v)) {
      throw new ZkqProtocolError("MANIFEST_INVALID", `${k} must be 64-char hex`);
    }
  }

  return true;
}

// ── WASM hash comparison ─────────────────────────────────────────────────────

export function compareWasmHashes(
  label: string,
  actual: string,
  expected: string,
): void {
  if (actual !== expected) {
    throw new ZkqProtocolError("WASM_HASH_MISMATCH", `${label}: SHA-256 mismatch`, {
      label,
      actual,
      expected,
    });
  }
}
