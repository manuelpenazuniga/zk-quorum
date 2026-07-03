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

## Estado actualizado 2026-07-03

- `main` contiene plan, foundation, C0/C1, producto U0-code, E0 y T0 prepare.
- Toolchain fijado: Node 24, Rust/Cargo 1.96, Circom 2.2.3, snarkjs 0.7.6, Stellar CLI 27
  y target `wasm32v1-none`.
- Producto U0-code fue auditado e integrado. U-Pre Chromium cerró con prover real,
  invalid witness, cancelación y recuperación; audit final sin findings.
- C1 `3dd2304` fue auditado por Gemini 3.1 Pro High sin findings e integrado como
  `7a681f0` + `6daf7a5`. En `main` pasan 78/78, clippy y WASM.
- C0 fue remediado, auditado e integrado. El repositorio y release `c0-setup-v1` son públicos;
  un clon anónimo descargó los assets por las URLs default y pasó el gate completo.
- E0 R0 fue auditado por Gemini 3.1 Pro High e integrado. En `main` pasan el runner E2E real,
  replay 25/25 y 16 corrupciones negativas; 0 Critical/High.
- T0 prepare está aprobado e integrado (commits d9ffda7 y 05f98d8).
  T0 execute/testnet está pendiente.
- Testnet (ejecución), carga, A0 y evidencia final siguen pendientes.
- `spike/package.json`, su lockfile y otros untracked ajenos deben preservarse.

## Siguiente gate

Continuar secuencialmente con worktrees existentes y routing vigente:

1. ejecutar T0 execute/testnet;
2. cerrar R1;
3. ejecutar carga, A0 y submission.

Detalles y acceptance tests:
`docs/plan/OPEN-CODE-EXECUTION-LOG.md`.
