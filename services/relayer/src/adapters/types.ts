import type {
  CastRequest,
  CastResponse,
  CommitProofEnvelope,
  ProofEnvelope,
  RevealRequest,
  Sha256Hex,
  ZkqErrorCode,
} from "@zk-quorum/protocol";

export interface VerifierSuccess {
  readonly ok: true;
  readonly publicSignalsHash: Sha256Hex;
  readonly proofHash: Sha256Hex;
}

export interface VerifierFailure {
  readonly ok: false;
  readonly reason: string;
  readonly code?: ZkqErrorCode;
}

export type VerifierResult = VerifierSuccess | VerifierFailure;

export interface OffchainVerifier {
  readonly id: string;
  verifyProof(envelope: ProofEnvelope | CommitProofEnvelope): Promise<VerifierResult>;
}

export interface SimulationSuccess {
  readonly ok: true;
  readonly estimatedFee: bigint | null;
  readonly estimatedResources: { readonly cpu: number; readonly mem: number } | null;
}

export interface SimulationFailure {
  readonly ok: false;
  readonly reason: string;
  readonly code?: ZkqErrorCode;
}

export type SimulationResult = SimulationSuccess | SimulationFailure;

export interface Submitter {
  readonly id: string;
  submitCast(envelope: ProofEnvelope, publicSignalsHash: Sha256Hex, proofHash: Sha256Hex): Promise<SubmitResult>;
  submitReveal(input: {
    electionId: string;
    ballotCommitment: string;
    vote: number;
    salt: string;
  }): Promise<SubmitResult>;
}

export interface SubmitSuccess {
  readonly ok: true;
  readonly txHash: string;
  readonly fee: bigint | null;
}

export interface SubmitFailure {
  readonly ok: false;
  readonly reason: string;
  readonly code?: ZkqErrorCode;
  readonly txHash?: string;
}

export type SubmitResult = SubmitSuccess | SubmitFailure;

export interface Simulator {
  readonly id: string;
  simulateCast(envelope: ProofEnvelope): Promise<SimulationResult>;
  simulateReveal(input: { electionId: string; ballotCommitment: string; vote: number; salt: string }): Promise<SimulationResult>;
}

export function isVerifierSuccess(r: VerifierResult): r is VerifierSuccess {
  return r.ok;
}

export function isSubmitSuccess(r: SubmitResult): r is SubmitSuccess {
  return r.ok;
}

export function castRequestToEnvelope(req: CastRequest): ProofEnvelope {
  return {
    electionId: req.electionId,
    publicSchemaId: req.publicSchemaId,
    publicSignals: req.publicSignals,
    proofBytes: req.proofBytes,
  };
}

export function revealRequestToEnvelope(req: RevealRequest): { electionId: string; ballotCommitment: string; vote: number; salt: string } {
  return {
    electionId: req.electionId,
    ballotCommitment: req.ballotCommitment,
    vote: req.vote,
    salt: req.salt,
  };
}

export function successResponseFromEnvelope(
  envelope: ProofEnvelope,
  submit: SubmitSuccess,
  hashes: { proofHash: Sha256Hex; publicSignalsHash: Sha256Hex; nullifierHash: string | null },
): CastResponse {
  if (hashes.nullifierHash === null) {
    throw new Error("expected nullifierHash in public signals: " + envelope.publicSchemaId);
  }
  return {
    status: "accepted",
    txHash: submit.txHash,
    nullifierHash: hashes.nullifierHash as never,
    proofHash: hashes.proofHash,
    publicSignalsHash: hashes.publicSignalsHash,
    rejectReason: null,
  };
}
