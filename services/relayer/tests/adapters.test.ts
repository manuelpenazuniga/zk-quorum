import { describe, it, expect } from "vitest";
import { MockOffchainVerifier, MockSimulator, MockSubmitter, hashEnvelope, validateCastRequestShape, validateRevealRequestShape } from "../src/adapters/mockAdapters.js";
import { Groth16SnarkjsVerifier, StellarSubmitter, SorobanSimulator } from "../src/adapters/snarkjsAdapter.js";
import { executeCast, executeReveal } from "../src/adapters/pipeline.js";
import { ZkqProtocolError } from "@zk-quorum/protocol";

// All six public signal slots are canonical decimal Fr strings in [0, r).
// We use small values (10, 11, 12, 13) that are valid in the BLS12-381
// scalar field; large hex literals like "0xaa"*32 are > r and invalid.
const R0 = {
  electionId: ("0x" + "01".repeat(32)) as `0x${string}`,
  publicSchemaId: "PUBLIC_SCHEMA_V1_R0",
  publicSignals: [
    "10",
    "3",
    "5",
    "11",
    "12",
    "13",
  ],
  proofBytes: ("0x" + "ab".repeat(64)) as `0x${string}`,
};

function hex(n: number): `0x${string}` {
  return ("0x" + n.toString(16).padStart(64, "0")) as `0x${string}`;
}
void hex;

const CAST_REQ = { action: "cast" as const, ...R0, idempotencyKey: "k-12345678", clientTag: "ct" };

describe("mockAdapters", () => {
  it("verifier accepts a well-formed envelope and returns hashes", async () => {
    const v = new MockOffchainVerifier();
    const r = await v.verifyProof(R0);
    expect(r.ok).toBe(true);
  });

  it("verifier rejects out-of-range vote", async () => {
    const v = new MockOffchainVerifier();
    const r = await v.verifyProof({ ...R0, publicSignals: [...R0.publicSignals.slice(0, 1), "5", "5", ...R0.publicSignals.slice(3)] });
    expect(r.ok).toBe(false);
  });

  it("verifier rejects unknown schema", async () => {
    const v = new MockOffchainVerifier();
    const r = await v.verifyProof({ ...R0, publicSchemaId: "PUBLIC_SCHEMA_V1_R9" });
    expect(r.ok).toBe(false);
  });

  it("verifier rejects bad hex proof", async () => {
    const v = new MockOffchainVerifier();
    const r = await v.verifyProof({ ...R0, proofBytes: "0x" as `0x${string}` });
    expect(r.ok).toBe(false);
  });

  it("verifier can be configured to fail", async () => {
    const v = new MockOffchainVerifier({ acceptAll: false });
    const r = await v.verifyProof(R0);
    expect(r.ok).toBe(false);
  });

  it("verifier rejects a public signal equal to or above the Fr modulus (frozen U0)", async () => {
    const v = new MockOffchainVerifier();
    // Replace nullifierHash with r; the wire is now decimal strings, so
    // a value at the modulus is invalid even though it would fit in 32
    // bytes.
    const r = await v.verifyProof({ ...R0, publicSignals: [((1n << 255n) - 19n).toString(), ...R0.publicSignals.slice(1)] });
    expect(r.ok).toBe(false);
  });

  it("simulator returns fee and resources", async () => {
    const s = new MockSimulator();
    const r = await s.simulateCast(R0);
    expect(r.ok).toBe(true);
  });

  it("simulator can be configured to fail", async () => {
    const s = new MockSimulator({ fail: true });
    const r = await s.simulateCast(R0);
    expect(r.ok).toBe(false);
  });

  it("submitter signs and returns tx hash", async () => {
    const s = new MockSubmitter({ account: "GABC" });
    const r = await s.submitCast(R0, ("0x" + "00".repeat(32)) as `0x${string}`, ("0x" + "11".repeat(32)) as `0x${string}`);
    expect(r.ok).toBe(true);
  });

  it("submitter.failOnce fails then succeeds", async () => {
    const s = new MockSubmitter({ failOnce: true });
    const r1 = await s.submitCast(R0, ("0x" + "00".repeat(32)) as `0x${string}`, ("0x" + "11".repeat(32)) as `0x${string}`);
    expect(r1.ok).toBe(false);
    const r2 = await s.submitCast(R0, ("0x" + "00".repeat(32)) as `0x${string}`, ("0x" + "11".repeat(32)) as `0x${string}`);
    expect(r2.ok).toBe(true);
  });

  it("hashEnvelope is deterministic for same input", () => {
    const a = hashEnvelope(R0);
    const b = hashEnvelope(R0);
    expect(a.proofHash).toBe(b.proofHash);
    expect(a.publicSignalsHash).toBe(b.publicSignalsHash);
  });
});

