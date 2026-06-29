import { ZKQ_EVENT_SCHEMA_V1 } from "./version.js";
import type { BallotCommitment, ElectionId, NullifierHash, RootHash, TallyBucket, Sha256Hex } from "./ids.js";

export const EVENT_NAME_VOTE_CAST = "VoteCastV1" as const;
export const EVENT_NAME_VOTE_COMMITTED = "VoteCommittedV1" as const;
export const EVENT_NAME_VOTE_REVEALED = "VoteRevealedV1" as const;

export type EventName =
  | typeof EVENT_NAME_VOTE_CAST
  | typeof EVENT_NAME_VOTE_COMMITTED
  | typeof EVENT_NAME_VOTE_REVEALED;

export interface EventEnvelope<T> {
  readonly schema: typeof ZKQ_EVENT_SCHEMA_V1;
  readonly name: EventName;
  readonly electionId: ElectionId;
  readonly payload: T;
}

export interface VoteCastV1Payload {
  readonly nullifierHash: NullifierHash;
  readonly vote: number;
  readonly tallyBucket: TallyBucket;
  readonly publicSchemaVersion: string;
  readonly proofHash: Sha256Hex;
  readonly publicSignalsHash: Sha256Hex;
  readonly stateRoot: RootHash;
  readonly associationRoot: RootHash;
}

export interface VoteCommittedV1Payload {
  readonly nullifierHash: NullifierHash;
  readonly ballotCommitment: BallotCommitment;
  readonly tallyBucket: TallyBucket;
  readonly publicSchemaVersion: string;
  readonly proofHash: Sha256Hex;
  readonly publicSignalsHash: Sha256Hex;
  readonly stateRoot: RootHash;
  readonly associationRoot: RootHash;
}

export interface VoteRevealedV1Payload {
  readonly electionId: ElectionId;
  readonly ballotCommitment: BallotCommitment;
  readonly vote: number;
}

export type VoteCastV1 = EventEnvelope<VoteCastV1Payload>;
export type VoteCommittedV1 = EventEnvelope<VoteCommittedV1Payload>;
export type VoteRevealedV1 = EventEnvelope<VoteRevealedV1Payload>;

export type ZkQuorumEvent = VoteCastV1 | VoteCommittedV1 | VoteRevealedV1;
