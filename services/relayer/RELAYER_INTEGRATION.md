# Relayer integration — exact TODOs for `wt/crypto` and `wt/contract`

This file lists the precise seams that must be wired before the relayer
becomes a real submitter against Stellar testnet. The relayer is fully typed
and tested with mock adapters, but the production entry point refuses to start
while any unconfigured adapter is in scope; the production wiring is a single
factory replacement once the artefacts land.

## 1. Off-chain verifier (depends on `wt/crypto` artefacts)

```ts
// services/relayer/src/adapters/snarkjsAdapter.ts
import { groth16 } from "snarkjs"; // already pinned in protocol/crypto cache
import vkR0 from "../../../.bootstrap/circuits/r0/verification_key.json" with { type: "json" };
import vkR1 from "../../../.bootstrap/circuits/r1/verification_key.json" with { type: "json" };

export class Groth16SnarkjsVerifier implements OffchainVerifier {
  async verifyProof(env: ProofEnvelope): Promise<VerifierResult> {
    const vk = env.publicSchemaId === "PUBLIC_SCHEMA_V1_R0" ? vkR0 : vkR1;
    const ok = await groth16.verify(vk, env.publicSignals, JSON.parse(toJsonProof(env.proofBytes)));
    return ok ? { ok: true, ...hashEnvelope(env) } : { ok: false, reason: "snarkjs verify returned false" };
  }
}
```

Once the `wt/crypto` lane ships the R0/R1 VKs, this class flips from
`ADAPTER_NOT_CONFIGURED` to real verification. No other relayer code changes.

## 2. Soroban simulator + submitter (depends on `wt/contract`)

The `SorobanSimulator` and `StellarSubmitter` skeletons are present. Real
wiring must:

- Read the contract id from `ZKQ_RELAYER_CONTRACT_ID` (env, not hard-coded).
- Use `Server` from the pinned `@stellar/stellar-sdk@16.0.1` to call
  `simulateTransaction` against `https://soroban-testnet.stellar.org`.
- Sign with the relayer keypair from `ZKQ_RELAYER_SECRET_KEY` (env, never
  committed, never logged).
- Submit through `submitTransaction`, then poll the hash until either
  `CONFIRMED` or timeout. The relayer's per-account queue guarantees a
  monotonic `sequenceNumber`.

## 3. Verifier hash wiring

`hashEnvelope` in `src/adapters/mockAdapters.ts` is currently a non-crypto
placeholder. The auditor (and the contract event) expect a real SHA-256
over:

- the canonical serialised proof bytes;
- the canonical serialised publicSignals array.

The real implementation is a one-liner: `createHash("sha256").update(buf).digest("hex")`.
Must be done before any production wiring so hashes in events match hashes
in the audit bundle.

## 4. Public index references

Until the contract is deployed and the manifest is published by the
`wt/contract` lane, the relayer **does not invent** any contract id,
network id, or public index. The `defaultElectionId` is a placeholder
field; the request body supplies the real `electionId` and the relayer
validates that the election is open against the in-memory election cache
that the operator must hydrate from RPC before serving traffic.

## 5. L0 load harness

The load harness is a separate node script (will live in
`scripts/load/`) that issues N concurrent POSTs with distinct
`idempotencyKey`s. It depends on:

- L-Pre: preflight with 10 sequential submits to discover rate limits.
- T0: deployed contract id from the `wt/contract` lane.

Until both are in place, the harness is intentionally a no-op shell.

## 6. Submitter sequence management

`createPerAccountRelayQueue({ concurrency: 1 })` already serialises
per-account submits. The relayer must use the **same** key for every submit
in a single load run, which is what the queue assumes today. Splitting into
multiple submitter accounts requires separate queue lanes; that change is
intentionally a follow-up, not part of this scaffold.
