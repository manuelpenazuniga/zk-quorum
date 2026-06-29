# Web integration — exact TODOs for `wt/crypto` and `wt/contract`

The web scaffold renders the three apps and ships adapters that
return `ADAPTER_NOT_CONFIGURED` for everything that requires real ZK or
real chain wiring.

## 1. Real proving in the worker

`apps/web/src/worker/proverWorker.ts` is the only file that should
ever instantiate the snarkjs context. Replace the `MockProvingAdapter`
with the real one:

```ts
import { groth16 } from "snarkjs";
import { readFile } from "node:fs/promises"; // works in workers via import.meta.url
import circuitR0 from "../../../.bootstrap/circuits/r0/circuit.wasm";
import pkR0 from "../../../.bootstrap/circuits/r0/proving_key.zkey";

self.addEventListener("message", async (ev) => {
  if (ev.data.kind !== "prove-r0" && ev.data.kind !== "prove-r1") return;
  const { proof, publicSignals } = await groth16.fullProve(
    ev.data.inputs,
    ev.data.kind === "prove-r0" ? circuitR0 : circuitR1,
    ev.data.kind === "prove-r0" ? pkR0 : pkR1,
  );
  self.postMessage({ type: "result", payload: { ok: true, envelope: …, …hashEnvelope(envelope) } });
});
```

`snarkjs@0.7.6` ships as ESM and bundles inside the worker chunk. The
size budget must be measured on the target browsers (Gate U-Pre).

## 2. Real relayer endpoint

`src/shared/config.ts` reads `import.meta.env.VITE_ZKQ_RELAYER`. The
default is `http://127.0.0.1:8787`. Production deployment should
override this at build time.

The `HttpRelayAdapter` already sends exactly the JSON shape the relayer
expects (see `services/relayer/README.md`). The `clientTag` field is the
only free-form string; the relayer redacts everything else.

## 3. Operator wallet for admin

`src/admin/main.ts` validates the form locally. The `openElection` call
must be signed by the admin account; the scaffold has no signing path.
Production wiring is a Freighter/Albedo integration that calls the
`@stellar/stellar-sdk@16.0.1` `Server.submitTransaction` against
`soroban-testnet.stellar.org` with the `open_election` invocation built
from the form state.

## 4. Bundle upload for audit

`src/audit/main.ts` parses a bundle schema, checks `AUDIT_BUNDLE_V1`,
and renders a tiny summary. The full `zkq-auditor replay` is a separate
CLI step in CI; the page is intentionally read-only.

## 5. CORS / CSP

Vite dev server runs on `:8788` and the relayer on `:8787`. The dev
server already proxies `/relayer/*` to the relayer if `VITE_ZKQ_PROXY=1`.
Production deployment must set a strict CSP that allows the relayer
origin and forbids inline scripts.
