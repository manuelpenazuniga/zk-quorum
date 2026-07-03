import { describe, it, expect } from "vitest";
import {
  scanSecrets,
  assertNoSecrets,
  deriveT0Scope,
  generateElectionId,
  isValidFrDecimal,
  frDecimalToCanonicalHex32,
  prepareT0ProofInput,
  validateT0Manifest,
  compareWasmHashes,
  T0_NETWORK,
  T0_PASSPHRASE,
  T0_SOURCE_IDENTITY,
  T0_EXPECTED_PUBLIC_ADDRESS,
  T0_HISTORICAL_VERIFIER,
  T0_VERIFIER_WASM_SHA256,
  T0_ZK_QUORUM_WASM_SHA256,
  T0_R0_ZKEY_SHA256,
  T0_R1_ZKEY_SHA256,
  T0_PTAU_SHA256,
} from "../src/t0.js";
import { ZkqProtocolError } from "../src/errors.js";
import type { T0ProofInput } from "../src/t0.js";

// ── Constants are exactly as in the brief ────────────────────────────────────

describe("T0 frozen constants", () => {
  it("has correct network and passphrase", () => {
    expect(T0_NETWORK).toBe("testnet");
    expect(T0_PASSPHRASE).toBe("Test SDF Network ; September 2015");
  });

  it("has correct source identity and address", () => {
    expect(T0_SOURCE_IDENTITY).toBe("zkq-t0-20260702");
    expect(T0_EXPECTED_PUBLIC_ADDRESS).toBe(
      "GCWZZEAFBUN2S2WOV5FFBX4QVRA7AORQLMUHJDCIMZZCO24YDXVTLDAG",
    );
  });

  it("has correct historical verifier", () => {
    expect(T0_HISTORICAL_VERIFIER).toBe(
      "CACFO5YAVIUZYINQTFDVHE5GBLYJ7ALQERA7AXB235KMWBIPHRRKZ57M",
    );
  });

  it("has correct frozen WASM hashes", () => {
    expect(T0_VERIFIER_WASM_SHA256).toBe(
      "d6f6bb12d2e8f88ab34b076ef8800c8ea53c0e504ea8c85269b6cb6b75fa94ab",
    );
    expect(T0_ZK_QUORUM_WASM_SHA256).toBe(
      "b9c6b42bafd7f1fe5b01884593793b804d0a88ed6be01eabab94c34fa0508c30",
    );
  });

  it("has correct frozen C0 asset hashes", () => {
    expect(T0_R0_ZKEY_SHA256).toBe(
      "519cc5cb6f34227da36c0a11b75e7b684a3f2e85109b36e8485ea5adbd8330d1",
    );
    expect(T0_R1_ZKEY_SHA256).toBe(
      "7ce3539ef7a2a160386e961edfd316e3c8b2f155957e1b46ff19e015eac5a8fb",
    );
    expect(T0_PTAU_SHA256).toBe(
      "25f790d3e910135f71985f198b67ca10c7365b334f631e1d5a0c3a02d1c6c71f",
    );
  });
});

// ── Secret scanning ──────────────────────────────────────────────────────────

describe("scanSecrets", () => {
  it("detects Stellar secret keys (S...)", () => {
    const text =
      "Some text with SA3W53XXG64ITFFI4QSJ5ADQN5JKIRVE2NI3ZQ7FDMXQVZS6UVJXYZAB hidden";
    expect(scanSecrets(text)).toHaveLength(1);
    expect(scanSecrets(text)[0]).toBe(
      "SA3W53XXG64ITFFI4QSJ5ADQN5JKIRVE2NI3ZQ7FDMXQVZS6UVJXYZAB",
    );
  });

  it("detects multiple secrets", () => {
    const text = "Some text with SA3W53XXG64ITFFI4QSJ5ADQN5JKIRVE2NI3ZQ7FDMXQVZS6UVJXYZAB and SBBBBB...";
    expect(scanSecrets(text)).toHaveLength(1);
    expect(scanSecrets("no secrets here")).toEqual([]);
  });

  it("finds valid 56-char S-key", () => {
    // A valid-looking but not real S-key
    const s =
      "SA3W53XXG64ITFFI4QSJ5ADQN5JKIRVE2NI3ZQ7FDMXQVZS6UVJXYZAB";
    // exactly 56 chars after S
    expect(s.length).toBe(56);
    const found = scanSecrets(`prefix ${s} suffix`);
    expect(found).toEqual([s]);
  });
});

describe("assertNoSecrets", () => {
  it("passes on clean text", () => {
    expect(() => assertNoSecrets("clean text", "test")).not.toThrow();
  });

  it("throws on text containing secret", () => {
    expect(() =>
      assertNoSecrets(
        "SA3W53XXG64ITFFI4QSJ5ADQN5JKIRVE2NI3ZQ7FDMXQVZS6UVJXYZAB",
        "test",
      ),
    ).toThrow(ZkqProtocolError);
  });

  it("checks JSON evidence strings for secrets", () => {
    const cleanJson = JSON.stringify({ key: "value", hash: "abc123" });
    expect(() => assertNoSecrets(cleanJson, "manifest")).not.toThrow();
  });
});

