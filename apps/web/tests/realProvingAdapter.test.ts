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

/** Access reason from ProvingResponse discriminated union */
function reasonOf(r: { ok: boolean; reason?: string }): string {
  return (r as { reason: string }).reason ?? "unknown";
}

describe("RealProvingAdapter error handling", () => {
  it("rejects prove-r1 requests", async () => {
    const adapter = new RealR0ProvingAdapter("wasm", "zkey", {}, makeValidManifest());
    const req: ProvingRequest = {
      kind: "prove-r1",
      electionId: ("0x" + "01".repeat(32)) as `0x${string}`,
      publicSchemaId: "PUBLIC_SCHEMA_V1_R1",
      publicSignals: ["1", "2", "3", "4", "5", "6"],
      inputs: {},
    };
    const r = await adapter.prove(req, () => undefined);
    expect(r.ok).toBe(false);
    expect(reasonOf(r)).toBe("invalid request: kind must be prove-r0");
  });

  it("rejects wrong schema", async () => {
    const adapter = new RealR0ProvingAdapter("wasm", "zkey", {}, makeValidManifest());
    const req: ProvingRequest = {
      kind: "prove-r0",
      electionId: ("0x" + "01".repeat(32)) as `0x${string}`,
      publicSchemaId: "PUBLIC_SCHEMA_V1_R1" as "PUBLIC_SCHEMA_V1_R0",
      publicSignals: ["1", "2", "3", "4", "5", "6"],
      inputs: {},
    };
    const r = await adapter.prove(req, () => undefined);
    expect(r.ok).toBe(false);
    expect(reasonOf(r)).toBe("invalid request: publicSchemaId must be PUBLIC_SCHEMA_V1_R0");
  });

  it("rejects unknown request keys", async () => {
    const adapter = new RealR0ProvingAdapter("wasm", "zkey", {}, makeValidManifest());
    const req = { ...makeValidReq(), extraKey: true } as unknown as ProvingRequest;
    const r = await adapter.prove(req, () => undefined);
    expect(r.ok).toBe(false);
    expect(reasonOf(r)).toMatch(/invalid request: unknown key/);
  });

  it("rejects non-canonical publicSignals", async () => {
    const adapter = new RealR0ProvingAdapter("wasm", "zkey", {}, makeValidManifest());
    const req = { ...makeValidReq(), publicSignals: ["0x1", "2", "3", "4", "5", "6"] };
    const r = await adapter.prove(req, () => undefined);
    expect(r.ok).toBe(false);
    expect(reasonOf(r)).toMatch(/invalid request: publicSignals\[0\]/);
  });

  it("cancel returns early", async () => {
    const adapter = new RealR0ProvingAdapter("wasm", "zkey", {}, makeValidManifest());
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

  it("rejects unknown manifest schema", () => {
    const m = { ...makeValidManifest(), schema: "UNKNOWN" as const };
    expect(() => new RealR0ProvingAdapter("w", "z", {}, m as unknown as AssetManifest)).toThrow(/manifest error/);
  });

  it("rejects wrong gate", () => {
    const m = { ...makeValidManifest(), gate: "WRONG" as const };
    expect(() => new RealR0ProvingAdapter("w", "z", {}, m as unknown as AssetManifest)).toThrow(/manifest error/);
  });

  it("rejects wrong circuit", () => {
    const m = { ...makeValidManifest(), circuit: "Wrong" as const };
    expect(() => new RealR0ProvingAdapter("w", "z", {}, m as unknown as AssetManifest)).toThrow(/manifest error/);
  });

  it("rejects wrong rung", () => {
    const m = { ...makeValidManifest(), rung: 1 as const };
    expect(() => new RealR0ProvingAdapter("w", "z", {}, m as unknown as AssetManifest)).toThrow(/manifest error/);
  });

  it("rejects wrong curve", () => {
    const m = { ...makeValidManifest(), curve: "bn254" as const };
    expect(() => new RealR0ProvingAdapter("w", "z", {}, m as unknown as AssetManifest)).toThrow(/manifest error/);
  });

  it("rejects missing asset kinds", () => {
    const m = { ...makeValidManifest(), assets: [{ id: "x", kind: "zkey" as const, sha256: "0".repeat(64), size: 1 }] };
    expect(() => new RealR0ProvingAdapter("w", "z", {}, m as unknown as AssetManifest)).toThrow(/manifest error/);
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
