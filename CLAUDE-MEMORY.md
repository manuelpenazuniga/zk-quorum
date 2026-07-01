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
- Kimi K2.7 Code debe permanecer casi en cero: deshabilitado por defecto y
  sólo utilizable con autorización explícita del usuario para una emergencia
  concreta.
- Gemini 3.1 Pro High es el auditor primario. Qwen 3.7 Plus puede usarse como
  fallback read-only; Qwen 3.7 Max no se usa.
- Codex planifica, escribe briefs, audita gates y no escribe código de
  producción.
- Todo agente usa `docs/internal/agent-context-protocol.md`: salida menor a 800
  tokens, logs completos fuera del chat, un auditor por commit y checkpoint
  después de cada gate.
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

## Estado actualizado 2026-07-01

- `main` termina en `87f7817`; contiene plan, foundation y producto U0.
- Toolchain fijado: Node 24, Rust/Cargo 1.96, Circom 2.2.3, snarkjs 0.7.6,
  Stellar CLI 27 y target `wasm32v1-none`.
- Producto U0 fue auditado por Gemini 3.1 Pro High e integrado; 236 tests
  pasan. U-Pre con prover real en navegador sigue pendiente.
- `agent/contract` termina limpio en `3dd2304`; 78 tests, clippy estricto,
  WASM y verifier-first pasan. Falta auditoría vigente e integración.
- `agent/crypto` termina en `0a71316`; C0 fue rechazado con 1 Critical, 3 High,
  1 Medium y 1 Low. Los ptau/zkey autoritativos deben publicarse como assets
  inmutables con URL y SHA-256. La autenticación GitHub observada era inválida.
- E0, testnet, carga, A0 y evidencia final siguen pendientes.
- `spike/package.json`, su lockfile y otros untracked ajenos deben preservarse.

## Siguiente gate

Continuar secuencialmente con worktrees existentes y routing vigente:

1. Gemini 3.1 Pro High audita el delta C1 `e3fafab..3dd2304`;
2. remediar findings o integrar C1 si queda sin Critical/High;
3. restablecer publicación de assets C0 y remediar `0a71316`;
4. integrar C0 y ejecutar E0 local;
5. cerrar U-Pre, testnet, R1, carga, A0 y submission.

Detalles y acceptance tests:
`docs/plan/OPEN-CODE-EXECUTION-LOG.md`.
