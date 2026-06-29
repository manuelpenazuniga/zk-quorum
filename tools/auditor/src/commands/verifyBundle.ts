import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { ZkqProtocolError } from "@zk-quorum/protocol";
import { AUDIT_BUNDLE_SCHEMA, type AuditBundleV1, type ProofArchiveEntry } from "../domain/bundle.js";
import { parseBundleJson, validateBundle } from "../domain/loadBundle.js";
import { auditR1, deduplicateEvents, reconstructTallies, summariseAudit } from "../domain/audit.js";
import type { VerifierAdapter } from "../adapters/verifierAdapter.js";
import { NoopVerifierAdapter } from "../adapters/verifierAdapter.js";
import type { AuditSummary } from "../domain/bundle.js";

export interface VerifyBundleOptions {
  readonly verifier: VerifierAdapter;
  readonly r0Options: number;
  readonly r1Options: number;
  readonly proofArchive: ReadonlyArray<ProofArchiveEntry>;
}

export async function verifyBundle(bundle: AuditBundleV1, options: VerifyBundleOptions): Promise<AuditSummary> {
  const dedup = deduplicateEvents(bundle.events as Array<typeof bundle.events[number] & { txHash?: string }>);
  const r1 = auditR1(bundle.events as Array<typeof bundle.events[number] & { txHash?: string }>);
  const tallies = reconstructTallies(bundle.events, { r0Options: options.r0Options, r1Options: options.r1Options });
  const base = summariseAudit({
    electionId: bundle.electionId,
    dedup,
    r1,
    r0: { counts: tallies.r0.counts },
    r1Counts: tallies.r1.counts,
  });
  const mismatched = [...base.mismatchedHashes];
  const errors = [...base.errors];

  if (options.verifier.id !== "noop") {
    for (const entry of options.proofArchive) {
      const env = tryParseProofArchiveEntry(entry);
      if (env === null) {
        mismatched.push({ txHash: entry.txHash, reason: "proof archive entry not parseable" });
        continue;
      }
      const v = await options.verifier.verify(env);
      if (!v.ok) {
        mismatched.push({ txHash: entry.txHash, reason: v.reason ?? "verifier rejected" });
      } else if (v.proofHash !== entry.proofHash || v.publicSignalsHash !== entry.publicSignalsHash) {
        mismatched.push({ txHash: entry.txHash, reason: "verifier hash mismatch" });
      }
    }
  }

  return {
    ...base,
    mismatchedHashes: mismatched,
    errors,
    ok: base.ok && mismatched.length === 0,
  };
}

function tryParseProofArchiveEntry(entry: ProofArchiveEntry): { electionId: `0x${string}`; publicSchemaId: string; publicSignals: string[]; proofBytes: `0x${string}` } | null {
  try {
    const bytes = Buffer.from(entry.payloadHex.startsWith("0x") ? entry.payloadHex.slice(2) : entry.payloadHex, "hex");
    const parsed = JSON.parse(bytes.toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as never;
  } catch {
    return null;
  }
}

export interface ReplayOptions {
  readonly verifier: VerifierAdapter;
  readonly r0Options: number;
  readonly r1Options: number;
  readonly expectedTally: ReadonlyArray<bigint> | null;
  readonly exitOnFailure: boolean;
}

export async function replayBundle(bundle: AuditBundleV1, options: ReplayOptions): Promise<{ summary: AuditSummary; ok: boolean }> {
  const summary = await verifyBundle(bundle, {
    verifier: options.verifier,
    r0Options: options.r0Options,
    r1Options: options.r1Options,
    proofArchive: bundle.proofArchive,
  });
  const errors = [...summary.errors];
  if (options.expectedTally !== null) {
    const reconstructed = reconstructTallies(bundle.events, { r0Options: options.r0Options, r1Options: options.r1Options });
    for (let i = 0; i < options.expectedTally.length; i += 1) {
      const got = reconstructed.r0.counts[i] ?? 0n;
      if (got !== options.expectedTally[i]) {
        errors.push(`tally mismatch at option ${i}: got ${got}, expected ${options.expectedTally[i]}`);
      }
    }
  }
  const ok = summary.ok && errors.length === 0;
  if (!ok && options.exitOnFailure) {
    process.exitCode = 1;
  }
  return { summary: { ...summary, errors }, ok };
}

export async function loadAndReplay(path: string, options: ReplayOptions): Promise<{ summary: AuditSummary; ok: boolean }> {
  const bundle = parseBundleJson(await import("node:fs/promises").then((m) => m.readFile(path, "utf8")));
  return replayBundle(bundle, options);
}

export interface BuildBundleArgs {
  readonly electionId: `0x${string}`;
  readonly manifestHash: `0x${string}`;
  readonly contractId: string;
  readonly wasmHash: `0x${string}`;
  readonly vkR0Hash: `0x${string}`;
  readonly vkR1Hash: `0x${string}`;
  readonly networkPassphrase: string;
  readonly events: ReadonlyArray<unknown>;
  readonly proofArchive: ReadonlyArray<ProofArchiveEntry>;
}

export function buildBundle(args: BuildBundleArgs): AuditBundleV1 {
  return validateBundle({
    schema: AUDIT_BUNDLE_SCHEMA,
    electionId: args.electionId,
    manifestHash: args.manifestHash,
    contractId: args.contractId,
    wasmHash: args.wasmHash,
    vkR0Hash: args.vkR0Hash,
    vkR1Hash: args.vkR1Hash,
    networkPassphrase: args.networkPassphrase,
    events: args.events,
    proofArchive: args.proofArchive,
    tallies: { R0: {}, R1: {} },
  });
}

export function canonicalJson(input: unknown): string {
  return JSON.stringify(input, (_k, v) => {
    if (typeof v === "bigint") return `__bigint__:${v.toString()}`;
    return v;
  });
}

export function hashBundle(bundle: AuditBundleV1): string {
  const h = createHash("sha256");
  h.update(canonicalJson(bundle));
  return "0x" + h.digest("hex");
}

export async function writeBundleToFile(bundle: AuditBundleV1, path: string): Promise<string> {
  const json = canonicalJson(bundle);
  await writeFile(path, json, "utf8");
  const digest = createHash("sha256").update(json).digest("hex");
  return "0x" + digest;
}

void NoopVerifierAdapter;
void ZkqProtocolError;