describe("snarkjs adapter", () => {
  it("Groth16SnarkjsVerifier rejects without VK", async () => {
    const v = new Groth16SnarkjsVerifier();
    const r = await v.verifyProof(R0);
    expect(r.ok).toBe(false);
  });

  it("Groth16SnarkjsVerifier accepts R0 with VK", async () => {
    const v = new Groth16SnarkjsVerifier({ vkR0Path: "/tmp/vk.json" });
    const r = await v.verifyProof(R0);
    expect(r.ok).toBe(false);
    expect((r as { code?: string }).code).toBe("ADAPTER_NOT_CONFIGURED");
  });

  it("StellarSubmitter rejects without config", async () => {
    const s = new StellarSubmitter();
    const r = await s.submitCast(R0, "0x" + "00".repeat(32) as `0x${string}`, "0x" + "11".repeat(32) as `0x${string}`);
    expect(r.ok).toBe(false);
  });

  it("SorobanSimulator throws until configured", async () => {
    const s = new SorobanSimulator();
    await expect(s.simulateCast(R0)).rejects.toBeInstanceOf(ZkqProtocolError);
  });
});

describe("pipeline (frozen U0 wire format)", () => {
  it("executeCast returns accepted response with verifier hashes", async () => {
    const r = await executeCast({
      envelope: R0,
      verifier: new MockOffchainVerifier(),
      simulator: new MockSimulator(),
      submitter: new MockSubmitter(),
    });
    expect(r.status).toBe("accepted");
    expect(r.txHash).toMatch(/^0x/);
    expect(r.proofHash).not.toBeNull();
    expect(r.publicSignalsHash).not.toBeNull();
  });

  it("executeCast rejection on verifier failure returns null hashes and null nullifier (NEVER placeholder)", async () => {
    const r = await executeCast({
      envelope: R0,
      verifier: new MockOffchainVerifier({ acceptAll: false }),
      simulator: new MockSimulator(),
      submitter: new MockSubmitter(),
    });
    expect(r.status).toBe("rejected");
    expect(r.txHash).toBeNull();
    expect(r.nullifierHash).toBeNull();
    expect(r.proofHash).toBeNull();
    expect(r.publicSignalsHash).toBeNull();
    expect(r.rejectReason).toBeTruthy();
  });

  it("executeCast rejection on simulator failure returns null hashes and null nullifier", async () => {
    const r = await executeCast({
      envelope: R0,
      verifier: new MockOffchainVerifier(),
      simulator: new MockSimulator({ fail: true }),
      submitter: new MockSubmitter(),
    });
    expect(r.status).toBe("rejected");
    expect(r.txHash).toBeNull();
    expect(r.nullifierHash).toBeNull();
    expect(r.proofHash).toBeNull();
    expect(r.publicSignalsHash).toBeNull();
  });

  it("executeCast duplicate response carries real verifier hashes and a non-null txHash", async () => {
    const r = await executeCast({
      envelope: R0,
      verifier: new MockOffchainVerifier(),
      simulator: new MockSimulator(),
      submitter: new MockSubmitter({ duplicateOnce: true }),
    });
    expect(r.status).toBe("duplicate");
    expect(r.txHash).toMatch(/^0x/);
    expect(r.nullifierHash).toMatch(/^0x/);
    expect(r.proofHash).toMatch(/^0x/);
    expect(r.publicSignalsHash).toMatch(/^0x/);
    expect(r.rejectReason).toBeNull();
  });

  it("executeReveal succeeds and has no payloadHash / proofHash / publicSignalsHash", async () => {
    const r = await executeReveal({
      electionId: ("0x" + "01".repeat(32)),
      ballotCommitment: ("0x" + "02".repeat(32)),
      vote: 2,
      salt: ("0x" + "03".repeat(32)),
      submitter: new MockSubmitter(),
      simulator: new MockSimulator(),
    });
    expect(r.status).toBe("accepted");
    expect((r as { payloadHash?: unknown }).payloadHash).toBeUndefined();
    expect((r as { proofHash?: unknown }).proofHash).toBeUndefined();
    expect((r as { publicSignalsHash?: unknown }).publicSignalsHash).toBeUndefined();
  });

  it("executeReveal rejection has no payloadHash / proofHash / publicSignalsHash", async () => {
    const r = await executeReveal({
      electionId: ("0x" + "01".repeat(32)),
      ballotCommitment: ("0x" + "02".repeat(32)),
      vote: 2,
      salt: ("0x" + "03".repeat(32)),
      submitter: new MockSubmitter(),
      simulator: new MockSimulator({ fail: true }),
    });
    expect(r.status).toBe("rejected");
    expect((r as { payloadHash?: unknown }).payloadHash).toBeUndefined();
  });
});

