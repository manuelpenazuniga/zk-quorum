import { describe, it, expect } from "vitest";
import { HttpRelayAdapter, MockRelayAdapter } from "../src/adapters/relayAdapter.js";
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

function fakeFetch(status: number, body: unknown): typeof fetch {
  return async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response;
}

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

  it("accepted cast response has all four non-null fields and null rejectReason", async () => {
    const a = new MockRelayAdapter();
    const r = await a.submitCast(R0_REQ);
    expect(r.status).toBe("accepted");
    expect(r.txHash).not.toBeNull();
    expect(r.nullifierHash).not.toBeNull();
    expect(r.proofHash).not.toBeNull();
    expect(r.publicSignalsHash).not.toBeNull();
    expect(r.rejectReason).toBeNull();
  });
});

describe("HttpRelayAdapter", () => {
  it("HTTP error returns rejected with all hash fields null and does not derive nullifier from request", async () => {
    const a = new HttpRelayAdapter("http://localhost:9999", fakeFetch(503, { error: { code: "service_unavailable", message: "relay down" } }));
    const r = await a.submitCast(R0_REQ);
    expect(r.status).toBe("rejected");
    expect(r.txHash).toBeNull();
    expect(r.nullifierHash).toBeNull();
    expect(r.proofHash).toBeNull();
    expect(r.publicSignalsHash).toBeNull();
    expect(r.rejectReason).toBe("relay down");
  });

  it("HTTP 400 error returns rejected with all hash fields null", async () => {
    const a = new HttpRelayAdapter("http://localhost:9999", fakeFetch(400, { error: { code: "invalid_request", message: "bad signals" } }));
    const r = await a.submitCast(R0_REQ);
    expect(r.status).toBe("rejected");
    expect(r.txHash).toBeNull();
    expect(r.nullifierHash).toBeNull();
    expect(r.proofHash).toBeNull();
    expect(r.publicSignalsHash).toBeNull();
    expect(r.rejectReason).toBe("bad signals");
  });
});
