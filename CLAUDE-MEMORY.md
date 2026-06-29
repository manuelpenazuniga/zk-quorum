# Claude Memory — ZK-Quorum

> Contexto persistente cargado por Claude en cada sesión. Fuente: `~/.claude/projects/.../memory/`. Exportado para versionarlo junto al repo.

---

## User background

User has training/experience in **blockchain**, some **ZK**, and domain expertise in **edtech**, **foodtech**, **biotech** — a competitive moat for ideation; lean into these over generic crypto-native ideas. Has **won national innovation prizes** (national innovation; food innovation ×2; social innovation) → he judges ideas by **value-add ÷ operational-complexity ratio**: wants high value, low operational complexity, everyday/applicable pains, no rocket science, and technologies that won't force a mid-build rewrite. Communicates in **Spanish**.

---

## Project — ZK-Quorum

**ZK-Quorum** for "Stellar Hacks: Real-World ZK" (DoraHacks, deadline **2026-06-29 12:00 PST**). Institutional secret ballot (unions/companies/municipalities): verified ID, anonymous vote, scales without collapsing, permanently auditable. Four properties at once: eligibility (membership), uniqueness (nullifier), ballot secrecy, tally integrity.

**SCALABILITY RULING (critical — was the main rewrite risk):** NOT "O(1) via recursion/aggregation" (not a proven path on Stellar). INSTEAD **embarrassingly parallel: each vote = one cheap on-chain Groth16 verify (BLS12-381) + Stellar throughput absorbs volume** → O(n) cheap, not O(1). Recursion/MACI = roadmap, never in the build.

**Ballot-secrecy rung ladder:**
- Rung 0 anonymous-public (**guaranteed MVP**)
- Rung 1 commit-reveal (real secrecy, just a hash)
- Rung 2 ElGamal homomorphic
- Rung 3 MACI/recursion (roadmap)

Ship Rung 0; upgrade to Rung 1 if time.

**Operational brief lives in `CLAUDE.md` (auto-loaded); build authority in `techs-specs-zk-quorum.md`; vision in `zk-quorum.md`; spike record in `spike/SPIKE-RESULTS.md`.** Read those before building.

**State:** spike GREEN — privacy-pools 9/9 tests (incl. nullifier-reuse rejection + ASP), verifier deployed to testnet `CACFO5YAVIUZYINQTFDVHE5GBLYJ7ALQERA7AXB235KMWBIPHRRKZ57M`, fresh BLS12-381 proof verified. **Build Task 1** = real testnet `contract invoke` (serialize G1/G2 struct args — copy from `groth16_verifier/src/test.rs`) + adapt `main.circom` (signal=vote, externalNullifier=election_id) + contract `open_election`/`cast`/`result`/`audit`. Regenerate the spike env with `spike/bootstrap.sh` — never copy build artifacts (crashes WSL); keep repo in Linux fs, never `/mnt/c`.

---

## Reference — Stellar ZK stack (verified 2026-06-26)

### Protocol versions
- **P25 "X-Ray"** live mainnet 2026-01-22 (CAP-0074 BN254 host fns; CAP-0075 Poseidon/Poseidon2 permutation primitives)
- **P26 "Yardstick"** live 2026-05-06 (BN254 MSM, scalar-field arithmetic, curve-membership)
- Passkeys/secp256r1 live since P21 (2024-06, CAP-0051) — mature

### Curve ruling — BLS12-381, NOT BN254
Despite the hackathon hyping BN254, the *shipped, working* Circom→Groth16→Soroban path is **BLS12-381**: both `stellar/soroban-examples/groth16_verifier` and the `privacy-pools` PoC verify over bls12381 (`env.crypto().bls12_381().pairing_check`; vk `"curve":"bls12381"`). BN254 host fns exist but there is **no shipped Circom Groth16 verifier+serializer for BN254** → do NOT fork Semaphore (it's bn128). Empirically validated: spike built + deployed to testnet; privacy-pools 9/9 tests pass.

### Base to fork = `privacy-pools`
In `soroban-examples` (from NethermindEth/stellar-private-payments). Gives exactly membership + nullifier + ASP: `commitment.circom` (identity + `nullifierHash`), `merkleProof.circom`, `main.circom` Withdraw = membership(stateRoot) + ASP(associationRoot). Reuse `cli/circom2soroban` (serialization), `libs/lean-imt` (Merkle), and `groth16_verifier` via `contractimport!`.

### Poseidon interop rule
`poseidon255.circom` ↔ `soroban-poseidon` crate (25.0.0) — a consistent circom↔Rust pair. NOT circomlib, NOT the native host fn.

**Why:** CAP-0075 exposes Poseidon's *permutation* with configurable params (t/d/rounds/constants/MDS) that don't match circomlib's → a hash done in-circuit won't equal one recomputed on-chain natively (silent mismatch, late rewrite).

**Rule:** all Poseidon in-circuit; the contract treats roots/nullifiers/commitments as OPAQUE field-element public inputs and never recomputes Poseidon. On-chain showcase = native BLS12-381 verify + ASP (compliant privacy, an SDF judging criterion); native Poseidon / BN254-MSM = optional stretch only.

### Toolchain
rust 1.96 + target `wasm32v1-none`, soroban-sdk 25.1.0, stellar CLI 27, node 24, circom 2.2.3, snarkjs (`--curve bls12381`).

Gotcha (not a blocker): serializing snarkjs vk/proof/public into the contract's G1/G2 byte layout — copy `groth16_verifier/src/test.rs`.

### Testnet
Verifier deployed at `CACFO5YAVIUZYINQTFDVHE5GBLYJ7ALQERA7AXB235KMWBIPHRRKZ57M`. Full spike record in `spike/SPIKE-RESULTS.md`.
