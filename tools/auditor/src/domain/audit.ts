import type { NullifierHash, BallotCommitment, ElectionId, VoteCastV1, VoteCommittedV1, VoteRevealedV1 } from "@zk-quorum/protocol";
import { type AuditSummary, type AuditBundleV1Tally } from "./bundle.js";
import { bucketForNullifier, createTallyState, incrementTally, tallyAll, type TallyState } from "@zk-quorum/protocol";

export interface DeduplicationResult {
  readonly nullifiers: ReadonlyMap<ElectionId, ReadonlySet<NullifierHash>>;
  readonly duplicateNullifiers: ReadonlyArray<{ readonly electionId: ElectionId; readonly nullifierHash: NullifierHash }>;
  readonly duplicateTxs: ReadonlyArray<string>;
  readonly mismatchedHashes: ReadonlyArray<{ readonly txHash: string; readonly reason: string }>;
}

export type WithTx =
  | (VoteCastV1 & { readonly txHash?: string })
  | (VoteCommittedV1 & { readonly txHash?: string })
  | (VoteRevealedV1 & { readonly txHash?: string });

function isCast(ev: WithTx): ev is VoteCastV1 & { readonly txHash?: string } {
  return ev.name === "VoteCastV1";
}

function isCommit(ev: WithTx): ev is VoteCommittedV1 & { readonly txHash?: string } {
  return ev.name === "VoteCommittedV1";
}

function isReveal(ev: WithTx): ev is VoteRevealedV1 & { readonly txHash?: string } {
  return ev.name === "VoteRevealedV1";
}

function getTxHash(ev: { readonly txHash?: string }): string | undefined {
  return ev.txHash;
}

export function deduplicateEvents(events: ReadonlyArray<WithTx>): DeduplicationResult {
  const perElection = new Map<ElectionId, Set<NullifierHash>>();
  const seenTx = new Set<string>();
  const duplicateNullifiers: Array<{ electionId: ElectionId; nullifierHash: NullifierHash }> = [];
  const duplicateTxs: string[] = [];
  const mismatched: Array<{ txHash: string; reason: string }> = [];

  for (const ev of events) {
    const txHash = getTxHash(ev);
    if (txHash !== undefined) {
      if (seenTx.has(txHash)) {
        duplicateTxs.push(txHash);
        continue;
      }
      seenTx.add(txHash);
    }
    if (isCast(ev) || isCommit(ev)) {
      const nh: NullifierHash = ev.payload.nullifierHash;
      const electionId = ev.electionId;
      const set = perElection.get(electionId) ?? new Set<NullifierHash>();
      if (set.has(nh)) {
        duplicateNullifiers.push({ electionId, nullifierHash: nh });
        mismatched.push({ txHash: txHash ?? "<no-tx>", reason: "duplicate nullifier" });
      } else {
        set.add(nh);
      }
      perElection.set(electionId, set);
    }
  }
  return { nullifiers: perElection, duplicateNullifiers, duplicateTxs, mismatchedHashes: mismatched };
}

export interface TallyReconstruction {
  readonly r0: { readonly counts: bigint[]; readonly total: bigint };
  readonly r1: { readonly counts: bigint[]; readonly total: bigint };
  readonly errors: string[];
  /** Audit H2: explicit R1 bucket-by-ballotCommitment map from the commit events. */
  readonly r1BucketsByCommitment: ReadonlyMap<BallotCommitment, number>;
}

function totalOf(counts: bigint[]): bigint {
  let t = 0n;
  for (const c of counts) t += c;
  return t;
}

