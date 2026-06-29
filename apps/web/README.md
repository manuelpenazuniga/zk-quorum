# `@zk-quorum/web`

Three Vite SPAs, one build:

- `voter.html` — ballot casting UI. Worker-boundary proving.
- `admin.html` — election opening form (operator-signed).
- `audit.html` — local bundle viewer.

No real proving artefacts ship with this scaffold. The `MockProvingAdapter`
inside the worker produces a synthetic envelope; the real Groth16 wiring is a
single import in `src/worker/proverWorker.ts` once `wt/crypto` lands.

## Hard rules

- Secrets (nullifierSecret, trapdoor, salt, R1 salt) **never** leave the
  Web Worker context. The main thread only sees `ProofEnvelope` and the
  SHA-256 of `proofBytes` and `publicSignals`.
- No `stellar-sdk` secret-key calls in this package. The admin and voter
  apps talk to the relayer over HTTP; the operator wallet extension is
  responsible for the actual signing (out of scope here).
- No analytics, no telemetry. The CSP-friendly HTML is intentionally
  minimal; production deployment should add a strict CSP.

## Scripts

```bash
npm ci
npm test         # vitest (jsdom)
npm run build    # tsc --noEmit + vite build
npm run dev      # vite dev server on :8788
```

## Integration TODOs

See `WEB_INTEGRATION.md` for the exact seams.
