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
- Circom 2.2.3 y snarkjs 0.7.x.
- `poseidon255.circom` con `soroban-poseidon = "=25.0.0"` solo después de
  golden vectors.
- `groth16_verifier` BLS12-381 vía `contractimport!`.
- `soroban-sdk = "25.1.0"`, Rust 1.96, `wasm32v1-none`.
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
  ligado a red, contrato, election ID y versión.
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

- Upstream `privacy-pools`: 9/9 tests pasan.
- Upstream `groth16_verifier`: 1/1 test pasa.
- Verifier histórico en testnet:
  `CACFO5YAVIUZYINQTFDVHE5GBLYJ7ALQERA7AXB235KMWBIPHRRKZ57M`.
- No existe todavía código versionado del producto.
- No se preservaron ptau/zkey/proof/VK del spike.
- Stellar CLI no está instalado en el entorno actual.
- `spike/bootstrap.sh` todavía no es reproducible: no fija commit y descarga
  Linux AMD64 incluso cuando se ejecuta en macOS ARM.

## Routing OpenCode

- MiniMax M3: volumen, producto, scripts, CI, docs.
- DeepSeek V4 Pro: circuitos, Rust/Soroban y debug ZK.
- Qwen 3.7 Max: auditoría read-only de security/soundness.
- GLM-5.2: auditoría read-only de arquitectura/release.

Antes de implementar debe estar cerrado el Gate P1 del plan maestro:
remediación aplicada, legacy neutralizado y cero Critical/High abiertos.