export function reconstructTallies(
  events: ReadonlyArray<WithTx>,
  options: { readonly r0Options: number; readonly r1Options: number },
): TallyReconstruction {
  let r0: TallyState = createTallyState(options.r0Options);
  let r1: TallyState = createTallyState(options.r1Options);
  const errors: string[] = [];
  const r1BucketsByCommitment = new Map<BallotCommitment, number>();

  for (const ev of events) {
    if (isCast(ev)) {
      const pl = ev.payload;
      const bucket = bucketForNullifier(pl.nullifierHash);
      try {
        r0 = incrementTally(r0, bucket, pl.vote);
      } catch (e) {
        errors.push(`r0 increment failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (isCommit(ev)) {
      // Audit H2: capture the bucket the contract committed to so the reveal
      // can be tallied into the SAME bucket. The fallback hash-derived bucket
      // is intentionally NOT computed here.
      r1BucketsByCommitment.set(ev.payload.ballotCommitment, ev.payload.tallyBucket);
    }
  }

  for (const ev of events) {
    if (isReveal(ev)) {
      const pl = ev.payload;
      const bc = pl.ballotCommitment;
      // Audit H2: a reveal must reference a commit event we have already seen.
      // If it does not, we DO NOT fall back to bucket 0; we report the error.
      const bucket = r1BucketsByCommitment.get(bc);
      if (bucket === undefined) {
        errors.push(`r1 reveal without matching commit: ballotCommitment=${bc}`);
        continue;
      }
      try {
        r1 = incrementTally(r1, bucket, pl.vote);
      } catch (e) {
        errors.push(`r1 increment failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  const r0Counts = tallyAll(r0);
  const r1Counts = tallyAll(r1);
  return {
    r0: { counts: r0Counts, total: totalOf(r0Counts) },
    r1: { counts: r1Counts, total: totalOf(r1Counts) },
    errors,
    r1BucketsByCommitment,
  };
}

export interface R1AuditResult {
  readonly commitCount: bigint;
  readonly revealCount: bigint;
  readonly nonRevealCount: bigint;
  readonly doubleReveals: ReadonlyArray<BallotCommitment>;
  readonly revealsWithoutCommit: ReadonlyArray<{ ballotCommitment: BallotCommitment; txHash: string }>;
}

export function auditR1(events: ReadonlyArray<WithTx>): R1AuditResult {
  const commitments = new Set<BallotCommitment>();
  const revealed = new Set<BallotCommitment>();
  const doubleReveals: BallotCommitment[] = [];
  const revealsWithoutCommit: Array<{ ballotCommitment: BallotCommitment; txHash: string }> = [];

  for (const ev of events) {
    if (isCommit(ev)) {
      const pl = ev.payload;
      commitments.add(pl.ballotCommitment);
    }
    if (isReveal(ev)) {
      const pl = ev.payload;
      const bc = pl.ballotCommitment;
      if (revealed.has(bc)) {
        doubleReveals.push(bc);
      } else {
        revealed.add(bc);
      }
      if (!commitments.has(bc)) {
        revealsWithoutCommit.push({ ballotCommitment: bc, txHash: getTxHash(ev) ?? "<no-tx>" });
      }
    }
  }

  const nonReveals = BigInt(Array.from(commitments).filter((bc) => !revealed.has(bc)).length);
  return {
    commitCount: BigInt(commitments.size),
    revealCount: BigInt(revealed.size),
    nonRevealCount: nonReveals,
    doubleReveals,
    revealsWithoutCommit,
  };
}

export function summariseAudit(args: {
  readonly electionId: ElectionId;
  readonly dedup: DeduplicationResult;
  readonly r1: R1AuditResult;
  readonly r0: { readonly counts: bigint[] };
  readonly r1Counts: bigint[];
  readonly verifierConfigured: boolean;
  readonly r1RevealsMissingBucket: ReadonlyArray<{ ballotCommitment: BallotCommitment; txHash: string }>;
}): AuditSummary {
  // Audit integrator: when the verifier is the no-op placeholder, the bundle
  // is by definition NOT proven. ok must be false and the explicit code must
  // be reported. Never silently skip the proofs.
  const ok =
    args.verifierConfigured &&
    args.dedup.duplicateNullifiers.length === 0 &&
    args.dedup.duplicateTxs.length === 0 &&
    args.dedup.mismatchedHashes.length === 0 &&
    args.r1.doubleReveals.length === 0 &&
    args.r1.revealsWithoutCommit.length === 0 &&
    args.r1RevealsMissingBucket.length === 0;
  return {
    electionId: args.electionId,
    totals: {
      r0: { commits: totalOf(args.r0.counts), tally: totalOf(args.r0.counts) },
      r1: {
        commits: args.r1.commitCount,
        reveals: args.r1.revealCount,
        nonReveals: args.r1.nonRevealCount,
        tally: totalOf(args.r1Counts),
      },
    },
    duplicateNullifiers: args.dedup.duplicateNullifiers.map((d) => d.nullifierHash),
    missingTxs: [],
    mismatchedHashes: args.dedup.mismatchedHashes,
    r1DoubleReveals: args.r1.doubleReveals,
    r1RevealsWithoutCommit: args.r1.revealsWithoutCommit,
    r1RevealsMissingBucket: args.r1RevealsMissingBucket,
    verifierConfigured: args.verifierConfigured,
    ok,
    errors: [],
  };
}

export function tallyToBundleFormat(state: TallyState): AuditBundleV1Tally {
  const out: Record<string, string> = {};
  for (const [k, v] of state.cells) {
    out[k] = v.toString();
  }
  return out;
}
