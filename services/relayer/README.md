# `@zk-quorum/relayer`

Demo relayer for ZK-Quorum. Accepts cast/reveal payloads, performs
**off-chain** pre-verification (mock today, `snarkjs` once R0/R1 VKs land),
simulates the transaction (mock today, Soroban Env once the contract ships),
and submits through a **common** submitter account so the voter account never
identifies the ballot on the ledger (plan §8).

## Hard constraints (plan §8, §17)

- Never stores secrets. Never persists IP, user-agent, or payload bodies in
  the demo mode. Logging is redacted by `src/services/logRedaction.ts`.
- `cast` and `reveal` do **not** authenticate the voter. The submitter account
  is a shared relayer account; production deployments must rotate the
  submitter per deployment.
- The off-chain verifier, simulator, and submitter are all **injectable
  adapters** in `src/adapters/`. The relayer boots with mocks; the production
  wiring lives behind the `Groth16SnarkjsVerifier` and `StellarSubmitter`
  classes that reject with `ADAPTER_NOT_CONFIGURED` until the artefacts are
  integrated.

## Routes

- `GET /health` — config snapshot, used by load balancers and CI.
- `POST /submit` — JSON body. Either `{ action: "cast", ... }` (default) or
  `{ action: "reveal", ... }`. The body is bounded by `bodyLimitBytes` and
  each `idempotencyKey` is rate-limited per minute.

## Scripts

```bash
npm ci
npm test         # vitest
npm run build    # tsc --noEmit
npm start        # listens on $ZKQ_RELAYER_PORT (default 8787)
```

## Env

| name | default | purpose |
|---|---|---|
| `ZKQ_RELAYER_PORT` | `8787` | HTTP port |
| `ZKQ_RELAYER_HOST` | `127.0.0.1` | bind host |
| `ZKQ_RELAYER_BODY_LIMIT` | `65536` | max body bytes |
| `ZKQ_RELAYER_RATE_PER_MINUTE` | `60` | per idempotencyKey |
| `ZKQ_RELAYER_RATE_WINDOW_MS` | `60000` | rate window |
| `ZKQ_RELAYER_QUEUE_CONCURRENCY` | `1` | per-submitter sequencing |
| `ZKQ_RELAYER_IDEMPOTENCY_TTL_MS` | `600000` | replay window |
| `ZKQ_RELAYER_LOG` | `1` | `0` to silence |
| `ZKQ_RELAYER_SUBMITTER` | `null` | submitter public key |
| `ZKQ_RELAYER_NETWORK_PASSPHRASE` | testnet default | scope derivation |

## Integration TODOs

See `RELAYER_INTEGRATION.md` for the exact seams the `wt/crypto` and
`wt/contract` lanes must fill before the relayer can be exercised against
testnet.
