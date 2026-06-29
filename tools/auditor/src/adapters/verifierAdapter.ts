import type { ProofEnvelope, Sha256Hex } from "@zk-quorum/protocol";

export interface ProofVerification {
  readonly ok: boolean;
  readonly publicSignalsHash: Sha256Hex;
  readonly proofHash: Sha256Hex;
  readonly reason?: string;
}

export interface VerifierAdapter {
  readonly id: string;
  verify(envelope: ProofEnvelope): Promise<ProofVerification>;
}

export class NoopVerifierAdapter implements VerifierAdapter {
  public readonly id = "noop";
  public async verify(envelope: ProofEnvelope): Promise<ProofVerification> {
    void envelope;
    return {
      ok: false,
      publicSignalsHash: ("0x" + "00".repeat(32)) as Sha256Hex,
      proofHash: ("0x" + "00".repeat(32)) as Sha256Hex,
      reason: "noop verifier: real Groth16 adapter pending wt/crypto",
    };
  }
}

export class StaticAcceptVerifierAdapter implements VerifierAdapter {
  public readonly id = "static-accept";
  constructor(private readonly hashes: { proofHash: Sha256Hex; publicSignalsHash: Sha256Hex }) {}
  public async verify(_envelope: ProofEnvelope): Promise<ProofVerification> {
    return { ok: true, proofHash: this.hashes.proofHash, publicSignalsHash: this.hashes.publicSignalsHash };
  }
}

export const PENDING_VERIFIER_REASON = "groth16-verifier-pending" as const;
