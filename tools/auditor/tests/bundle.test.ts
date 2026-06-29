import { describe, it, expect } from "vitest";
import { buildBundle, hashBundle, verifyBundle, writeBundleToFile, loadAndReplay, parseBundleJson } from "../src/index_lib.js";
import { NoopVerifierAdapter, StaticAcceptVerifierAdapter } from "../src/adapters/verifierAdapter.js";
import { ZkqProtocolError } from "@zk-quorum/protocol";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ELECTION = "0x" + "01".repeat(32);

function buildSampleBundle() {
  return buildBundle({
    electionId: ELECTION as `0x${string}`,
    manifestHash: "0x" + "11".repeat(32) as `0x${string}`,
    contractId: "C" + "C".repeat(55),
    wasmHash: "0x" + "22".repeat(32) as `0x${string}`,
    vkR0Hash: "0x" + "33".repeat(32) as `0x${string}`,
    vkR1Hash: "0x" + "44".repeat(32) as `0x${string}`,
    networkPassphrase: "Test SDF Network ; September 2015",
    events: [
      {
        schema: "v1",
        name: "VoteCastV1",
        electionId: ELECTION as `0x${string}`,
        payload: {
          nullifierHash: "0x" + "55".repeat(32) as `0x${string}`,
          vote: 0,
          tallyBucket: 5,
          publicSchemaVersion: "PUBLIC_SCHEMA_V1_R0",
          proofHash: "0x" + "66".repeat(32) as `0x${string}`,
          publicSignalsHash: "0x" + "77".repeat(32) as `0x${string}`,
          stateRoot: "0x" + "88".repeat(32) as `0x${string}`,
          associationRoot: "0x" + "99".repeat(32) as `0x${string}`,
        },
        txHash: "tx-1",
      },
    ],
    proofArchive: [
      {
        txHash: "tx-1",
        proofHash: "0x" + "66".repeat(32) as `0x${string}`,
        publicSignalsHash: "0x" + "77".repeat(32) as `0x${string}`,
        payloadHex: "0x7b7d",
      },
    ],
  });
}

describe("buildBundle", () => {
  it("builds a valid bundle", () => {
    const b = buildSampleBundle();
    expect(b.schema).toBe("AUDIT_BUNDLE_V1");
    expect(b.electionId).toBe(ELECTION);
  });
});

describe("hashBundle", () => {
  it("is deterministic for the same bundle", () => {
    const a = hashBundle(buildSampleBundle());
    const b = hashBundle(buildSampleBundle());
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("verifyBundle", () => {
  it("verifier=noop returns summary with no verifier errors", async () => {
    const b = buildSampleBundle();
    const summary = await verifyBundle(b, {
      verifier: new NoopVerifierAdapter(),
      r0Options: 3,
      r1Options: 3,
      proofArchive: b.proofArchive,
    });
    expect(summary.ok).toBe(true);
    expect(summary.duplicateNullifiers).toHaveLength(0);
  });

  it("verifier=static-accept passes proof archive", async () => {
    const b = buildSampleBundle();
    const summary = await verifyBundle(b, {
      verifier: new StaticAcceptVerifierAdapter({
        proofHash: "0x" + "66".repeat(32) as `0x${string}`,
        publicSignalsHash: "0x" + "77".repeat(32) as `0x${string}`,
      }),
      r0Options: 3,
      r1Options: 3,
      proofArchive: b.proofArchive,
    });
    expect(summary.mismatchedHashes).toHaveLength(0);
  });

  it("verifier=static-accept with wrong hash flags mismatch", async () => {
    const b = buildSampleBundle();
    const summary = await verifyBundle(b, {
      verifier: new StaticAcceptVerifierAdapter({
        proofHash: "0x" + "ab".repeat(32) as `0x${string}`,
        publicSignalsHash: "0x" + "cd".repeat(32) as `0x${string}`,
      }),
      r0Options: 3,
      r1Options: 3,
      proofArchive: b.proofArchive,
    });
    expect(summary.mismatchedHashes).toHaveLength(1);
  });
});

describe("parseBundleJson", () => {
  it("rejects invalid schema", () => {
    expect(() => parseBundleJson(JSON.stringify({ schema: "OTHER" }))).toThrow(ZkqProtocolError);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseBundleJson("not json")).toThrow(ZkqProtocolError);
  });

  it("rejects non-object", () => {
    expect(() => parseBundleJson("null")).toThrow(ZkqProtocolError);
    expect(() => parseBundleJson("[]")).toThrow(ZkqProtocolError);
  });
});

describe("writeBundleToFile + loadAndReplay", () => {
  it("round-trips a bundle through the filesystem", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zkq-auditor-"));
    const path = join(dir, "bundle.json");
    const b = buildSampleBundle();
    const digest = await writeBundleToFile(b, path);
    expect(digest).toMatch(/^0x[0-9a-f]{64}$/);

    const { summary } = await loadAndReplay(path, {
      verifier: new NoopVerifierAdapter(),
      r0Options: 3,
      r1Options: 3,
      expectedTally: null,
      exitOnFailure: false,
    });
    expect(summary.electionId).toBe(ELECTION);
    rmSync(dir, { recursive: true, force: true });
  });
});
