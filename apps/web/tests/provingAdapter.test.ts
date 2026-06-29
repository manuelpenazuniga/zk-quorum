import { describe, it, expect } from "vitest";
import { MockProvingAdapter, type ProvingRequest } from "../src/adapters/provingAdapter.js";

describe("mock proving adapter", () => {
  it("returns a synthetic envelope", async () => {
    const a = new MockProvingAdapter();
    const req: ProvingRequest = {
      kind: "prove-r0",
      electionId: ("0x" + "01".repeat(32)) as `0x${string}`,
      publicSchemaId: "PUBLIC_SCHEMA_V1_R0",
      publicSignals: ["1", "2", "3", "4", "5", "6"],
      inputs: {},
    };
    const r = await a.prove(req, () => undefined);
    expect(r.ok).toBe(true);
  });

  it("honours cancel", async () => {
    const a = new MockProvingAdapter();
    a.cancel();
    const req: ProvingRequest = {
      kind: "prove-r0",
      electionId: ("0x" + "01".repeat(32)) as `0x${string}`,
      publicSchemaId: "PUBLIC_SCHEMA_V1_R0",
      publicSignals: ["1", "2", "3", "4", "5", "6"],
      inputs: {},
    };
    const r = await a.prove(req, () => undefined);
    expect(r.ok).toBe(false);
  });
});
