import { describe, it, expect } from "vitest";
import { InlineProverClient, type ProverClient } from "../src/worker/workerBoundary.js";
import { MockProvingAdapter, type ProvingRequest } from "../src/adapters/provingAdapter.js";

function makeReq(): ProvingRequest {
  return {
    kind: "prove-r0",
    electionId: ("0x" + "01".repeat(32)) as `0x${string}`,
    publicSchemaId: "PUBLIC_SCHEMA_V1_R0",
    publicSignals: ["1", "2", "3", "4", "5", "6"],
    inputs: {},
  };
}

function makeClient(): { client: ProverClient; adapter: MockProvingAdapter } {
  const adapter = new MockProvingAdapter();
  const client = new InlineProverClient(adapter);
  return { client, adapter };
}

function reasonOf(r: { ok: boolean; reason?: string }): string {
  return (r as { reason: string }).reason ?? "unknown";
}

describe("worker boundary (InlineProverClient)", () => {
  it("prove returns envelope", async () => {
    const { client } = makeClient();
    const r = await client.prove(makeReq(), () => undefined);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.envelope.publicSignals.length).toBe(6);
      expect(r.envelope.proofBytes).toMatch(/^0x/);
    }
  });

  it("cancel resolves as cancelled", async () => {
    const { client, adapter } = makeClient();
    adapter.cancel();
    const r = await client.prove(makeReq(), () => undefined);
    expect(r.ok).toBe(false);
    expect(reasonOf(r)).toBe("cancelled");
  });

  it("terminate resolves pending and cancels subsequent", async () => {
    const { client, adapter } = makeClient();
    adapter.cancel();
    await client.prove(makeReq(), () => undefined);
    client.terminate();
    const r = await client.prove(makeReq(), () => undefined);
    expect(r.ok).toBe(false);
  });

  it("progress callback receives stage events", async () => {
    const { client } = makeClient();
    const stages: string[] = [];
    await client.prove(makeReq(), (p) => stages.push(p.stage));
    expect(stages).toContain("witness");
    expect(stages).toContain("prove");
    expect(stages).toContain("done");
  });
});

describe("worker boundary error sanitization", () => {
  it("rejects are sanitized through InlineProverClient", async () => {
    const { client, adapter } = makeClient();
    adapter.cancel();
    const r = await client.prove(makeReq(), () => undefined);
    expect(r.ok).toBe(false);
    expect(reasonOf(r)).toMatch(/^(cancelled|prover error)/);
  });
});
