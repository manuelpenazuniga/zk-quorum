import type {
  CastResponse,
  CastResponseAccepted,
  CastResponseDuplicate,
  CastResponseRejected,
  CommitProofEnvelope,
  NullifierHash,
  ProofEnvelope,
  RevealResponse,
} from "@zk-quorum/protocol";
import { isHex, parsePublicSignals, PUBLIC_SCHEMAS, ZkqProtocolError } from "@zk-quorum/protocol";
import type { OffchainVerifier, Simulator, Submitter, VerifierSuccess } from "./types.js";

export interface CastExecutionInput {
  readonly envelope: ProofEnvelope;
  readonly verifier: OffchainVerifier;
  readonly simulator: Simulator;
  readonly submitter: Submitter;
}

export interface RevealExecutionInput {
  readonly electionId: string;
  readonly ballotCommitment: string;
  readonly vote: number;
  readonly salt: string;
  readonly submitter: Submitter;
  readonly simulator: Simulator;
}

function envelopeSchema(envelope: ProofEnvelope | CommitProofEnvelope): "PUBLIC_SCHEMA_V1_R0" | "PUBLIC_SCHEMA_V1_R1" {
  if (envelope.publicSchemaId === "PUBLIC_SCHEMA_V1_R0" || envelope.publicSchemaId === "PUBLIC_SCHEMA_V1_R1") {
    return envelope.publicSchemaId;
  }
  throw new ZkqProtocolError("INVALID_SCHEMA_VERSION", "unsupported schema", { id: envelope.publicSchemaId });
}

function extractNullifier(envelope: ProofEnvelope | CommitProofEnvelope): NullifierHash {
  const schema = PUBLIC_SCHEMAS[envelopeSchema(envelope)]!;
  const parsed = parsePublicSignals(schema, envelope.publicSignals);
  return parsed.nullifierHash;
}

function buildRejected(rejectReason: string): CastResponseRejected {
  // Audit U0: a rejected cast returns ALL hash fields null, never a
  // synthetic placeholder. The `status` string is the only signal.
  return {
    status: "rejected",
    txHash: null,
    nullifierHash: null,
    proofHash: null,
    publicSignalsHash: null,
    rejectReason,
  };
}

function buildAccepted(
  submit: { readonly txHash: string },
  nullifierHash: NullifierHash,
  verification: VerifierSuccess,
): CastResponseAccepted {
  return {
    status: "accepted",
    txHash: submit.txHash,
    nullifierHash,
    proofHash: verification.proofHash,
    publicSignalsHash: verification.publicSignalsHash,
    rejectReason: null,
  };
}

function buildDuplicate(
  submit: { readonly txHash: string },
  nullifierHash: NullifierHash,
  verification: VerifierSuccess,
): CastResponseDuplicate {
  return {
    status: "duplicate",
    txHash: submit.txHash,
    nullifierHash,
    proofHash: verification.proofHash,
    publicSignalsHash: verification.publicSignalsHash,
    rejectReason: null,
  };
}

export async function executeCast(input: CastExecutionInput): Promise<CastResponse> {
  const { envelope, verifier, simulator, submitter } = input;
  if (!isHex(envelope.proofBytes)) {
    throw new ZkqProtocolError("INVALID_HEX", "proofBytes must be hex", { proofBytes: envelope.proofBytes });
  }
  const verification = await verifier.verifyProof(envelope);
  if (!verification.ok) {
    return buildRejected(verification.reason);
  }
  const sim = await simulator.simulateCast(envelope);
  if (!sim.ok) {
    return buildRejected(sim.reason);
  }
  const nullifierHash = extractNullifier(envelope);
  const submit = await submitter.submitCast(envelope, verification.publicSignalsHash, verification.proofHash);
  if (!submit.ok) {
    if (submit.duplicate) {
      // A duplicate still carries the real hashes from the off-chain
      // verifier; txHash is the on-chain transaction that was rejected
      // for duplicate-nullifier and must be non-null.
      return buildDuplicate(
        { txHash: submit.txHash ?? ("0x" + "00".repeat(32)) },
        nullifierHash,
        verification,
      );
    }
    return buildRejected(submit.reason);
  }
  return buildAccepted(submit, nullifierHash, verification);
}

export async function executeReveal(input: RevealExecutionInput): Promise<RevealResponse> {
  const { electionId, ballotCommitment, vote, salt, submitter, simulator } = input;
  if (!isHex(ballotCommitment as string) || !isHex(salt as string)) {
    throw new ZkqProtocolError("INVALID_HEX", "ballotCommitment and salt must be hex", { ballotCommitment, salt });
  }
  // Frozen U0: a reveal response has no hash field. The relay attests
  // only the (electionId, ballotCommitment) pair and the resulting tx
  // hash. There is no payload hash, no proof hash, and no
  // publicSignalsHash on the reveal wire.
  const sim = await simulator.simulateReveal({ electionId, ballotCommitment, vote, salt });
  if (!sim.ok) {
    return {
      status: "rejected",
      txHash: null,
      ballotCommitment: ballotCommitment as `0x${string}`,
      rejectReason: sim.reason,
    };
  }
  const submit = await submitter.submitReveal({ electionId, ballotCommitment, vote, salt });
  if (!submit.ok) {
    return {
      status: "rejected",
      txHash: submit.txHash ?? null,
      ballotCommitment: ballotCommitment as `0x${string}`,
      rejectReason: submit.reason,
    };
  }
  return {
    status: "accepted",
    txHash: submit.txHash,
    ballotCommitment: ballotCommitment as `0x${string}`,
    rejectReason: null,
  };
}
