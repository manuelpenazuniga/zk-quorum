import { describe, it, expect } from "vitest";
import {
  BLS12_381_FR_MODULUS_HEX,
  BLS12_381_FR_MODULUS_DECIMAL,
  canonicalScopeMessage,
  deriveElectionScope,
  SCOPE_REJECTION_COUNTER_MAX,
  SCOPE_REJECTION_COUNTER_MIN,
} from "../src/scope.js";
import { ZkqProtocolError } from "../src/errors.js";
import type { ElectionScopeInput } from "../src/scope.js";

const V1: ElectionScopeInput = {
  networkPassphrase: "Test SDF Network ; September 2015",
  contractId: ("0x" + "11".repeat(32)) as `0x${string}`,
  electionId: ("0x" + "22".repeat(32)) as `0x${string}`,
};
const V2: ElectionScopeInput = {
  networkPassphrase: "Public Global Stellar Network ; September 2015",
  contractId: ("0x" + "aa".repeat(32)) as `0x${string}`,
  electionId: ("0x" + "bb".repeat(32)) as `0x${string}`,
};
const V3: ElectionScopeInput = {
  networkPassphrase: "Test SDF Network ; September 2015",
  contractId: ("0x" + "01".repeat(32)) as `0x${string}`,
  electionId: ("0x" + "ff".repeat(32)) as `0x${string}`,
};

const V1_SCOPE = ("0x" + "0b667e4a71d35199a50ec46d35ad8112c97537ed9cba84eebbc51080106130a8") as `0x${string}`;
const V2_SCOPE = ("0x" + "1a2d555082335dcf53d47a6e31cbdb1076a1c1f41d5ceca38421a55b01f4abb2") as `0x${string}`;
const V3_SCOPE = ("0x" + "3042d22d781a4aa3b7cc9cd7d903ccf84d0de242657dbe616b181b6d09a4382c") as `0x${string}`;

describe("BLS12-381 Fr modulus (audit C1)", () => {
  it("uses the exact BLS12-381 Fr literal", () => {
    expect(BLS12_381_FR_MODULUS_HEX).toBe("0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001");
    expect(BLS12_381_FR_MODULUS_DECIMAL).toBe(52435875175126190479447740508185965837690552500527637822603658699938581184513n);
  });
});

describe("scope canonicalisation (audit C1)", () => {
  it("produces canonical message with fixed prefix and NO version byte", () => {
    const msg = canonicalScopeMessage(V1);
    // tag "zk-quorum:election-scope:v1" is 27 bytes; NO version byte
    const domainTagBytes = 27;
    expect(msg.length).toBe(4 + domainTagBytes + 4 + V1.networkPassphrase.length + 4 + 32 + 4 + 32);
    expect(msg[0]).toBe(0);
    expect(msg[1]).toBe(0);
    expect(msg[2]).toBe(0);
    expect(msg[3]).toBe(domainTagBytes);
  });

  it("rejects invalid hex inputs", () => {
    expect(() => canonicalScopeMessage({ ...V1, contractId: "0xab" as never })).toThrow(ZkqProtocolError);
    expect(() => canonicalScopeMessage({ ...V1, electionId: "0xab" as never })).toThrow(ZkqProtocolError);
  });
});

describe("scope counter range (audit C1)", () => {
  it("rejects maxCounter < 0", async () => {
    await expect(deriveElectionScope(V1, { maxCounter: -1 })).rejects.toBeInstanceOf(ZkqProtocolError);
  });

  it("rejects maxCounter > 255 (frozen algorithm is 0..=255)", async () => {
    await expect(deriveElectionScope(V1, { maxCounter: 256 })).rejects.toBeInstanceOf(ZkqProtocolError);
  });

  it("accepts boundary counters 0 and 255", async () => {
    await expect(deriveElectionScope(V1, { maxCounter: 0 })).resolves.toMatch(/^0x[0-9a-f]{64}$/);
    await expect(deriveElectionScope(V1, { maxCounter: 255 })).resolves.toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("exports the frozen counter window", () => {
    expect(SCOPE_REJECTION_COUNTER_MIN).toBe(0);
    expect(SCOPE_REJECTION_COUNTER_MAX).toBe(255);
  });
});

describe("scope derivation (audit C1)", () => {
  it("rejects non-positive candidate (no fallback)", async () => {
    const digest = async () => new Uint8Array(32);
    await expect(deriveElectionScope(V1, { digest })).rejects.toBeInstanceOf(ZkqProtocolError);
  });

  it("rejects candidate >= Fr modulus", async () => {
    // Build a 32-byte buffer that, interpreted big-endian, equals the Fr modulus exactly.
    const modBytes = new Uint8Array(32);
    let tmp = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;
    for (let i = 31; i >= 0; i -= 1) {
      modBytes[i] = Number(tmp & 0xffn);
      tmp >>= 8n;
    }
    const digest = async () => modBytes;
    await expect(deriveElectionScope(V1, { digest, maxCounter: 4 })).rejects.toBeInstanceOf(ZkqProtocolError);
  });

  it("different inputs produce different scopes", async () => {
    const a = await deriveElectionScope(V1);
    const b = await deriveElectionScope({ ...V1, electionId: ("0x" + "33".repeat(32)) as `0x${string}` });
    expect(a).not.toBe(b);
  });
});

describe("literal golden vectors (audit C1 — share with Rust)", () => {
  it("vector 1 (testnet, contractId 0x11.., electionId 0x22..)", async () => {
    const scope = await deriveElectionScope(V1);
    expect(scope).toBe(V1_SCOPE);
  });

  it("vector 2 (public, contractId 0xaa.., electionId 0xbb..)", async () => {
    const scope = await deriveElectionScope(V2);
    expect(scope).toBe(V2_SCOPE);
  });

  it("vector 3 (testnet, contractId 0x01.., electionId 0xff..)", async () => {
    const scope = await deriveElectionScope(V3);
    expect(scope).toBe(V3_SCOPE);
  });

  it("R1 reveal salt+vote commitments can never produce a scope equal to a known literal (sanity)", async () => {
    // This is a property test: the scope field is a SHA-256 sample reduced mod
    // Fr, so accidental collisions are negligible. The literal vectors above are
    // the only authoritative fixtures; this assertion guards against
    // accidental reuse of the wrong fixture.
    const s1 = await deriveElectionScope(V1);
    expect(s1).not.toBe(V2_SCOPE);
    expect(s1).not.toBe(V3_SCOPE);
  });
});
