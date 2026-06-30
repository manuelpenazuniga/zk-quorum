import type { CastResponse, CommitProofEnvelope, ProofEnvelope, RevealResponse } from "@zk-quorum/protocol";
import { isHex, parsePublicSignals, PUBLIC_SCHEMAS, ZkqProtocolError } from "@zk-quorum/protocol";
import type { OffchainVerifier, Simulator, Submitter } from "./types.js";

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

function extractNullifier(envelope: ProofEnvelope | CommitProofEnvelope): string {
  const schema = PUBLIC_SCHEMAS[envelopeSchema(envelope)]!;
  const parsed = parsePublicSignals(schema, envelope.publicSignals);
  return parsed.nullifierHash;
}

export async function executeCast(input: CastExecutionInput): Promise<CastResponse> {
  const { envelope, verifier, simulator, submitter } = input;
  if (!isHex(envelope.proofBytes)) {
    throw new ZkqProtocolError("INVALID_HEX", "proofBytes must be hex", { proofBytes: envelope.proofBytes });
  }
  const verification = await verifier.verifyProof(envelope);
  if (!verification.ok) {
    // Audit U0: a rejected cast returns null hashes, never a synthetic
    // placeholder. The boolean `status` is the only signal of "proven".
    return {
      status: "rejected",
      txHash: null,
      nullifierHash: extractNullifier(envelope) as `0x${string}`,
      proofHash: null,
      publicSignalsHash: null,
      rejectReason: verification.reason,
    };
  }
  // Audit U0: accepted / successfully-simulated casts propagate the
  // verifier-returned hashes verbatim. The relay never locally
  // re-derives a hash for an accepted cast.
  const sim = await simulator.simulateCast(envelope);
  if (!sim.ok) {
    return {
      status: "rejected",
      txHash: null,
      nullifierHash: extractNullifier(envelope) as `0x${string}`,
      proofHash: null,
      publicSignalsHash: null,
      rejectReason: sim.reason,
    };
  }
  const submit = await submitter.submitCast(envelope, verification.publicSignalsHash, verification.proofHash);
  if (!submit.ok) {
    return {
      status: "rejected",
      txHash: submit.txHash ?? null,
      nullifierHash: extractNullifier(envelope) as `0x${string}`,
      proofHash: null,
      publicSignalsHash: null,
      rejectReason: submit.reason,
    };
  }
  return {
    status: "accepted",
    txHash: submit.txHash,
    nullifierHash: extractNullifier(envelope) as `0x${string}`,
    proofHash: verification.proofHash,
    publicSignalsHash: verification.publicSignalsHash,
    rejectReason: null,
  };
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
