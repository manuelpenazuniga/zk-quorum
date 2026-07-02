import { describe, it, expect } from "vitest";
import { RealR0ProvingAdapter, type AssetManifest } from "../src/adapters/realProvingAdapter.js";
import { MockProvingAdapter, type ProvingRequest } from "../src/adapters/provingAdapter.js";

function makeValidManifest(): AssetManifest {
  return {
    schema: "UPRE_BROWSER_MANIFEST_V1",
    gate: "U-PRE-BROWSER-R0",
    circuit: "PublicVoteR0",
    rung: 0,
    proof_system: "Groth16",
    curve: "bls12-381",
    r1cs_sha256: "0".repeat(64),
    assets: [
      { id: "main.wasm", kind: "wasm", sha256: "0".repeat(64), size: 100 },
      { id: "r0_final.zkey", kind: "zkey", sha256: "0".repeat(64), size: 100 },
      { id: "r0_vk.json", kind: "vk", sha256: "0".repeat(64), size: 100 },
    ],
  };
}

function makeValidReq(): ProvingRequest {
  return {
    kind: "prove-r0",
    electionId: ("0x" + "01".repeat(32)) as `0x${string}`,
    publicSchemaId: "PUBLIC_SCHEMA_V1_R0",
    publicSignals: ["1", "2", "3", "4", "5", "6"],
    inputs: {},
  };
}

/** Access reason from a ProvingResponse, which is a discriminated union */
function reasonOf(r: { ok: boolean; reason?: string }): string {
  return (r as { reason: string }).reason ?? "unknown";
}

describe("RealProvingAdapter error handling", () => {
  it("rejects prove-r1 requests", async () => {
    const adapter = new RealR0ProvingAdapter("wasm", "zkey", {}, null);
    const req: ProvingRequest = {
      kind: "prove-r1",
      electionId: ("0x" + "01".repeat(32)) as `0x${string}`,
      publicSchemaId: "PUBLIC_SCHEMA_V1_R1",
      publicSignals: ["1", "2", "3", "4", "5", "6"],
      inputs: {},
    };
    const r = await adapter.prove(req, () => undefined);
    expect(r.ok).toBe(false);
    expect(reasonOf(r)).toBe("invalid request: only prove-r0 supported");
  });

  it("rejects wrong schema", async () => {
    const adapter = new RealR0ProvingAdapter("wasm", "zkey", {}, null);
    const req: ProvingRequest = {
      kind: "prove-r0",
      electionId: ("0x" + "01".repeat(32)) as `0x${string}`,
      publicSchemaId: "PUBLIC_SCHEMA_V1_R1" as "PUBLIC_SCHEMA_V1_R0",
      publicSignals: ["1", "2", "3", "4", "5", "6"],
      inputs: {},
    };
    const r = await adapter.prove(req, () => undefined);
    expect(r.ok).toBe(false);
    expect(reasonOf(r)).toBe("invalid request: unsupported schema");
  });

  it("cancel returns early", async () => {
    const adapter = new RealR0ProvingAdapter("wasm", "zkey", {}, null);
    adapter.cancel();
    const r = await adapter.prove(makeValidReq(), () => undefined);
    expect(r.ok).toBe(false);
    expect(reasonOf(r)).toBe("cancelled");
  });
});

describe("RealProvingAdapter manifest validation", () => {
  it("accepts valid manifest", () => {
    const adapter = new RealR0ProvingAdapter("wasm", "zkey", {}, makeValidManifest());
    expect(adapter).toBeInstanceOf(RealR0ProvingAdapter);
  });

  it("rejects unknown manifest schema", async () => {
    const m = { schema: "UNKNOWN_V999" as const, gate: "U-PRE-BROWSER-R0", circuit: "PublicVoteR0", rung: 0 as const, proof_system: "Groth16" as const, curve: "bls12-381" as const, r1cs_sha256: "0", assets: [] as AssetManifest["assets"] };
    const adapter = new RealR0ProvingAdapter("wasm", "zkey", {}, m as unknown as AssetManifest);
    const r = await adapter.prove(makeValidReq(), () => undefined);
    expect(r.ok).toBe(false);
    expect(reasonOf(r)).toMatch(/manifest error/);
  });

  it("rejects unknown gate", async () => {
    const m = { ...makeValidManifest(), gate: "WRONG-GATE" };
    const adapter = new RealR0ProvingAdapter("wasm", "zkey", {}, m as AssetManifest);
    const r = await adapter.prove(makeValidReq(), () => undefined);
    expect(r.ok).toBe(false);
    expect(reasonOf(r)).toMatch(/manifest error/);
  });

  it("rejects wrong circuit", async () => {
    const m = { ...makeValidManifest(), circuit: "CommitVoteR1" };
    const adapter = new RealR0ProvingAdapter("wasm", "zkey", {}, m as AssetManifest);
    const r = await adapter.prove(makeValidReq(), () => undefined);
    expect(r.ok).toBe(false);
    expect(reasonOf(r)).toMatch(/manifest error/);
  });

  it("rejects wrong rung", async () => {
    const m = { ...makeValidManifest(), rung: 1 as const };
    const adapter = new RealR0ProvingAdapter("wasm", "zkey", {}, m as unknown as AssetManifest);
    const r = await adapter.prove(makeValidReq(), () => undefined);
    expect(r.ok).toBe(false);
    expect(reasonOf(r)).toMatch(/manifest error/);
  });

  it("rejects unknown curve", async () => {
    const m = { ...makeValidManifest(), curve: "bn254" };
    const adapter = new RealR0ProvingAdapter("wasm", "zkey", {}, m as AssetManifest);
    const r = await adapter.prove(makeValidReq(), () => undefined);
    expect(r.ok).toBe(false);
    expect(reasonOf(r)).toMatch(/manifest error/);
  });

  it("rejects missing assets", async () => {
    const m = { ...makeValidManifest(), assets: [] };
    const adapter = new RealR0ProvingAdapter("wasm", "zkey", {}, m);
    const r = await adapter.prove(makeValidReq(), () => undefined);
    expect(r.ok).toBe(false);
    expect(reasonOf(r)).toMatch(/manifest error/);
  });
});

describe("provingAdapter mock (regression)", () => {
  it("mock adapter still works", async () => {
    const adapter = new MockProvingAdapter();
    const r = await adapter.prove(makeValidReq(), () => undefined);
    expect(r.ok).toBe(true);
  });

  it("mock adapter cancel works", async () => {
    const adapter = new MockProvingAdapter();
    adapter.cancel();
    const r = await adapter.prove(makeValidReq(), () => undefined);
    expect(r.ok).toBe(false);
    expect(reasonOf(r)).toBe("cancelled");
  });
});
