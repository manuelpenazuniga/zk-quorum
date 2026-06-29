import { describe, it, expect } from "vitest";
import { MockRelayAdapter } from "../src/adapters/relayAdapter.js";
import type { CastRequest, RevealRequest } from "@zk-quorum/protocol";

const R0_REQ: CastRequest = {
  electionId: "0x" + "01".repeat(32) as `0x${string}`,
  publicSchemaId: "PUBLIC_SCHEMA_V1_R0",
  publicSignals: ["0x" + "aa".repeat(32), "0", "5", "0x" + "bb".repeat(32), "0x" + "cc".repeat(32), "0x" + "dd".repeat(32)],
  proofBytes: "0x" + "ab".repeat(64) as `0x${string}`,
  idempotencyKey: "k-12345678",
  clientTag: "ct",
};

const REVEAL_REQ: RevealRequest = {
  electionId: "0x" + "01".repeat(32) as `0x${string}`,
  ballotCommitment: "0x" + "aa".repeat(32) as `0x${string}`,
  nullifierHash: "0x" + "bb".repeat(32) as `0x${string}`,
  vote: 0,
  salt: "0x" + "cc".repeat(32) as `0x${string}`,
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

  it("exposes a stable endpoint label", () => {
    const a = new MockRelayAdapter();
    expect(a.endpoint).toBe("mock://relayer");
  });
});
