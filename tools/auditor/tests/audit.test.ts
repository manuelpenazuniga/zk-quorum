import { describe, it, expect } from "vitest";
import { deduplicateEvents, reconstructTallies, auditR1, summariseAudit } from "../src/domain/audit.js";
import type { ZkQuorumEvent } from "@zk-quorum/protocol";
import { EVENT_NAME_VOTE_CAST, EVENT_NAME_VOTE_COMMITTED, EVENT_NAME_VOTE_REVEALED, ZKQ_EVENT_SCHEMA_V1 } from "@zk-quorum/protocol";

const ELECTION = ("0x" + "01".repeat(32)) as `0x${string}`;

function castEvent(opts: { txHash: string; nullifierHash: string; vote: number; bucket: number }): ZkQuorumEvent & { txHash: string } {
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
    txHash: opts.txHash,
  };
}

function commitEvent(opts: { txHash: string; nullifierHash: string; ballotCommitment: string; bucket: number }): ZkQuorumEvent & { txHash: string } {
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
    txHash: opts.txHash,
  };
}

function revealEvent(opts: { txHash: string; ballotCommitment: string; vote: number }): ZkQuorumEvent & { txHash: string } {
  return {
    schema: ZKQ_EVENT_SCHEMA_V1,
    name: EVENT_NAME_VOTE_REVEALED,
    electionId: ELECTION,
    payload: {
      electionId: ELECTION,
      ballotCommitment: opts.ballotCommitment as `0x${string}`,
      vote: opts.vote,
    },
    txHash: opts.txHash,
  };
}

describe("deduplicateEvents", () => {
  it("accepts unique nullifiers", () => {
    const events = [
      castEvent({ txHash: "tx-1", nullifierHash: "0x" + "11".repeat(32), vote: 0, bucket: 1 }),
      castEvent({ txHash: "tx-2", nullifierHash: "0x" + "12".repeat(32), vote: 1, bucket: 2 }),
    ];
    const r = deduplicateEvents(events);
    expect(r.duplicateNullifiers).toHaveLength(0);
    expect(r.duplicateTxs).toHaveLength(0);
  });

  it("flags duplicate nullifiers", () => {
    const events = [
      castEvent({ txHash: "tx-1", nullifierHash: "0x" + "11".repeat(32), vote: 0, bucket: 1 }),
      castEvent({ txHash: "tx-2", nullifierHash: "0x" + "11".repeat(32), vote: 1, bucket: 1 }),
    ];
    const r = deduplicateEvents(events);
    expect(r.duplicateNullifiers).toHaveLength(1);
  });

  it("flags duplicate tx hashes", () => {
    const events = [
      castEvent({ txHash: "tx-1", nullifierHash: "0x" + "11".repeat(32), vote: 0, bucket: 1 }),
      castEvent({ txHash: "tx-1", nullifierHash: "0x" + "12".repeat(32), vote: 1, bucket: 2 }),
    ];
    const r = deduplicateEvents(events);
    expect(r.duplicateTxs).toEqual(["tx-1"]);
  });
});

describe("reconstructTallies", () => {
  it("aggregates R0 votes by option", () => {
    const events = [
      castEvent({ txHash: "tx-1", nullifierHash: "0x" + "11".repeat(32), vote: 0, bucket: 1 }),
      castEvent({ txHash: "tx-2", nullifierHash: "0x" + "12".repeat(32), vote: 0, bucket: 1 }),
      castEvent({ txHash: "tx-3", nullifierHash: "0x" + "13".repeat(32), vote: 2, bucket: 2 }),
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
});

describe("auditR1", () => {
  it("counts commits, reveals, non-reveals", () => {
    const events = [
      commitEvent({ txHash: "tx-1", nullifierHash: "0x" + "11".repeat(32), ballotCommitment: "0x" + "aa".repeat(32), bucket: 1 }),
      commitEvent({ txHash: "tx-2", nullifierHash: "0x" + "12".repeat(32), ballotCommitment: "0x" + "bb".repeat(32), bucket: 2 }),
      revealEvent({ txHash: "tx-3", ballotCommitment: "0x" + "aa".repeat(32), vote: 1 }),
    ];
    const r = auditR1(events);
    expect(r.commitCount).toBe(2n);
    expect(r.revealCount).toBe(1n);
    expect(r.nonRevealCount).toBe(1n);
  });

  it("flags double reveal", () => {
    const events = [
      commitEvent({ txHash: "tx-1", nullifierHash: "0x" + "11".repeat(32), ballotCommitment: "0x" + "aa".repeat(32), bucket: 1 }),
      revealEvent({ txHash: "tx-2", ballotCommitment: "0x" + "aa".repeat(32), vote: 0 }),
      revealEvent({ txHash: "tx-3", ballotCommitment: "0x" + "aa".repeat(32), vote: 1 }),
    ];
    const r = auditR1(events);
    expect(r.doubleReveals).toEqual(["0x" + "aa".repeat(32)]);
  });

  it("flags reveal without commit", () => {
    const events = [
      revealEvent({ txHash: "tx-1", ballotCommitment: "0x" + "cc".repeat(32), vote: 2 }),
    ];
    const r = auditR1(events);
    expect(r.revealsWithoutCommit).toHaveLength(1);
    expect(r.revealsWithoutCommit[0]?.txHash).toBe("tx-1");
  });
});

describe("summariseAudit", () => {
  it("ok=true on a clean bundle", () => {
    const events = [
      castEvent({ txHash: "tx-1", nullifierHash: "0x" + "11".repeat(32), vote: 0, bucket: 1 }),
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
    });
    expect(summary.ok).toBe(true);
    expect(summary.duplicateNullifiers).toHaveLength(0);
  });

  it("ok=false on a duplicate", () => {
    const events = [
      castEvent({ txHash: "tx-1", nullifierHash: "0x" + "11".repeat(32), vote: 0, bucket: 1 }),
      castEvent({ txHash: "tx-2", nullifierHash: "0x" + "11".repeat(32), vote: 1, bucket: 1 }),
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
    });
    expect(summary.ok).toBe(false);
    expect(summary.duplicateNullifiers).toHaveLength(1);
  });
});
