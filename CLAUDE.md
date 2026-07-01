# ZK-Quorum — brief operativo

> Fuente autoritativa de arquitectura, ejecución, gates y routing multiagente:
> `docs/plan/ZK-QUORUM-EXECUTION-PLAN.md`.
>
> `techs-specs-zk-quorum.md` y `zk-quorum.md` conservan contexto histórico, pero
> contienen afirmaciones anteriores al audit del 2026-06-29. No deben guiar
> implementación cuando contradigan el plan maestro.

## Objetivo

Urna institucional sobre Stellar/Soroban:

- credencial emitida tras verificar identidad;
- proof ZK de registro y elegibilidad;
- un voto por credencial y elección;
- identidad/credencial oculta;
- tally y auditoría reproducibles.

## Deadline

El usuario corrigió el deadline a **2026-07-02**. La hora externa exacta debe
registrarse al comenzar la ejecución. Freeze interno:
**2026-07-01 20:00 America/Santiago**.

## Stack congelado

- Groth16 sobre BLS12-381.
- Circom 2.2.3 y snarkjs 0.7.6.
- `poseidon255.circom` con `soroban-poseidon = "=25.0.0"` solo después de
  golden vectors.
- `groth16_verifier` BLS12-381 vía `contractimport!`.
- `soroban-sdk = "=25.1.0"`, Rust 1.96, `wasm32v1-none`.
- Upstream de referencia fijado:
  `stellar/soroban-examples@7b168174ae1268dab91a0190d80a94ab7ff41b59`.
- No BN254, Semaphore, recursión, MACI ni batch verification custom.

## Statement corregido

El upstream **no** implementa `externalNullifier` ni un ballot signal.
ZK-Quorum escribe circuitos de ballot explícitos:

```text
credentialCommitment = P2(label, P2(nullifierSecret, trapdoor))
nullifierHash        = P2(nullifierSecret, electionScope)

R0: vote es público y se prueba vote < optionCount
R1: ballotCommitment = P2(P2(vote, salt), electionScope)
```

- `stateRoot`: registro de credential commitments.
- `associationRoot`: labels elegibles; no se permite zero bypass.
- `electionScope`: SHA-256 domain-separated con rejection sampling a Fr,
  ligado a red, contrato y election ID. La versión está en el domain tag
  `zk-quorum:election-scope:v1`; no existe un byte de versión adicional.
- No se usa Poseidon directo de tres inputs: upstream tiene evidencia
  contradictoria para esa aridad.

## Privacidad

`cast` y `reveal` no autentican una dirección de votante. La demo usa una cuenta
relayer común porque una cuenta Stellar conocida correlacionaría al votante con
su transacción. El issuer sigue siendo confiable para emitir una sola
credencial por identidad.

Rung 0 oculta identidad, no el valor del voto. Rung 1 añade secreto hasta
reveal, pero no coercion resistance y puede tener non-reveals.

## Estado real

- `main` contiene plan, foundation, producto U0 y contrato C1.
- Foundation reproducible: Node 24, Rust 1.96, Circom 2.2.3, snarkjs 0.7.6,
  Stellar CLI 27 y `wasm32v1-none`.
- Worktrees aislados: `agent/crypto`, `agent/contract` y `agent/product`.
- Producto U0 fue auditado por Gemini 3.1 Pro High e integrado con 236 tests.
  U-Pre con prover real en navegador sigue pendiente.
- C1 `3dd2304` fue auditado por Gemini 3.1 Pro High con cero findings e
  integrado como `7a681f0` + `6daf7a5`. El gate verifier-first pasa en `main`.
- Crypto termina en `0a71316`, pero Gemini 3.1 Pro High rechazó C0 con un
  Critical, tres High, un Medium y un Low. Falta distribución inmutable de
  ptau/zkey por URL + SHA-256 y remediar los otros findings.
- No hay E0, testnet, carga ni A0.
- `spike/package.json`, su lockfile y cualquier otro untracked ajeno deben
  preservarse y nunca entrar por accidente a commits de las lanes.

## Routing vigente

- Codex: planifica, escribe briefs, revisa evidencia y decide gates; no escribe
  código de producción.
- OpenCode Go: implementación con DeepSeek V4 Pro, MiniMax M3 y MiniMax M2.7.
- Kimi K2.7 Code está deshabilitado por defecto; sólo emergencia con
  autorización explícita del usuario por tarea.
- `agy`: Gemini 3.5 Flash Medium/High para trabajo ligero; Gemini 3.1 Pro High
  es el auditor primario. No usar Low.
- `opencode-go/qwen3.7-plus`: fallback de auditoría read-only. No usar Qwen
  3.7 Max.
- GPT-5.5 high por Codex CLI: auditoría premium C1/A0 y cualquier hito con
  fondos.
- Qwen 3.7 Max y GLM-5.2 están retirados por costo, no por calidad.

## Protocolo de contexto

Aplicar `docs/internal/agent-context-protocol.md`: commits estabilizados antes
de auditar, un auditor por commit, salida visible menor a 800 tokens, logs
completos fuera del chat, audits incrementales y audit integral en A0.

## Gate actual

P1/foundation/C1 están cerrados; C0 está bloqueado; U0 está integrado pero
U-Pre pendiente. No integrar con Critical/High, tests ignorados, mocks
aceptantes, scripts sin versionar o toolchain fuera de pin.
