# Auditor integration — exact TODOs for `wt/crypto`

The auditor scaffold is complete. It exercises the bundle schema, dedup,
tally reconstruction, and R1 commit/reveal integrity using a `NoopVerifier`
that flags every proof as "pending". Production wiring is the
`Groth16SnarkjsVerifier` adapter (one file, one import).

## 1. Real Groth16 verifier

```ts
// tools/auditor/src/adapters/verifierAdapter.ts (add)
import { groth16 } from "snarkjs";
import vkR0 from "../../../.bootstrap/circuits/r0/verification_key.json" with { type: "json" };
import vkR1 from "../../../.bootstrap/circuits/r1/verification_key.json" with { type: "json" };

export class Groth16SnarkjsVerifier implements VerifierAdapter {
  public readonly id = "groth16-snarkjs";
  constructor(private readonly vk: { r0: unknown; r1: unknown }) {}
  async verify(env: ProofEnvelope): Promise<ProofVerification> {
    const vk = env.publicSchemaId === "PUBLIC_SCHEMA_V1_R0" ? this.vk.r0 : this.vk.r1;
    const ok = await groth16.verify(vk, env.publicSignals, JSON.parse(toJsonProof(env.proofBytes)));
    return ok ? { ok: true, ...hashEnvelope(env) } : { ok: false, reason: "snarkjs verify returned false", ...hashEnvelope(env) };
  }
}
```

Replace `new NoopVerifierAdapter()` in `src/cli.ts` with the new adapter
once the R0/R1 VKs are produced by `wt/crypto`.

## 2. Proof archive

The `proofArchive` array is filled by the **relayer** (`wt/product`),
which already computes SHA-256 over the canonical serialised proof bytes
and public signals. The two hashes must match what `groth16.verify`
produces; that is the cross-check the auditor performs.

## 3. Bundle hash check

`hashBundle` in `src/commands/verifyBundle.ts` already produces a
deterministic SHA-256 over the canonicalised JSON. The CI check should
verify that the bundle's `manifestHash` matches this digest, which closes
the loop with the manifest produced by the `wt/crypto` lane.

## 4. WASM / VK / contract hashes

The bundle carries `wasmHash`, `vkR0Hash`, `vkR1Hash`, and `contractId`.
The auditor emits a finding whenever any of these is empty or malformed.
Production wiring must populate them from the deployment output of
`wt/contract` and the manifest of `wt/crypto`.

## 5. RPC event discovery (optional)

The scaffold does **not** talk to RPC. Production deployment is expected
to run a sidecar that fetches `VoteCastV1`/`VoteCommittedV1`/`VoteRevealedV1`
events from the ledger and writes them into the bundle before the auditor
runs. This sidecar is part of the `wt/contract` lane and is not in this
scaffold.
