import { describe, it, expect } from "vitest";
import { deduplicateEvents, reconstructTallies, auditR1, summariseAudit } from "../src/domain/audit.js";
import type { ZkQuorumEvent } from "@zk-quorum/protocol";
import { EVENT_NAME_VOTE_CAST, EVENT_NAME_VOTE_COMMITTED, EVENT_NAME_VOTE_REVEALED, ZKQ_EVENT_SCHEMA_V1 } from "@zk-quorum/protocol";

const ELECTION = ("0x" + "01".repeat(32)) as `0x${string}`;
// txHash format follows the bundle proof archive convention: raw 32-byte hex
// without the 0x prefix.
const txHash = (n: number): string => n.toString(16).padStart(64, "0");

function castEvent(opts: { txN: number; nullifierHash: string; vote: number; bucket: number }): ZkQuorumEvent & { txHash: string } {
  return {
    schema: ZKQ_EVENT_SCHEMA_V1,
    name: EVENT_NAME_VOTE_CAST,
    electionId: ELECTION,
    payload: {
      nullifierHash: opts.nullifierHash as `0x${string}`,
      vote: opts.vote,
      tallyBucket: opts.bucket,
      publicSchemaVersion: "PUBLIC_SCHEMA_V1_R0",
      proofHash: "0x" + "00".repeat(32) as `0x${string}`,
      publicSignalsHash: "0x" + "00".repeat(32) as `0x${string}`,
      stateRoot: "0x" + "01".repeat(32) as `0x${string}`,
      associationRoot: "0x" + "02".repeat(32) as `0x${string}`,
    },
    txHash: txHash(opts.txN),
  };
}

function commitEvent(opts: { txN: number; nullifierHash: string; ballotCommitment: string; bucket: number }): ZkQuorumEvent & { txHash: string } {
  return {
    schema: ZKQ_EVENT_SCHEMA_V1,
    name: EVENT_NAME_VOTE_COMMITTED,
    electionId: ELECTION,
    payload: {
      nullifierHash: opts.nullifierHash as `0x${string}`,
      ballotCommitment: opts.ballotCommitment as `0x${string}`,
      tallyBucket: opts.bucket,
      publicSchemaVersion: "PUBLIC_SCHEMA_V1_R1",
      proofHash: "0x" + "00".repeat(32) as `0x${string}`,
      publicSignalsHash: "0x" + "00".repeat(32) as `0x${string}`,
      stateRoot: "0x" + "01".repeat(32) as `0x${string}`,
      associationRoot: "0x" + "02".repeat(32) as `0x${string}`,
    },
    txHash: txHash(opts.txN),
  };
}

function revealEvent(opts: { txN: number; ballotCommitment: string; vote: number }): ZkQuorumEvent & { txHash: string } {
  return {
    schema: ZKQ_EVENT_SCHEMA_V1,
    name: EVENT_NAME_VOTE_REVEALED,
    electionId: ELECTION,
    payload: {
      electionId: ELECTION,
      ballotCommitment: opts.ballotCommitment as `0x${string}`,
      vote: opts.vote,
    },
    txHash: txHash(opts.txN),
  };
}

describe("deduplicateEvents", () => {
  it("accepts unique nullifiers", () => {
    const events = [
      castEvent({ txN: 1, nullifierHash: "0x" + "11".repeat(32), vote: 0, bucket: 1 }),
      castEvent({ txN: 2, nullifierHash: "0x" + "12".repeat(32), vote: 1, bucket: 2 }),
    ];
    const r = deduplicateEvents(events);
    expect(r.duplicateNullifiers).toHaveLength(0);
    expect(r.duplicateTxs).toHaveLength(0);
  });

  it("flags duplicate nullifiers", () => {
    const events = [
      castEvent({ txN: 1, nullifierHash: "0x" + "11".repeat(32), vote: 0, bucket: 1 }),
      castEvent({ txN: 2, nullifierHash: "0x" + "11".repeat(32), vote: 1, bucket: 1 }),
    ];
    const r = deduplicateEvents(events);
    expect(r.duplicateNullifiers).toHaveLength(1);
  });

  it("flags duplicate tx hashes", () => {
    const events = [
      castEvent({ txN: 1, nullifierHash: "0x" + "11".repeat(32), vote: 0, bucket: 1 }),
      castEvent({ txN: 1, nullifierHash: "0x" + "12".repeat(32), vote: 1, bucket: 2 }),
    ];
    const r = deduplicateEvents(events);
    expect(r.duplicateTxs.length).toBe(1);
  });
});

