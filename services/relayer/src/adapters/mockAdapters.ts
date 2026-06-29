import {
  type CastRequest,
  type CommitProofEnvelope,
  isHex,
  isHex32,
  isZkqProtocolError,
  parsePublicSignals,
  PUBLIC_SCHEMAS,
  type ProofEnvelope,
  type RevealRequest,
  type Sha256Hex,
  ZkqProtocolError,
  ZKQ_PUBLIC_SCHEMA_R0,
  ZKQ_PUBLIC_SCHEMA_R1,
  bytesToHex,
  hexToBytes,
  isSha256Hex,
} from "@zk-quorum/protocol";
import {
  type OffchainVerifier,
  type SimulationResult,
  type Simulator,
  type SubmitResult,
  type Submitter,
  type VerifierResult,
} from "./types.js";

function sha256Hex(bytes: Uint8Array): Sha256Hex {
  // Trivial non-cryptographic placeholder for the mock; the real one is in
  // the snarkjs adapter (when artefacts are integrated).
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const padded = h.toString(16).padStart(8, "0");
  return ("0x" + (padded + padded + padded + padded + padded + padded + padded + padded)) as Sha256Hex;
}

export function hashEnvelope(envelope: ProofEnvelope | CommitProofEnvelope): { proofHash: Sha256Hex; publicSignalsHash: Sha256Hex } {
  const proofBytes = hexToBytes(envelope.proofBytes);
  const signalsJson = JSON.stringify(envelope.publicSignals);
  const signalsBytes = new TextEncoder().encode(signalsJson);
  return {
    proofHash: sha256Hex(proofBytes),
    publicSignalsHash: sha256Hex(signalsBytes),
  };
}

export class MockOffchainVerifier implements OffchainVerifier {
  public readonly id = "mock-offchain";
  public readonly acceptAll: boolean;

  constructor(options: { acceptAll?: boolean } = {}) {
    this.acceptAll = options.acceptAll ?? true;
  }

  public async verifyProof(envelope: ProofEnvelope | CommitProofEnvelope): Promise<VerifierResult> {
    if (!isHex(envelope.proofBytes) || envelope.proofBytes.length < 4) {
      return { ok: false, reason: "proofBytes must be a non-empty 0x hex", code: "INVALID_HEX" };
    }
    const schema = PUBLIC_SCHEMAS[envelope.publicSchemaId];
    if (schema === undefined) {
      return { ok: false, reason: "unknown public schema", code: "INVALID_SCHEMA_VERSION" };
    }
    try {
      const parsed = parsePublicSignals(schema, envelope.publicSignals);
      if (parsed.vote !== null && parsed.vote >= parsed.optionCount) {
        return { ok: false, reason: "vote out of range", code: "INVALID_VOTE_RANGE" };
      }
    } catch (e) {
      if (isZkqProtocolError(e)) {
        return { ok: false, reason: e.message, code: e.code };
      }
      throw e;
    }
    if (!this.acceptAll) {
      return { ok: false, reason: "mock forced reject", code: "INVALID_FIELD_ELEMENT" };
    }
    const hashes = hashEnvelope(envelope);
    return { ok: true, ...hashes };
  }
}

export class MockSimulator implements Simulator {
  public readonly id = "mock-simulator";
  public readonly fail: boolean;

  constructor(options: { fail?: boolean } = {}) {
    this.fail = options.fail ?? false;
  }

  public async simulateCast(_envelope: ProofEnvelope): Promise<SimulationResult> {
    if (this.fail) {
      return { ok: false, reason: "mock forced simulation failure", code: "ADAPTER_NOT_CONFIGURED" };
    }
    return { ok: true, estimatedFee: 100n, estimatedResources: { cpu: 1_000_000, mem: 16_384 } };
  }

  public async simulateReveal(_input: { electionId: string; ballotCommitment: string; vote: number; salt: string }): Promise<SimulationResult> {
    if (this.fail) {
      return { ok: false, reason: "mock forced simulation failure", code: "ADAPTER_NOT_CONFIGURED" };
    }
    return { ok: true, estimatedFee: 50n, estimatedResources: { cpu: 100_000, mem: 4_096 } };
  }
}

export class MockSubmitter implements Submitter {
  public readonly id = "mock-submitter";
  public readonly account: string | null;
  public readonly failNext: { value: boolean; reset?: () => void } | null;
  private seq = 0;

  constructor(options: { account?: string | null; failOnce?: boolean } = {}) {
    this.account = options.account ?? null;
    this.failNext = options.failOnce ? { value: true, reset: () => { this.failNext!.value = false; } } : null;
  }

  public async submitCast(envelope: ProofEnvelope, publicSignalsHash: Sha256Hex, _proofHash: Sha256Hex): Promise<SubmitResult> {
    if (this.failNext?.value) {
      this.failNext.reset?.();
      return { ok: false, reason: "mock forced submit failure", code: "ADAPTER_NOT_CONFIGURED" };
    }
    const schema = PUBLIC_SCHEMAS[envelope.publicSchemaId];
    if (schema === undefined) {
      return { ok: false, reason: "unknown schema", code: "INVALID_SCHEMA_VERSION" };
    }
    const parsed = parsePublicSignals(schema, envelope.publicSignals);
    const txHash = bytesToHex(new Uint8Array(32).map((_, i) => (parsed.nullifierHash.charCodeAt(2 + i * 2) + this.seq + i) & 0xff));
    this.seq += 1;
    void publicSignalsHash;
    return { ok: true, txHash: txHash as `0x${string}`, fee: 100n };
  }

