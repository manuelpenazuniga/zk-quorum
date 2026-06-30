import type { ProofEnvelope, Sha256Hex } from "@zk-quorum/protocol";
import type { ProofVerification, VerifierAdapter } from "../../src/adapters/verifierAdapter.js";

/**
 * Test-only fake verifier. Accepts every proof and returns the supplied
 * hashes, so the bundle hash-matching logic can be exercised without a
 * real Groth16 verifier. This adapter lives ONLY in tests and is never
 * reachable from the production CLI.
 */
export class StaticAcceptVerifierAdapter implements VerifierAdapter {
  public readonly id = "static-accept";
  constructor(private readonly hashes: { proofHash: Sha256Hex; publicSignalsHash: Sha256Hex }) {}
  public async verify(_envelope: ProofEnvelope): Promise<ProofVerification> {
    return { ok: true, proofHash: this.hashes.proofHash, publicSignalsHash: this.hashes.publicSignalsHash };
  }
}
