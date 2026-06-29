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
  readonly nullifierHash: NullifierHash;
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

export interface CastResponse {
  readonly status: "accepted" | "duplicate" | "rejected";
  readonly txHash: string | null;
  readonly nullifierHash: NullifierHash;
  readonly proofHash: Sha256Hex;
  readonly publicSignalsHash: Sha256Hex;
  readonly rejectReason: string | null;
}

export interface RevealResponse {
  readonly status: "accepted" | "rejected";
  readonly txHash: string | null;
  readonly ballotCommitment: BallotCommitment;
  readonly proofHash: Sha256Hex;
  readonly publicSignalsHash: Sha256Hex;
  readonly rejectReason: string | null;
}
