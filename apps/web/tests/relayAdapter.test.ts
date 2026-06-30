import { describe, it, expect } from "vitest";
import { MockRelayAdapter } from "../src/adapters/relayAdapter.js";
import type { CastRequest, RevealRequest } from "@zk-quorum/protocol";

// Canonical decimal Fr wire format (no 0x, no leading zeros, in [0, r)).
const R0_REQ: CastRequest = {
  electionId: "0x" + "01".repeat(32) as `0x${string}`,
  publicSchemaId: "PUBLIC_SCHEMA_V1_R0",
  publicSignals: ["10", "0", "5", "11", "12", "13"],
  proofBytes: "0x" + "ab".repeat(64) as `0x${string}`,
  idempotencyKey: "k-12345678",
  clientTag: "ct",
};

const REVEAL_REQ: RevealRequest = {
  electionId: "0x" + "01".repeat(32) as `0x${string}`,
  ballotCommitment: "0x" + "0a".repeat(32) as `0x${string}`,
  vote: 0,
  salt: "0x" + "0b".repeat(32) as `0x${string}`,
  idempotencyKey: "k-12345678",
  clientTag: "ct",
};

describe("MockRelayAdapter", () => {
  it("accepts cast", async () => {
    const a = new MockRelayAdapter();
    const r = await a.submitCast(R0_REQ);
    expect(r.status).toBe("accepted");
    expect(r.txHash).toMatch(/^0x/);
  });

  it("accepts reveal", async () => {
    const a = new MockRelayAdapter();
    const r = await a.submitReveal(REVEAL_REQ);
    expect(r.status).toBe("accepted");
  });

  it("reveal response has no payloadHash / proofHash / publicSignalsHash (frozen U0)", async () => {
    const a = new MockRelayAdapter();
    const r = await a.submitReveal(REVEAL_REQ);
    expect((r as { payloadHash?: unknown }).payloadHash).toBeUndefined();
    expect((r as { proofHash?: unknown }).proofHash).toBeUndefined();
    expect((r as { publicSignalsHash?: unknown }).publicSignalsHash).toBeUndefined();
  });

  it("cast accepted response has real hashes, never zero placeholders", async () => {
    const a = new MockRelayAdapter();
    const r = await a.submitCast(R0_REQ);
    expect(r.proofHash).not.toBe("0x" + "00".repeat(32));
    expect(r.publicSignalsHash).not.toBe("0x" + "00".repeat(32));
  });

  it("cast accepted response derives nullifierHash from publicSignals[0] (frozen U0 wire format)", async () => {
    const a = new MockRelayAdapter();
    const r = await a.submitCast(R0_REQ);
    expect(r.nullifierHash).toBe("0x" + "0".repeat(63) + "a");
  });

  it("exposes a stable endpoint label", () => {
    const a = new MockRelayAdapter();
    expect(a.endpoint).toBe("mock://relayer");
  });
});
