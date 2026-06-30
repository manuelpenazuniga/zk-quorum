import type {
  CommitProofEnvelope,
  ProofEnvelope,
  Sha256Hex,
} from "@zk-quorum/protocol";
import type {
  OffchainVerifier,
  SimulationResult,
  Simulator,
  SubmitResult,
  Submitter,
  VerifierResult,
} from "./types.js";
import { ZkqProtocolError } from "@zk-quorum/protocol";

/**
 * Groth16 off-chain verifier adapter. Stays in the relayer as a typed
 * seam; instantiation is blocked until the wt/crypto lane provides:
 *   - the VK JSON for R0 and R1, both BLS12-381
 *   - a working `snarkjs.groth16.verify(vk, publicSignals, proof)` bridge
 *
 * Until then, every call rejects with ADAPTER_NOT_CONFIGURED. The production
 * entry point refuses to start while this unconfigured adapter is in scope;
 * mocks are only wired by the test factory (see src/testDeps.ts).
 */
export class Groth16SnarkjsVerifier implements OffchainVerifier {
  public readonly id = "groth16-snarkjs";
  private readonly vkR0Path: string | null;
  private readonly vkR1Path: string | null;

  constructor(opts: { vkR0Path?: string | null; vkR1Path?: string | null } = {}) {
    this.vkR0Path = opts.vkR0Path ?? null;
    this.vkR1Path = opts.vkR1Path ?? null;
  }

  public async verifyProof(envelope: ProofEnvelope | CommitProofEnvelope): Promise<VerifierResult> {
    if (envelope.publicSchemaId === "PUBLIC_SCHEMA_V1_R0" && this.vkR0Path === null) {
      return { ok: false, reason: "R0 VK not loaded", code: "ADAPTER_NOT_CONFIGURED" };
    }
    if (envelope.publicSchemaId === "PUBLIC_SCHEMA_V1_R1" && this.vkR1Path === null) {
      return { ok: false, reason: "R1 VK not loaded", code: "ADAPTER_NOT_CONFIGURED" };
    }
    // Real bridge: dynamic import of snarkjs + circuit-specific VK path.
    // Intentionally not wired in this scaffold: snarkjs is the dependency
    // boundary that the wt/crypto lane must version-pin.
    return { ok: false, reason: "snarkjs bridge not configured", code: "ADAPTER_NOT_CONFIGURED" };
  }
}

export class StellarSubmitter implements Submitter {
  public readonly id = "stellar-submitter";
  private readonly submitterSecret: string | null;
  private readonly horizonUrl: string | null;
  private readonly networkPassphrase: string | null;

  constructor(opts: { submitterSecret?: string | null; horizonUrl?: string | null; networkPassphrase?: string | null } = {}) {
    this.submitterSecret = opts.submitterSecret ?? null;
    this.horizonUrl = opts.horizonUrl ?? null;
    this.networkPassphrase = opts.networkPassphrase ?? null;
  }

  public async submitCast(_envelope: ProofEnvelope, _publicSignalsHash: Sha256Hex, _proofHash: Sha256Hex): Promise<SubmitResult> {
    if (this.submitterSecret === null || this.horizonUrl === null || this.networkPassphrase === null) {
      return { ok: false, reason: "submitter not configured", code: "ADAPTER_NOT_CONFIGURED" };
    }
    return { ok: false, reason: "Stellar submit pipeline not wired in this scaffold", code: "ADAPTER_NOT_CONFIGURED" };
  }

  public async submitReveal(_input: { electionId: string; ballotCommitment: string; vote: number; salt: string }): Promise<SubmitResult> {
    if (this.submitterSecret === null) {
      return { ok: false, reason: "submitter not configured", code: "ADAPTER_NOT_CONFIGURED" };
    }
    return { ok: false, reason: "Stellar submit pipeline not wired in this scaffold", code: "ADAPTER_NOT_CONFIGURED" };
  }
}

export class SorobanSimulator implements Simulator {
  public readonly id = "soroban-simulator";
  public async simulateCast(_envelope: ProofEnvelope): Promise<SimulationResult> {
    throw new ZkqProtocolError("ADAPTER_NOT_CONFIGURED", "Soroban simulation not wired in this scaffold");
  }
  public async simulateReveal(_input: { electionId: string; ballotCommitment: string; vote: number; salt: string }): Promise<SimulationResult> {
    throw new ZkqProtocolError("ADAPTER_NOT_CONFIGURED", "Soroban simulation not wired in this scaffold");
  }
}
