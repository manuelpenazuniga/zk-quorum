import type {
  CastResponse,
  CastResponseAccepted,
  CastResponseDuplicate,
  CastResponseRejected,
  CommitProofEnvelope,
  NullifierHash,
  ProofEnvelope,
  RevealResponse,
  Sha256Hex,
} from "@zk-quorum/protocol";
import { isHex, isSha256Hex, parsePublicSignals, PUBLIC_SCHEMAS, ZkqProtocolError } from "@zk-quorum/protocol";
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
  submit: { readonly txHash: Sha256Hex },
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
  submit: { readonly txHash: Sha256Hex },
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

function isCanonicalTxHash(txHash: unknown): txHash is Sha256Hex {
  return isSha256Hex(txHash);
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
      // Audit integrator: a duplicate must carry the real on-chain txHash.
      // If the submitter reports duplicate but omits the hash, we reject
      // rather than fabricating a placeholder.
      if (!isCanonicalTxHash(submit.txHash)) {
        return buildRejected("duplicate nullifier reported without a canonical txHash");
      }
      return buildDuplicate({ txHash: submit.txHash }, nullifierHash, verification);
    }
    return buildRejected(submit.reason);
  }
  if (!isCanonicalTxHash(submit.txHash)) {
    return buildRejected("submitter returned a non-canonical txHash");
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
    const txHash = submit.txHash ?? null;
    if (txHash !== null && !isSha256Hex(txHash)) {
      return {
        status: "rejected",
        txHash: null,
        ballotCommitment: ballotCommitment as `0x${string}`,
        rejectReason: "submitter returned a non-canonical txHash",
      };
    }
    return {
      status: "rejected",
      txHash,
      ballotCommitment: ballotCommitment as `0x${string}`,
      rejectReason: submit.reason,
    };
  }
  if (!isSha256Hex(submit.txHash)) {
    return {
      status: "rejected",
      txHash: null,
      ballotCommitment: ballotCommitment as `0x${string}`,
      rejectReason: "submitter returned a non-canonical txHash",
    };
  }
  return {
    status: "accepted",
    txHash: submit.txHash,
    ballotCommitment: ballotCommitment as `0x${string}`,
    rejectReason: null,
  };
}
