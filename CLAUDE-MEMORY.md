# Claude Memory — ZK-Quorum

> Resumen persistente. La autoridad técnica y de ejecución está en
> `docs/plan/ZK-QUORUM-EXECUTION-PLAN.md`.

## Preferencias del usuario

- Comunica en español.
- Prioriza valor agregado / complejidad operacional.
- Quiere planificación rigurosa antes de implementar.
- Autoriza enviar este repositorio público a los modelos OpenCode indicados.
- Prefiere distribución costo-beneficio:
  MiniMax M3 para volumen, DeepSeek V4 Pro para ZK/Rust y Qwen 3.7 Max /
  GLM-5.2 solo para auditoría.

## Proyecto y plazo

ZK-Quorum es una urna institucional sobre Stellar/Soroban con elegibilidad,
unicidad por elección, privacidad de credencial e integridad/auditoría.

El usuario corrigió el deadline a **2026-07-02**. Freeze interno:
**2026-07-01 20:00 America/Santiago**. La hora exacta del deadline externo está
pendiente de registrar.

## Rulings vigentes

- Groth16/BLS12-381; no BN254.
- Base de referencia: `privacy-pools` en
  `stellar/soroban-examples@7b168174ae1268dab91a0190d80a94ab7ff41b59`.
- `poseidon255.circom` y `soroban-poseidon = "=25.0.0"` requieren golden
  vectors antes de usarse en R1.
- No Poseidon directo de tres inputs: usar `P2(P2(a,b),c)`.
- No Semaphore: el upstream no contiene `externalNullifier` ni ballot signal.
- Nullifier:
  `Poseidon255(nullifierSecret, electionScope)`.
- `electionScope` está domain-separated por red, contrato, election ID y
  versión mediante SHA-256 + rejection sampling al scalar field.
- `stateRoot` registra credential commitments.
- `associationRoot` registra labels elegibles y no admite el bypass cero.
- R0: voto público, identidad oculta.
- R1: commit/reveal con circuito separado; non-reveals reportados.
- Sin recursión, MACI ni agregación en el build.

## Privacidad de transacción

El proof no basta si la cuenta fuente identifica al votante. `cast` y `reveal`
no requieren auth del votante. La demo usa un relayer común con pre-verificación
off-chain, simulación, secuenciado de nonces y logging redactado.

## Contrato

- VK R0/R1 fijadas por constructor; nunca suministradas por el caller.
- Public signal schema versionado y congelado desde fixtures.
- Nullifier por persistent key `(election_id, nullifier_hash)`.
- Tally en 16 buckets para reducir write contention.
- Proofs fuera de storage; eventos contienen hashes de proof/public bytes.
- Auditoría histórica usa archivo content-addressed, no solo retención RPC.
- TTL expresado en ledgers y acotado por política/red.

## Estado confirmado 2026-06-29

- Repo `main`, 2 commits; no hay código del producto versionado.
- `spike/package.json` y lockfile están untracked.
- `privacy-pools`: 9/9 tests.
- `groth16_verifier`: 1/1 test.
- Rust/Cargo 1.96, Circom 2.2.3, target `wasm32v1-none`.
- Node efectivo 22.23.1; la versión final aún debe fijarse.
- Stellar CLI ausente.
- No hay ptau/zkey/VK/proof reproducibles en el repo.
- Verifier histórico:
  `CACFO5YAVIUZYINQTFDVHE5GBLYJ7ALQERA7AXB235KMWBIPHRRKZ57M`.

## Siguiente gate

Cerrar P1 del plan maestro:

1. incorporar auditorías Qwen/GLM;
2. neutralizar docs legacy;
3. verificar `git diff --check`;
4. identificar/committear el plan antes de lanzar agentes de implementación;
5. comenzar F0 solo con cero Critical/High abiertos.
