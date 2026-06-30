import type { Bytes32Hex, ElectionId, NullifierHash, PublicKeyHex, Sha256Hex, BytesVarHex, BallotCommitment } from "./ids.js";
import { ZKQ_PUBLIC_SCHEMA_R0, ZKQ_PUBLIC_SCHEMA_R1 } from "./version.js";

export const MANIFEST_VERSION = "v1" as const;
export const ARTIFACT_KIND_VK = "verification-key" as const;
export const ARTIFACT_KIND_WASM = "contract-wasm" as const;
export const ARTIFACT_KIND_PROVING_KEY = "proving-key" as const;

export type ArtifactKind =
  | typeof ARTIFACT_KIND_VK
  | typeof ARTIFACT_KIND_WASM
  | typeof ARTIFACT_KIND_PROVING_KEY;

export interface ArtifactRef {
  readonly kind: ArtifactKind;
  readonly id: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256: Sha256Hex;
  readonly sourceUri: string;
  readonly notes: string;
}

export interface CircuitManifest {
  readonly schemaId: string;
  readonly rung: "R0" | "R1";
  readonly artifacts: ReadonlyArray<ArtifactRef>;
  readonly maxOptions: number;
  readonly treeDepth: number;
  readonly notes: string;
}

export interface RelayerManifest {
  readonly networkPassphrase: string;
  readonly submitterPublicKey: PublicKeyHex | null;
  readonly contractIds: ReadonlyArray<BytesVarHex>;
  readonly defaultBodyLimitBytes: number;
  readonly defaultRatePerMinute: number;
  readonly notes: string;
}

export interface ProtocolManifest {
  readonly manifestVersion: typeof MANIFEST_VERSION;
  readonly protocolVersion: string;
  readonly frozen: boolean;
  readonly electionScopeDomainTag: string;
  readonly tallyBuckets: number;
  readonly maxOptions: number;
  readonly treeDepth: number;
  readonly circuits: ReadonlyArray<CircuitManifest>;
  readonly relayer: RelayerManifest | null;
  readonly publicSchemas: ReadonlyArray<typeof ZKQ_PUBLIC_SCHEMA_R0 | typeof ZKQ_PUBLIC_SCHEMA_R1>;
}

export interface ProofEnvelope {
  readonly electionId: ElectionId;
  readonly publicSchemaId: string;
  readonly publicSignals: ReadonlyArray<string>;
  readonly proofBytes: BytesVarHex;
}

export interface CommitProofEnvelope extends ProofEnvelope {
  readonly ballotCommitment: BallotCommitment;
  readonly nullifierHash: NullifierHash;
}

export interface RevealEnvelope {
  readonly electionId: ElectionId;
  readonly ballotCommitment: BallotCommitment;
  readonly vote: number;
  readonly salt: Bytes32Hex;
}

export interface CastRequest extends ProofEnvelope {
  readonly idempotencyKey: string;
  readonly clientTag: string;
}

export interface RevealRequest extends RevealEnvelope {
  readonly idempotencyKey: string;
  readonly clientTag: string;
}

export interface CastResponseAccepted {
  readonly status: "accepted";
  readonly txHash: string;
  readonly nullifierHash: NullifierHash;
  /** Real SHA-256 of the canonical proof envelope. */
  readonly proofHash: Sha256Hex;
  /** Real SHA-256 of canonical publicSignals JSON. */
  readonly publicSignalsHash: Sha256Hex;
  readonly rejectReason: null;
}

export interface CastResponseDuplicate {
  readonly status: "duplicate";
  readonly txHash: string;
  readonly nullifierHash: NullifierHash;
  /** Real SHA-256 of the canonical proof envelope. */
  readonly proofHash: Sha256Hex;
  /** Real SHA-256 of canonical publicSignals JSON. */
  readonly publicSignalsHash: Sha256Hex;
  readonly rejectReason: null;
}

export interface CastResponseRejected {
  readonly status: "rejected";
  readonly txHash: null;
  readonly nullifierHash: null;
  readonly proofHash: null;
  readonly publicSignalsHash: null;
  readonly rejectReason: string;
}

export type CastResponse = CastResponseAccepted | CastResponseDuplicate | CastResponseRejected;

/**
 * Frozen response shape for /submit R1 reveal. A reveal has no proof, so
 * there is no audit-relevant hash to return: the relay attests only the
 * (electionId, ballotCommitment) pair that will appear on the ledger and
 * the resulting tx hash. `payloadHash`, `proofHash`, and
 * `publicSignalsHash` are NOT part of this interface and MUST NOT be
 * added: a synthetic reveal hash is unauditable and would be fake.
 */
export interface RevealResponse {
  readonly status: "accepted" | "rejected";
  readonly txHash: string | null;
  readonly ballotCommitment: BallotCommitment;
  readonly rejectReason: string | null;
}
