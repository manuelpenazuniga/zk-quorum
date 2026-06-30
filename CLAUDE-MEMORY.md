# Claude Memory — ZK-Quorum

> Resumen persistente. La autoridad técnica y de ejecución está en
> `docs/plan/ZK-QUORUM-EXECUTION-PLAN.md`.

## Preferencias del usuario

- Comunica en español.
- Prioriza valor agregado / complejidad operacional.
- Quiere planificación rigurosa antes de implementar.
- Autoriza enviar este repositorio público a los modelos OpenCode indicados.
- Prefiere distribución costo-beneficio:
  OpenCode Go sólo para implementación pesada; `agy` para trabajo ligero y
  auditoría; GPT-5.5 high para audit premium.
- Codex planifica, escribe briefs, audita gates y no escribe código de
  producción.
- Qwen 3.7 Max y GLM-5.2 fueron retirados el 2026-06-30 por costo, no por
  calidad.

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

## Estado recuperado y actualizado 2026-06-30

- `main` termina en `53a7612`; contiene plan, foundation y ledger operativo.
- Toolchain fijado: Node 24, Rust/Cargo 1.96, Circom 2.2.3, snarkjs 0.7.6,
  Stellar CLI 27 y target `wasm32v1-none`.
- `agent/crypto` termina en `3c0755e`; el orchestrator limpio pasa 14 witness,
  16 Rust, Python BigInt, clippy y wasm32v1-none. Queda re-audit vigente.
- `agent/product` termina en `37c7ad4`; conserva una remediación M3 útil pero
  sin commit. Sus cinco paquetes habían llegado a 188 tests verdes antes de
  que el integrador detectara inconsistencias adicionales.
- `agent/contract` sigue sin commit. Tiene verifier positivo y
  `contractimport!`, pero no es integrable hasta cerrar parsing Fr canónico,
  validación de roots/scope y arithmetic checked.
- Ninguna lane fue mergeada a `main`; setup, proofs reales, integración,
  testnet, carga y evidencia final siguen pendientes.
- OpenCode confirmó `5-hour usage limit reached` el 2026-06-29. Intentos
  posteriores con IDs `opencode/...` pertenecían al provider equivocado. El
  router vigente exige `opencode-go/...`.
- `spike/package.json`, su lockfile y otros untracked ajenos deben preservarse.

## Siguiente gate

Continuar con worktrees existentes y routing vigente:

1. Gemini 3.1 Pro High re-audita C0 `3c0755e`; GPT-5.5 high revisa sólo si
   aparece un hallazgo crítico o al cerrar A0;
2. DeepSeek V4 Pro o Kimi K2.7 Code por OpenCode Go cierra C1;
3. MiniMax M3 por OpenCode Go cierra U0; M2.7 sólo absorbe tests mecánicos;
4. `agy` High audita cada commit final read-only;
5. GPT-5.5 high audita C1/A0;
6. Codex repite evidencia, decide el gate y sólo entonces integra.

Detalles y acceptance tests:
`docs/plan/OPEN-CODE-EXECUTION-LOG.md`.
