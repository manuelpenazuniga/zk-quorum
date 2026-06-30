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
- `electionScope` está domain-separated por red, contrato y election ID
  mediante SHA-256 + rejection sampling al scalar field. La versión está en
  el domain tag `zk-quorum:election-scope:v1`, sin byte adicional.
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

## Estado recuperado 2026-06-30

- `main` termina en `53a7612`; contiene plan, foundation y ledger operativo.
- Toolchain fijado: Node 24, Rust/Cargo 1.96, Circom 2.2.3, snarkjs 0.7.6,
  Stellar CLI 27 y target `wasm32v1-none`.
- `agent/crypto` termina en `9b96da1`; Qwen encontró 0 Critical, 3 High.
  Los scripts witness siguen sin trackear y la remediación no comenzó.
- `agent/product` termina en `37c7ad4`; conserva una remediación M3 útil pero
  sin commit. Sus cinco paquetes habían llegado a 188 tests verdes antes de
  que el integrador detectara inconsistencias adicionales.
- `agent/contract` sigue en el commit base y conserva implementación sin
  commit. Qwen encontró 3 Critical y 5 High; no es integrable.
- Ninguna lane fue mergeada a `main`; setup, proofs reales, integración,
  testnet, carga y evidencia final siguen pendientes.
- OpenCode confirmó `5-hour usage limit reached` para M3 y DeepSeek el
  2026-06-29. Las tres sesiones frescas fallaron con 0 tokens y 0 cambios.
- `spike/package.json`, su lockfile y otros untracked ajenos deben preservarse.

## Siguiente gate

Relanzar después del reset de cuota, con sesiones frescas y worktrees
existentes:

1. DeepSeek V4 Pro cierra C0 en `agent/crypto`;
2. DeepSeek V4 Pro cierra C1 en `agent/contract`;
3. MiniMax M3 cierra U0 en `agent/product`;
4. Qwen 3.7 Max re-audita cada commit read-only;
5. el integrador repite los tests y sólo entonces hace cherry-pick.

Detalles y acceptance tests:
`docs/plan/OPEN-CODE-EXECUTION-LOG.md`.
