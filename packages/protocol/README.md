# `@zk-quorum/protocol`

Versioned types, schema definitions, and pure-function helpers shared by every
lane of ZK-Quorum that operates outside the on-chain contract. This package has
**no runtime dependencies**; it is consumed by `services/relayer`,
`tools/auditor`, `apps/web`, and `scripts/evidence`.

## What lives here

- Versioned public signal schemas for R0 and R1 (see plan §5.2 / §6.2 / §6.3).
- Domain types for elections, events, tallies, IDs, and proof envelopes.
- `deriveElectionScope` with SHA-256 domain-separation and rejection sampling
  (plan §5.1).
- `bucketForNullifier` and immutable tally state for shard reconstruction
  (plan §7.4).
- `ZkqProtocolError` — typed error codes shared across all lanes.

## Hard prohibitions

- No on-chain calls. No `stellar-sdk` dependency. No HTTP.
- No `snarkjs` dependency. Circuits and proving are the `wt/crypto` lane.
- No hard-coded schema ordering inside lane code; lanes read the schema from
  here or from a manifest produced by `wt/crypto`.

## Scripts

```bash
npm ci
npm test
npm run build       # type-check only; this package emits no JS
```
