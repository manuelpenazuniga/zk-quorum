/**
 * Worker boundary: this is the ONLY file that may speak to the
 * snarkjs/circuits context. The main thread posts a job, the worker
 * computes the witness/proof, and posts back hashes. Secrets
 * (nullifierSecret, trapdoor, salt) NEVER leave this context.
 */
import type { ProofEnvelope, Sha256Hex } from "@zk-quorum/protocol";

export type ProvingRequest =
  | {
      readonly kind: "prove-r0";
      readonly electionId: `0x${string}`;
      readonly publicSchemaId: "PUBLIC_SCHEMA_V1_R0";
      readonly publicSignals: ReadonlyArray<string>;
      readonly inputs: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "prove-r1";
      readonly electionId: `0x${string}`;
      readonly publicSchemaId: "PUBLIC_SCHEMA_V1_R1";
      readonly publicSignals: ReadonlyArray<string>;
      readonly inputs: Readonly<Record<string, unknown>>;
    };

export type ProvingProgress = { readonly stage: "witness" | "prove" | "done"; readonly fraction: number };

export type ProvingResponse =
  | { readonly ok: true; readonly envelope: ProofEnvelope; readonly publicSignalsHash: Sha256Hex; readonly proofHash: Sha256Hex }
  | { readonly ok: false; readonly reason: string };

export interface ProvingAdapter {
  prove(req: ProvingRequest, onProgress: (p: ProvingProgress) => void): Promise<ProvingResponse>;
  cancel(): void;
}

export class MockProvingAdapter implements ProvingAdapter {
  private cancelled = false;
  public async prove(_req: ProvingRequest, onProgress: (p: ProvingProgress) => void): Promise<ProvingResponse> {
    onProgress({ stage: "witness", fraction: 0.2 });
    await new Promise((r) => setTimeout(r, 5));
    if (this.cancelled) return { ok: false, reason: "cancelled" };
    onProgress({ stage: "prove", fraction: 0.6 });
    await new Promise((r) => setTimeout(r, 5));
    onProgress({ stage: "done", fraction: 1.0 });
    return {
      ok: true,
      envelope: {
        electionId: _req.electionId,
        publicSchemaId: _req.publicSchemaId,
        publicSignals: [..._req.publicSignals],
        proofBytes: ("0x" + "ab".repeat(64)) as `0x${string}`,
      },
      publicSignalsHash: ("0x" + "11".repeat(32)) as Sha256Hex,
      proofHash: ("0x" + "22".repeat(32)) as Sha256Hex,
    };
  }
  public cancel(): void {
    this.cancelled = true;
  }
}

export const PENDING_PROVING_REASON = "groth16-prover-pending" as const;