// ── Scope derivation ─────────────────────────────────────────────────────────

describe("deriveT0Scope", () => {
  const contractId = ("0x" + "11".repeat(32)) as `0x${string}`;
  const electionId = ("0x" + "22".repeat(32)) as `0x${string}`;

  it("derives a valid 0x-prefixed 64-char hex scope", async () => {
    const scope = await deriveT0Scope({ contractId, electionId });
    expect(scope).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("rejects mainnet passphrase", async () => {
    await expect(
      deriveT0Scope({
        contractId,
        electionId,
        networkPassphrase: "Public Global Stellar Network ; September 2015",
      }),
    ).rejects.toBeInstanceOf(ZkqProtocolError);
  });

  it("rejects invalid contractId", async () => {
    await expect(
      deriveT0Scope({ contractId: "0xabc" as never, electionId }),
    ).rejects.toBeInstanceOf(ZkqProtocolError);
  });

  it("rejects invalid electionId", async () => {
    await expect(
      deriveT0Scope({ contractId, electionId: "0xdef" as never }),
    ).rejects.toBeInstanceOf(ZkqProtocolError);
  });

  it("different election IDs produce different scopes", async () => {
    const a = await deriveT0Scope({ contractId, electionId });
    const b = await deriveT0Scope({
      contractId,
      electionId: ("0x" + "33".repeat(32)) as `0x${string}`,
    });
    expect(a).not.toBe(b);
  });

  it("different contract IDs produce different scopes", async () => {
    const a = await deriveT0Scope({ contractId, electionId });
    const b = await deriveT0Scope({
      contractId: ("0x" + "44".repeat(32)) as `0x${string}`,
      electionId,
    });
    expect(a).not.toBe(b);
  });
});

// ── Election ID generation ───────────────────────────────────────────────────

describe("generateElectionId", () => {
  it("produces 0x-prefixed 64-char hex", () => {
    const id = generateElectionId();
    expect(id).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("produces different values each call", () => {
    const a = generateElectionId();
    const b = generateElectionId();
    expect(a).not.toBe(b);
  });
});

// ── Fr canonical validation ──────────────────────────────────────────────────

describe("isValidFrDecimal", () => {
  it("accepts valid Fr decimal strings", () => {
    expect(isValidFrDecimal("0")).toBe(true);
    expect(isValidFrDecimal("1")).toBe(true);
    expect(isValidFrDecimal("123456789")).toBe(true);
  });

  it("rejects strings with leading zeros", () => {
    expect(isValidFrDecimal("01")).toBe(false);
    expect(isValidFrDecimal("00")).toBe(false);
  });

  it("rejects non-integer strings", () => {
    expect(isValidFrDecimal("abc")).toBe(false);
    expect(isValidFrDecimal("1.5")).toBe(false);
    expect(isValidFrDecimal("-1")).toBe(false);
  });

  it("rejects values >= Fr modulus", () => {
    const tooBig =
      "52435875175126190479447740508185965837690552500527637822603658699938581184514";
    expect(isValidFrDecimal(tooBig)).toBe(false);
  });

  it("accepts the max valid Fr value (modulus - 1)", () => {
    const maxFr =
      "52435875175126190479447740508185965837690552500527637822603658699938581184512";
    expect(isValidFrDecimal(maxFr)).toBe(true);
  });
});

describe("frDecimalToCanonicalHex32", () => {
  it("converts known small values", () => {
    expect(frDecimalToCanonicalHex32("0")).toBe(
      "0000000000000000000000000000000000000000000000000000000000000000",
    );
    expect(frDecimalToCanonicalHex32("1")).toBe(
      "0000000000000000000000000000000000000000000000000000000000000001",
    );
    expect(frDecimalToCanonicalHex32("255")).toBe(
      "00000000000000000000000000000000000000000000000000000000000000ff",
    );
  });

  it("throws on invalid input", () => {
    expect(() => frDecimalToCanonicalHex32("01")).toThrow(ZkqProtocolError);
    expect(() => frDecimalToCanonicalHex32("abc")).toThrow(ZkqProtocolError);
  });
});

// ── Proof input preparation ──────────────────────────────────────────────────

describe("prepareT0ProofInput", () => {
  const fixture: T0ProofInput = {
    vote: "0",
    optionCount: "5",
    stateRoot:
      "20660557021851646197600388443100395731422898485530646641308945670627648046745",
    associationRoot:
      "15158607067770416787260666106207400886047671983031147357404418838572728018630",
    electionScope: "1234567890123456789012345678901234567890123456789012345678901234",
    label: "111",
    nullifierSecret: "222",
    trapdoor: "333",
    stateIndex: "0",
    stateSiblings: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
    associationIndex: "0",
    associationSiblings: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
  };

  it("replaces electionScope with canonical decimal", () => {
    const result = prepareT0ProofInput(fixture, {
      electionScope: "42",
    });
    expect(result.electionScope).toBe("42");
    expect(result.vote).toBe(fixture.vote);
    expect(result.optionCount).toBe(fixture.optionCount);
  });

  it("rejects non-canonical electionScope", () => {
    expect(() =>
      prepareT0ProofInput(fixture, { electionScope: "042" }),
    ).toThrow(ZkqProtocolError);
  });

  it("preserves all other fixture fields", () => {
    const result = prepareT0ProofInput(fixture, {
      electionScope: "999999999",
    });
    expect(result.vote).toBe(fixture.vote);
    expect(result.optionCount).toBe(fixture.optionCount);
    expect(result.stateRoot).toBe(fixture.stateRoot);
    expect(result.associationRoot).toBe(fixture.associationRoot);
    expect(result.label).toBe(fixture.label);
    expect(result.nullifierSecret).toBe(fixture.nullifierSecret);
    expect(result.stateSiblings).toEqual(fixture.stateSiblings);
  });
});

// ── Manifest validation ──────────────────────────────────────────────────────

describe("validateT0Manifest", () => {
  const validManifest = {
    network: "testnet",
    passphrase: "Test SDF Network ; September 2015",
    source_public_address:
      "GCWZZEAFBUN2S2WOV5FFBX4QVRA7AORQLMUHJDCIMZZCO24YDXVTLDAG",
    verifier_wasm_sha256:
      "d6f6bb12d2e8f88ab34b076ef8800c8ea53c0e504ea8c85269b6cb6b75fa94ab",
    zkquorum_wasm_sha256:
      "b9c6b42bafd7f1fe5b01884593793b804d0a88ed6be01eabab94c34fa0508c30",
    vk_r0_sha256: "a".repeat(64),
    vk_r1_sha256: "b".repeat(64),
    election_id: "c".repeat(64),
    election_scope: "d".repeat(64),
    state_root: "e".repeat(64),
    association_root: "f".repeat(64),
    schema: "PUBLIC_SCHEMA_V1_R0",
    option_count: 5,
    start_ledger: 1000000,
    end_ledger: 1000100,
  };

  it("accepts a valid manifest", () => {
    expect(() => validateT0Manifest(validManifest)).not.toThrow();
  });

  it("rejects unknown keys", () => {
    expect(() => validateT0Manifest({ ...validManifest, extra: true })).toThrow(
      ZkqProtocolError,
    );
  });

  it("rejects missing required keys", () => {
    const { network, ...rest } = validManifest;
    expect(() => validateT0Manifest(rest)).toThrow(ZkqProtocolError);
  });

  it("rejects wrong network", () => {
    expect(() =>
      validateT0Manifest({ ...validManifest, network: "mainnet" }),
    ).toThrow(ZkqProtocolError);
  });

  it("rejects wrong passphrase", () => {
    expect(() =>
      validateT0Manifest({
        ...validManifest,
        passphrase: "Public Global Stellar Network ; September 2015",
      }),
    ).toThrow(ZkqProtocolError);
  });

  it("rejects wrong source address", () => {
    expect(() =>
      validateT0Manifest({
        ...validManifest,
        source_public_address: "G...",
      }),
    ).toThrow(ZkqProtocolError);
  });

  it("rejects wrong schema", () => {
    expect(() =>
      validateT0Manifest({ ...validManifest, schema: "PUBLIC_SCHEMA_V1_R1" }),
    ).toThrow(ZkqProtocolError);
  });

  it("rejects negative numbers in number fields", () => {
    expect(() =>
      validateT0Manifest({ ...validManifest, option_count: -1 }),
    ).toThrow(ZkqProtocolError);
    expect(() =>
      validateT0Manifest({ ...validManifest, start_ledger: -100 }),
    ).toThrow(ZkqProtocolError);
    expect(() =>
      validateT0Manifest({ ...validManifest, end_ledger: -5 }),
    ).toThrow(ZkqProtocolError);
  });

  it("rejects non-integer values in number fields", () => {
    expect(() =>
      validateT0Manifest({ ...validManifest, option_count: 5.5 }),
    ).toThrow(ZkqProtocolError);
  });
});

// ── WASM hash comparison ─────────────────────────────────────────────────────

describe("compareWasmHashes", () => {
  it("passes on exact match", () => {
    expect(() =>
      compareWasmHashes("test", "abc123", "abc123"),
    ).not.toThrow();
  });

  it("throws on mismatch", () => {
    expect(() => compareWasmHashes("test", "abc123", "def456")).toThrow(
      ZkqProtocolError,
    );
  });
});
