import type { ProofEnvelope, Sha256Hex } from "@zk-quorum/protocol";
import { ZkqProtocolError } from "@zk-quorum/protocol";

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

/**
 * Audit integrator finding: NoopVerifierAdapter returns ok=false with the
 * explicit VERIFIER_NOT_CONFIGURED code. The CLI surfaces this so the
 * auditor never silently skips proofs and claims ok.
 */
export class NoopVerifierAdapter implements VerifierAdapter {
  public readonly id = "noop";
  public async verify(envelope: ProofEnvelope): Promise<ProofVerification> {
    void envelope;
    throw new ZkqProtocolError("VERIFIER_NOT_CONFIGURED", "no Groth16 verifier configured; every proof in the archive is unverified");
  }
}

export const PENDING_VERIFIER_REASON = "groth16-verifier-pending" as const;
