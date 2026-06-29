import type {
  BallotCommitment,
  ElectionId,
  EventName,
  NullifierHash,
  Sha256Hex,
  ZkQuorumEvent,
} from "@zk-quorum/protocol";
import { EVENT_NAME_VOTE_CAST, EVENT_NAME_VOTE_COMMITTED, EVENT_NAME_VOTE_REVEALED, ZKQ_EVENT_SCHEMA_V1 } from "@zk-quorum/protocol";

export interface AuditBundleV1 {
  readonly schema: "AUDIT_BUNDLE_V1";
  readonly electionId: ElectionId;
  readonly manifestHash: Sha256Hex;
  readonly contractId: string;
  readonly wasmHash: Sha256Hex;
  readonly vkR0Hash: Sha256Hex;
  readonly vkR1Hash: Sha256Hex;
  readonly networkPassphrase: string;
  readonly events: ReadonlyArray<ZkQuorumEvent>;
  readonly proofArchive: ReadonlyArray<ProofArchiveEntry>;
  readonly tallies: {
    readonly R0: ReadonlyMap<number, bigint>;
    readonly R1: ReadonlyMap<number, bigint>;
  };
}

export interface ProofArchiveEntry {
  readonly txHash: string;
  readonly proofHash: Sha256Hex;
  readonly publicSignalsHash: Sha256Hex;
  readonly payloadHex: string;
}

export interface AuditSummary {
  readonly electionId: ElectionId;
  readonly totals: {
    readonly r0: { readonly commits: bigint; readonly tally: bigint };
    readonly r1: { readonly commits: bigint; readonly reveals: bigint; readonly nonReveals: bigint; readonly tally: bigint };
  };
  readonly duplicateNullifiers: ReadonlyArray<NullifierHash>;
  readonly missingTxs: ReadonlyArray<string>;
  readonly mismatchedHashes: ReadonlyArray<{ readonly txHash: string; readonly reason: string }>;
  readonly r1DoubleReveals: ReadonlyArray<BallotCommitment>;
  readonly r1RevealsWithoutCommit: ReadonlyArray<{ readonly ballotCommitment: BallotCommitment; readonly txHash: string }>;
  readonly ok: boolean;
  readonly errors: ReadonlyArray<string>;
}

export const AUDIT_BUNDLE_SCHEMA = "AUDIT_BUNDLE_V1" as const;

export function isVoteCast(event: ZkQuorumEvent): event is Extract<ZkQuorumEvent, { name: typeof EVENT_NAME_VOTE_CAST }> {
  return event.name === EVENT_NAME_VOTE_CAST;
}

export function isVoteCommitted(event: ZkQuorumEvent): event is Extract<ZkQuorumEvent, { name: typeof EVENT_NAME_VOTE_COMMITTED }> {
  return event.name === EVENT_NAME_VOTE_COMMITTED;
}

export function isVoteRevealed(event: ZkQuorumEvent): event is Extract<ZkQuorumEvent, { name: typeof EVENT_NAME_VOTE_REVEALED }> {
  return event.name === EVENT_NAME_VOTE_REVEALED;
}

export interface AuditLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export const NOOP_AUDIT_LOGGER: AuditLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export function listEventNames(): EventName[] {
  return [EVENT_NAME_VOTE_CAST, EVENT_NAME_VOTE_COMMITTED, EVENT_NAME_VOTE_REVEALED];
}

export const EVENT_SCHEMA = ZKQ_EVENT_SCHEMA_V1;