describe("request validation (production requestValidation.ts)", () => {
  it("validateCastRequestShape accepts the canonical shape (action=cast, 6 decimal Fr signals)", () => {
    expect(() => validateCastRequestShape(CAST_REQ, { maxProofBytes: 8192 })).not.toThrow();
  });

  it("validateCastRequestShape requires action='cast'", () => {
    expect(() => validateCastRequestShape({ ...CAST_REQ, action: "reveal" as never }, { maxProofBytes: 8192 })).toThrow(/action discriminator/);
    expect(() => validateCastRequestShape({ ...CAST_REQ, action: undefined as never }, { maxProofBytes: 8192 })).toThrow(/action discriminator/);
  });

  it("validateCastRequestShape rejects bad schema", () => {
    expect(() => validateCastRequestShape({ ...CAST_REQ, publicSchemaId: "NOPE" }, { maxProofBytes: 8192 })).toThrow(ZkqProtocolError);
  });

  it("validateCastRequestShape rejects bad hex proof", () => {
    expect(() => validateCastRequestShape({ ...CAST_REQ, proofBytes: "abc" as `0x${string}` }, { maxProofBytes: 8192 })).toThrow(ZkqProtocolError);
  });

  it("validateCastRequestShape rejects bad idempotency key", () => {
    expect(() => validateCastRequestShape({ ...CAST_REQ, idempotencyKey: "x" }, { maxProofBytes: 8192 })).toThrow(ZkqProtocolError);
  });

  it("validateCastRequestShape requires EXACTLY 6 signals (no more, no less)", () => {
    const tooFew = ["10", "3", "5", "11", "12"]; // 5
    const tooMany = Array.from({ length: 7 }, (_, i) => String(i + 10)); // 7
    expect(() => validateCastRequestShape({ ...CAST_REQ, publicSignals: tooFew }, { maxProofBytes: 8192 })).toThrow(/INVALID_SIGNAL_COUNT/);
    expect(() => validateCastRequestShape({ ...CAST_REQ, publicSignals: tooMany }, { maxProofBytes: 8192 })).toThrow(/INVALID_SIGNAL_COUNT/);
  });

  it("validateCastRequestShape rejects hex public signals (audit: wire format is decimal)", () => {
    const hexSignals = ["0x" + "0a".repeat(32), "3", "5", "0x" + "0b".repeat(32), "0x" + "0c".repeat(32), "0x" + "0d".repeat(32)];
    expect(() => validateCastRequestShape({ ...CAST_REQ, publicSignals: hexSignals }, { maxProofBytes: 8192 })).toThrow(/INVALID_FIELD_ELEMENT/);
  });

  it("validateCastRequestShape rejects leading-zero public signals", () => {
    expect(() => validateCastRequestShape({ ...CAST_REQ, publicSignals: ["00", "3", "5", "11", "12", "13"] }, { maxProofBytes: 8192 })).toThrow(/INVALID_FIELD_ELEMENT/);
  });

  it("validateCastRequestShape rejects oversized proof (integrator)", () => {
    const big = "0x" + "ab".repeat(8193);
    expect(() => validateCastRequestShape({ ...CAST_REQ, proofBytes: big as `0x${string}` }, { maxProofBytes: 8192 })).toThrow(ZkqProtocolError);
  });

  it("validateCastRequestShape rejects publicSignals non-string elements", () => {
    expect(() => validateCastRequestShape({ ...CAST_REQ, publicSignals: [1, 2, 3, 4, 5, 6] as unknown as string[] }, { maxProofBytes: 8192 })).toThrow(ZkqProtocolError);
  });

  it("validateCastRequestShape rejects unknown keys (allowlist)", () => {
    expect(() => validateCastRequestShape({ ...CAST_REQ, foo: "bar" }, { maxProofBytes: 8192 })).toThrow(/unknown key/);
  });

  it("validateRevealRequestShape accepts the canonical shape", () => {
    expect(() => validateRevealRequestShape({
      action: "reveal",
      electionId: "0x" + "01".repeat(32),
      ballotCommitment: "0x" + "0a".repeat(32),
      vote: 2,
      salt: "0x" + "0b".repeat(32),
      idempotencyKey: "k-12345678",
      clientTag: "ct",
    })).not.toThrow();
  });

  it("validateRevealRequestShape accepts uppercase hex32 salt (case-insensitive)", () => {
    expect(() => validateRevealRequestShape({
      action: "reveal",
      electionId: "0x" + "01".repeat(32),
      ballotCommitment: "0x" + "0A".repeat(32),
      vote: 2,
      salt: "0x" + "0B".repeat(32),
      idempotencyKey: "k-12345678",
      clientTag: "ct",
    })).not.toThrow();
  });

  it("validateRevealRequestShape rejects negative vote", () => {
    expect(() => validateRevealRequestShape({
      action: "reveal",
      electionId: "0x" + "01".repeat(32),
      ballotCommitment: "0x" + "0a".repeat(32),
      vote: -1,
      salt: "0x" + "0b".repeat(32),
      idempotencyKey: "k-12345678",
      clientTag: "ct",
    })).toThrow(ZkqProtocolError);
  });

  it("validateRevealRequestShape rejects vote > 15", () => {
    expect(() => validateRevealRequestShape({
      action: "reveal",
      electionId: "0x" + "01".repeat(32),
      ballotCommitment: "0x" + "0a".repeat(32),
      vote: 16,
      salt: "0x" + "0b".repeat(32),
      idempotencyKey: "k-12345678",
      clientTag: "ct",
    })).toThrow(/INVALID_VOTE_RANGE/);
  });

  it("validateRevealRequestShape rejects salt = 0 (must satisfy 0 < salt < Fr)", () => {
    expect(() => validateRevealRequestShape({
      action: "reveal",
      electionId: "0x" + "01".repeat(32),
      ballotCommitment: "0x" + "0a".repeat(32),
      vote: 1,
      salt: "0x" + "00".repeat(32),
      idempotencyKey: "k-12345678",
      clientTag: "ct",
    })).toThrow(/R1_NON_ZERO_SALT/);
  });

  it("validateRevealRequestShape rejects salt >= Fr", () => {
    // r in hex
    const rHex = "0x" + "73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001";
    expect(() => validateRevealRequestShape({
      action: "reveal",
      electionId: "0x" + "01".repeat(32),
      ballotCommitment: "0x" + "0a".repeat(32),
      vote: 1,
      salt: rHex as `0x${string}`,
      idempotencyKey: "k-12345678",
      clientTag: "ct",
    })).toThrow(/INVALID_FIELD_ELEMENT/);
  });

  it("validateRevealRequestShape rejects unknown keys (allowlist)", () => {
    expect(() => validateRevealRequestShape({
      action: "reveal",
      electionId: "0x" + "01".repeat(32),
      ballotCommitment: "0x" + "0a".repeat(32),
      vote: 1,
      salt: "0x" + "0b".repeat(32),
      idempotencyKey: "k-12345678",
      clientTag: "ct",
      publicSignals: ["1"],
    })).toThrow(/unknown key/);
  });
});
