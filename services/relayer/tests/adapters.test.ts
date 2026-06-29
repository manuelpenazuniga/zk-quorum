import { describe, it, expect } from "vitest";
import { MockOffchainVerifier, MockSimulator, MockSubmitter, hashEnvelope, validateCastRequestShape, validateRevealRequestShape } from "../src/adapters/mockAdapters.js";
import { Groth16SnarkjsVerifier, StellarSubmitter, SorobanSimulator } from "../src/adapters/snarkjsAdapter.js";
import { executeCast, executeReveal } from "../src/adapters/pipeline.js";
import { ZkqProtocolError } from "@zk-quorum/protocol";

const R0 = {
  electionId: ("0x" + "01".repeat(32)) as `0x${string}`,
  publicSchemaId: "PUBLIC_SCHEMA_V1_R0",
  publicSignals: [
    "0x" + "aa".repeat(32),
    "3",
    "5",
    "0x" + "02".repeat(32),
    "0x" + "03".repeat(32),
    "0x" + "04".repeat(32),
  ],
  proofBytes: ("0x" + "ab".repeat(64)) as `0x${string}`,
};

function hex(n: number): `0x${string}` {
  return ("0x" + n.toString(16).padStart(64, "0")) as `0x${string}`;
}
void hex;

const CAST_REQ = { ...R0, idempotencyKey: "k-12345678", clientTag: "ct" };

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

describe("pipeline", () => {
  it("executeCast returns accepted response with hashes", async () => {
    const r = await executeCast({
      envelope: R0,
      verifier: new MockOffchainVerifier(),
      simulator: new MockSimulator(),
      submitter: new MockSubmitter(),
    });
    expect(r.status).toBe("accepted");
    expect(r.txHash).toMatch(/^0x/);
  });

  it("executeCast rejects on verifier failure", async () => {
    const r = await executeCast({
      envelope: R0,
      verifier: new MockOffchainVerifier({ acceptAll: false }),
      simulator: new MockSimulator(),
      submitter: new MockSubmitter(),
    });
    expect(r.status).toBe("rejected");
    expect(r.rejectReason).toBeTruthy();
  });

  it("executeCast rejects on simulator failure", async () => {
    const r = await executeCast({
      envelope: R0,
      verifier: new MockOffchainVerifier(),
      simulator: new MockSimulator({ fail: true }),
      submitter: new MockSubmitter(),
    });
    expect(r.status).toBe("rejected");
  });

  it("executeReveal succeeds with valid inputs", async () => {
    const r = await executeReveal({
      electionId: ("0x" + "01".repeat(32)),
      ballotCommitment: ("0x" + "02".repeat(32)),
      vote: 2,
      salt: ("0x" + "03".repeat(32)),
      submitter: new MockSubmitter(),
      simulator: new MockSimulator(),
    });
    expect(r.status).toBe("accepted");
  });
});

describe("request validation", () => {
  it("validateCastRequestShape accepts the canonical shape", () => {
    expect(() => validateCastRequestShape(CAST_REQ)).not.toThrow();
  });

  it("validateCastRequestShape rejects bad schema", () => {
    expect(() => validateCastRequestShape({ ...CAST_REQ, publicSchemaId: "NOPE" })).toThrow(ZkqProtocolError);
  });

  it("validateCastRequestShape rejects bad hex proof", () => {
    expect(() => validateCastRequestShape({ ...CAST_REQ, proofBytes: "abc" })).toThrow(ZkqProtocolError);
  });

  it("validateCastRequestShape rejects bad idempotency key", () => {
    expect(() => validateCastRequestShape({ ...CAST_REQ, idempotencyKey: "x" })).toThrow(ZkqProtocolError);
  });

  it("validateRevealRequestShape accepts the canonical shape", () => {
    expect(() => validateRevealRequestShape({
      electionId: "0x" + "01".repeat(32),
      ballotCommitment: "0x" + "02".repeat(32),
      nullifierHash: "0x" + "03".repeat(32),
      vote: 2,
      salt: "0x" + "04".repeat(32),
      idempotencyKey: "k-12345678",
      clientTag: "ct",
    })).not.toThrow();
  });

  it("validateRevealRequestShape rejects negative vote", () => {
    expect(() => validateRevealRequestShape({
      electionId: "0x" + "01".repeat(32),
      ballotCommitment: "0x" + "02".repeat(32),
      nullifierHash: "0x" + "03".repeat(32),
      vote: -1,
      salt: "0x" + "04".repeat(32),
      idempotencyKey: "k-12345678",
      clientTag: "ct",
    })).toThrow(ZkqProtocolError);
  });
});
