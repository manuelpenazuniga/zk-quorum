import { describe, it, expect } from "vitest";
import { buildBundle, hashBundle, verifyBundle, writeBundleToFile, loadAndReplay, parseBundleJson, validateBundle, MAX_AUDIT_EVENTS, MAX_AUDIT_PROOF_ENTRIES, MAX_AUDIT_PROOF_PAYLOAD_BYTES } from "../src/index_lib.js";
import { NoopVerifierAdapter } from "../src/adapters/verifierAdapter.js";
import { StaticAcceptVerifierAdapter } from "./helpers/staticAcceptVerifier.js";
import { ZkqProtocolError } from "@zk-quorum/protocol";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ELECTION = "0x" + "01".repeat(32);
// Stellar tx hashes are 32 raw bytes; we store them without the 0x prefix
// in proof archive (Stellar RPC convention).
const txHash = (n: number): string => n.toString(16).padStart(64, "0");

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
        txHash: txHash(1),
      },
    ],
    proofArchive: [
      {
        txHash: txHash(1),
        proofHash: "0x" + "66".repeat(32) as `0x${string}`,
        publicSignalsHash: "0x" + "77".repeat(32) as `0x${string}`,
        // Frozen U0 wire format: publicSignals are canonical decimal Fr
        // strings (no 0x prefix, no leading zeros, in [0, r)). Small
        // literal values like 10/11/12/13/14/15 are all valid Fr.
        payloadHex: "0x" + Buffer.from(JSON.stringify({
          electionId: ELECTION,
          publicSchemaId: "PUBLIC_SCHEMA_V1_R0",
          publicSignals: ["10", "0", "5", "11", "12", "13"],
          proofBytes: "0x" + "66".repeat(32),
        })).toString("hex"),
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

  it("tallies are JSON-serializable objects, not ReadonlyMap (audit integrator)", () => {
    const b = buildSampleBundle();
    expect(b.tallies.R0).toBeDefined();
    expect(b.tallies.R1).toBeDefined();
    // JSON round-trip succeeds without losing data
    const round = JSON.parse(JSON.stringify(b));
    expect(round.tallies.R0).toBeDefined();
    expect(round.tallies.R1).toBeDefined();
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

describe("verifyBundle (audit integrator)", () => {
  it("verifier=noop returns ok=false and explicit mismatch marker (never silently ok)", async () => {
    const b = buildSampleBundle();
    const summary = await verifyBundle(b, {
      verifier: new NoopVerifierAdapter(),
      r0Options: 3,
      r1Options: 3,
      proofArchive: b.proofArchive,
    });
    expect(summary.ok).toBe(false);
    expect(summary.verifierConfigured).toBe(false);
    expect(summary.mismatchedHashes.length).toBeGreaterThan(0);
    expect(summary.mismatchedHashes[0]?.reason).toMatch(/verifier/i);
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
    expect(summary.ok).toBe(true);
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

  it("verifier=static-accept but archive is empty: still ok=true (no proofs to verify)", async () => {
    const summary = await verifyBundle({
      ...buildSampleBundle(),
      proofArchive: [],
    }, {
      verifier: new StaticAcceptVerifierAdapter({
        proofHash: "0x" + "66".repeat(32) as `0x${string}`,
        publicSignalsHash: "0x" + "77".repeat(32) as `0x${string}`,
      }),
      r0Options: 3,
      r1Options: 3,
      proofArchive: [],
    });
    expect(summary.mismatchedHashes).toHaveLength(0);
    expect(summary.ok).toBe(true);
  });
});

describe("parseBundleJson / validateBundle", () => {
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

  it("rejects bad contractId format", () => {
    const b = buildSampleBundle() as unknown as Record<string, unknown>;
    b.contractId = "notacontractid";
    expect(() => validateBundle(b)).toThrow(ZkqProtocolError);
  });

  it("rejects oversized events array", () => {
    const events = Array.from({ length: MAX_AUDIT_EVENTS + 1 }, () => ({
      schema: "v1",
      name: "VoteCastV1",
      electionId: ELECTION,
      payload: { nullifierHash: "0x" + "55".repeat(32), vote: 0, tallyBucket: 0 },
    }));
    const b = buildSampleBundle() as unknown as Record<string, unknown>;
    b.events = events;
    expect(() => validateBundle(b)).toThrow(/PAYLOAD_TOO_LARGE/);
  });

  it("rejects oversized proof archive", () => {
    const archive = Array.from({ length: MAX_AUDIT_PROOF_ENTRIES + 1 }, (_, i) => ({
      txHash: txHash(i),
      proofHash: "0x" + "66".repeat(32),
      publicSignalsHash: "0x" + "77".repeat(32),
      payloadHex: "0xab",
    }));
    const b = buildSampleBundle() as unknown as Record<string, unknown>;
    b.proofArchive = archive;
    expect(() => validateBundle(b)).toThrow(/PAYLOAD_TOO_LARGE/);
  });

  it("rejects oversized proof payload", () => {
    const b = buildSampleBundle() as unknown as Record<string, unknown>;
    (b.proofArchive as Array<Record<string, unknown>>)[0]!.payloadHex = "0x" + "ab".repeat(MAX_AUDIT_PROOF_PAYLOAD_BYTES + 1);
    expect(() => validateBundle(b)).toThrow(/PAYLOAD_TOO_LARGE/);
  });

  it("rejects event with mismatched electionId", () => {
    const b = buildSampleBundle() as unknown as Record<string, unknown>;
    (b.events as Array<Record<string, unknown>>)[0]!.electionId = "0x" + "ee".repeat(32);
    expect(() => validateBundle(b)).toThrow(/ELECTION_ID_MISMATCH/);
  });

  it("rejects malformed proof archive txHash", () => {
    const b = buildSampleBundle() as unknown as Record<string, unknown>;
    (b.proofArchive as Array<Record<string, unknown>>)[0]!.txHash = "tx-1";
    expect(() => validateBundle(b)).toThrow(/ARCHIVE_MALFORMED/);
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
      verifier: new StaticAcceptVerifierAdapter({
        proofHash: "0x" + "66".repeat(32) as `0x${string}`,
        publicSignalsHash: "0x" + "77".repeat(32) as `0x${string}`,
      }),
      r0Options: 3,
      r1Options: 3,
      expectedTally: null,
      exitOnFailure: false,
    });
    expect(summary.electionId).toBe(ELECTION);
    rmSync(dir, { recursive: true, force: true });
  });
});