  public async submitReveal(input: { electionId: string; ballotCommitment: string; vote: number; salt: string }): Promise<SubmitResult> {
    if (!isHex32(input.ballotCommitment)) {
      return { ok: false, reason: "ballotCommitment must be 32-byte hex", code: "INVALID_HEX" };
    }
    this.seq += 1;
    return { ok: true, txHash: (bytesToHex(new Uint8Array(32).map((_, i) => (input.electionId.charCodeAt(2 + i * 2) + this.seq + i) & 0xff))) as `0x${string}`, fee: 50n };
  }
}

export const PROOF_HASH_PLACEHOLDER: Sha256Hex = ("0x" + "00".repeat(32)) as Sha256Hex;
export const PUBLIC_HASH_PLACEHOLDER: Sha256Hex = ("0x" + "11".repeat(32)) as Sha256Hex;

export interface CastPipeline {
  readonly verifier: OffchainVerifier;
  readonly simulator: Simulator;
  readonly submitter: Submitter;
}

export interface CastPipelineDeps {
  readonly verifier: OffchainVerifier;
  readonly simulator: Simulator;
  readonly submitter: Submitter;
}

export function validateCastRequestShape(req: unknown): asserts req is CastRequest {
  if (req === null || typeof req !== "object") {
    throw new ZkqProtocolError("MISSING_PUBLIC_SIGNAL", "body must be an object");
  }
  const r = req as Record<string, unknown>;
  if (typeof r.electionId !== "string" || !isHex32(r.electionId as string)) {
    throw new ZkqProtocolError("MISSING_PUBLIC_SIGNAL", "electionId must be 32-byte hex");
  }
  if (typeof r.publicSchemaId !== "string") {
    throw new ZkqProtocolError("INVALID_SCHEMA_VERSION", "publicSchemaId required");
  }
  if (r.publicSchemaId !== ZKQ_PUBLIC_SCHEMA_R0 && r.publicSchemaId !== ZKQ_PUBLIC_SCHEMA_R1) {
    throw new ZkqProtocolError("INVALID_SCHEMA_VERSION", "publicSchemaId not supported");
  }
  if (!Array.isArray(r.publicSignals) || r.publicSignals.length === 0) {
    throw new ZkqProtocolError("INVALID_SIGNAL_COUNT", "publicSignals must be a non-empty array");
  }
  if (typeof r.proofBytes !== "string" || !isHex(r.proofBytes)) {
    throw new ZkqProtocolError("INVALID_HEX", "proofBytes must be 0x hex");
  }
  if (typeof r.idempotencyKey !== "string" || r.idempotencyKey.length < 8 || r.idempotencyKey.length > 128) {
    throw new ZkqProtocolError("RELAYER_IDEMPOTENT_REPLAY", "idempotencyKey length must be in [8, 128]");
  }
  if (typeof r.clientTag !== "string" || r.clientTag.length < 1 || r.clientTag.length > 64) {
    throw new ZkqProtocolError("MISSING_PUBLIC_SIGNAL", "clientTag length must be in [1, 64]");
  }
}

export function validateRevealRequestShape(req: unknown): asserts req is RevealRequest {
  if (req === null || typeof req !== "object") {
    throw new ZkqProtocolError("MISSING_PUBLIC_SIGNAL", "body must be an object");
  }
  const r = req as Record<string, unknown>;
  if (typeof r.electionId !== "string" || !isHex32(r.electionId)) {
    throw new ZkqProtocolError("MISSING_PUBLIC_SIGNAL", "electionId must be 32-byte hex");
  }
  if (typeof r.ballotCommitment !== "string" || !isHex32(r.ballotCommitment)) {
    throw new ZkqProtocolError("MISSING_PUBLIC_SIGNAL", "ballotCommitment must be 32-byte hex");
  }
  if (typeof r.nullifierHash !== "string" || !isHex32(r.nullifierHash)) {
    throw new ZkqProtocolError("MISSING_PUBLIC_SIGNAL", "nullifierHash must be 32-byte hex");
  }
  if (typeof r.vote !== "number" || !Number.isInteger(r.vote) || r.vote < 0) {
    throw new ZkqProtocolError("INVALID_VOTE_RANGE", "vote must be a non-negative integer");
  }
  if (typeof r.salt !== "string" || !isHex32(r.salt)) {
    throw new ZkqProtocolError("R1_NON_ZERO_SALT", "salt must be 32-byte hex");
  }
  if (typeof r.idempotencyKey !== "string" || r.idempotencyKey.length < 8 || r.idempotencyKey.length > 128) {
    throw new ZkqProtocolError("RELAYER_IDEMPOTENT_REPLAY", "idempotencyKey length must be in [8, 128]");
  }
  if (typeof r.clientTag !== "string" || r.clientTag.length < 1 || r.clientTag.length > 64) {
    throw new ZkqProtocolError("MISSING_PUBLIC_SIGNAL", "clientTag length must be in [1, 64]");
  }
}

export function isSha256HexOrThrow(value: string): Sha256Hex {
  if (!isSha256Hex(value)) {
    throw new ZkqProtocolError("INVALID_HEX", "expected SHA-256 hex");
  }
  return value;
}