describe("reconstructTallies (audit H2)", () => {
  it("aggregates R0 votes by option", () => {
    const events = [
      castEvent({ txN: 1, nullifierHash: "0x" + "11".repeat(32), vote: 0, bucket: 1 }),
      castEvent({ txN: 2, nullifierHash: "0x" + "12".repeat(32), vote: 0, bucket: 1 }),
      castEvent({ txN: 3, nullifierHash: "0x" + "13".repeat(32), vote: 2, bucket: 2 }),
    ];
    const t = reconstructTallies(events, { r0Options: 3, r1Options: 3 });
    expect(t.r0.counts).toEqual([2n, 0n, 1n]);
    expect(t.r0.total).toBe(3n);
  });

  it("returns zero tallies for empty input", () => {
    const t = reconstructTallies([], { r0Options: 5, r1Options: 5 });
    expect(t.r0.total).toBe(0n);
    expect(t.r1.total).toBe(0n);
  });

  it("R1 reveal without commit is reported and ignored, NOT bucketed to 0", () => {
    const events = [
      revealEvent({ txN: 1, ballotCommitment: "0x" + "ff".repeat(32), vote: 1 }),
    ];
    const t = reconstructTallies(events, { r0Options: 3, r1Options: 3 });
    expect(t.r1.total).toBe(0n);
    expect(t.errors.some((e) => e.includes("without matching commit"))).toBe(true);
  });

  it("R1 reveal uses the commit event's tallyBucket, not a hash-derived fallback", () => {
    const bc = "0x" + "aa".repeat(32);
    const events = [
      commitEvent({ txN: 1, nullifierHash: "0x" + "11".repeat(32), ballotCommitment: bc, bucket: 7 }),
      revealEvent({ txN: 2, ballotCommitment: bc, vote: 1 }),
    ];
    const t = reconstructTallies(events, { r0Options: 2, r1Options: 8 });
    // bucket 7 receives 1 vote for option 1 → 1n
    expect(t.r1BucketsByCommitment.get(bc as `0x${string}`)).toBe(7);
    expect(t.r1.counts[1]).toBe(1n);
    // other buckets are zero
    expect(t.r1.counts[0]).toBe(0n);
  });
});

describe("auditR1", () => {
  it("counts commits, reveals, non-reveals", () => {
    const events = [
      commitEvent({ txN: 1, nullifierHash: "0x" + "11".repeat(32), ballotCommitment: "0x" + "aa".repeat(32), bucket: 1 }),
      commitEvent({ txN: 2, nullifierHash: "0x" + "12".repeat(32), ballotCommitment: "0x" + "bb".repeat(32), bucket: 2 }),
      revealEvent({ txN: 3, ballotCommitment: "0x" + "aa".repeat(32), vote: 1 }),
    ];
    const r = auditR1(events);
    expect(r.commitCount).toBe(2n);
    expect(r.revealCount).toBe(1n);
    expect(r.nonRevealCount).toBe(1n);
  });

  it("flags double reveal", () => {
    const events = [
      commitEvent({ txN: 1, nullifierHash: "0x" + "11".repeat(32), ballotCommitment: "0x" + "aa".repeat(32), bucket: 1 }),
      revealEvent({ txN: 2, ballotCommitment: "0x" + "aa".repeat(32), vote: 0 }),
      revealEvent({ txN: 3, ballotCommitment: "0x" + "aa".repeat(32), vote: 1 }),
    ];
    const r = auditR1(events);
    expect(r.doubleReveals).toEqual(["0x" + "aa".repeat(32)]);
  });

  it("flags reveal without commit", () => {
    const events = [
      revealEvent({ txN: 1, ballotCommitment: "0x" + "cc".repeat(32), vote: 2 }),
    ];
    const r = auditR1(events);
    expect(r.revealsWithoutCommit).toHaveLength(1);
    expect(r.revealsWithoutCommit[0]?.txHash).toBe(txHash(1));
  });
});

describe("summariseAudit (audit integrator)", () => {
  it("ok=false when verifier is not configured (verifierConfigured=false)", () => {
    const events = [
      castEvent({ txN: 1, nullifierHash: "0x" + "11".repeat(32), vote: 0, bucket: 1 }),
    ];
    const dedup = deduplicateEvents(events);
    const r1 = auditR1(events);
    const tallies = reconstructTallies(events, { r0Options: 3, r1Options: 3 });
    const summary = summariseAudit({
      electionId: ELECTION,
      dedup,
      r1,
      r0: { counts: tallies.r0.counts },
      r1Counts: tallies.r1.counts,
      verifierConfigured: false,
      r1RevealsMissingBucket: [],
    });
    expect(summary.ok).toBe(false);
    expect(summary.verifierConfigured).toBe(false);
  });

  it("ok=true on a clean bundle with verifier configured", () => {
    const events = [
      castEvent({ txN: 1, nullifierHash: "0x" + "11".repeat(32), vote: 0, bucket: 1 }),
    ];
    const dedup = deduplicateEvents(events);
    const r1 = auditR1(events);
    const tallies = reconstructTallies(events, { r0Options: 3, r1Options: 3 });
    const summary = summariseAudit({
      electionId: ELECTION,
      dedup,
      r1,
      r0: { counts: tallies.r0.counts },
      r1Counts: tallies.r1.counts,
      verifierConfigured: true,
      r1RevealsMissingBucket: [],
    });
    expect(summary.ok).toBe(true);
    expect(summary.duplicateNullifiers).toHaveLength(0);
  });

  it("ok=false on a duplicate", () => {
    const events = [
      castEvent({ txN: 1, nullifierHash: "0x" + "11".repeat(32), vote: 0, bucket: 1 }),
      castEvent({ txN: 2, nullifierHash: "0x" + "11".repeat(32), vote: 1, bucket: 1 }),
    ];
    const dedup = deduplicateEvents(events);
    const r1 = auditR1(events);
    const tallies = reconstructTallies(events, { r0Options: 3, r1Options: 3 });
    const summary = summariseAudit({
      electionId: ELECTION,
      dedup,
      r1,
      r0: { counts: tallies.r0.counts },
      r1Counts: tallies.r1.counts,
      verifierConfigured: true,
      r1RevealsMissingBucket: [],
    });
    expect(summary.ok).toBe(false);
    expect(summary.duplicateNullifiers).toHaveLength(1);
  });
});
