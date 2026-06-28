# ZK-Quorum — CLAUDE.md

> Brief operativo (se auto-carga al iniciar sesión). Detalle técnico **autoritativo** en `techs-specs-zk-quorum.md`; visión en `zk-quorum.md`; estado del spike en `spike/SPIKE-RESULTS.md`. Lee esos antes de construir.

## Qué es
Urna secreta institucional (sindicatos/empresas/municipios): **ID verificada, voto anónimo, escala sin caerse, auditable para siempre**. Cuatro propiedades a la vez: elegibilidad (membership), unicidad (nullifier), secreto del voto, integridad del conteo.
Frase ganadora: *"500 personas votan, no se cae, y al cerrar cualquiera re-audita que nadie votó dos veces y que el conteo cuadra — sin saber jamás quién votó qué."*

## Hackathon
"Stellar Hacks: Real-World ZK" (DoraHacks). ZK **load-bearing** + verificado en Soroban. Deadline **2026-06-29 12:00 PST**.

## Stack VALIDADO post-spike — NO cambiar a ciegas (ver `spike/SPIKE-RESULTS.md`)
- **Curva BLS12-381** (NO BN254/bn128). · **Base = fork de `privacy-pools`** (su `main.circom` Withdraw = membership + nullifier + **ASP** es el molde) — NO Semaphore. · **Poseidon `poseidon255`↔`soroban-poseidon`** (par consistente; NO circomlib, NO host nativa). · Verificador `groth16_verifier` vía `contractimport!` · `cli/circom2soroban` · snarkjs `--curve bls12381` · circom 2.2.x · soroban-sdk 25.1.0 · stellar CLI 27 · `wasm32v1-none` · testnet. · SaaS/pago: SEP-41 (USDC).

## Escalabilidad CORREGIDA (lo más importante del proyecto)
**NO** "O(1) vía recursión/agregación" (no es camino probado en Stellar). **SÍ paralelismo + throughput:** cada voto = una prueba verificada on-chain (barata, BLS12-381) y Stellar absorbe el volumen → **O(n) barato, no O(1)**. Recursión/MACI = **roadmap, NUNCA en el build**.

## Escalera de rungs (secreto del voto)
Rung 0 anónimo-público (**MVP garantizado**) → Rung 1 commit-reveal (secreto real, solo un hash) → Rung 2 ElGamal homomórfico → Rung 3 MACI/recursión (roadmap). **Ship Rung 0**; sube a Rung 1 si hay tiempo.

## Mapeo al patrón (de privacy-pools)
`stateRoot` = padrón · `nullifierHash` = unicidad por elección (`externalNullifier`=election_id) · `signal` = voto (R0) / `hash(voto,salt)` (R1) · `associationRoot` = ASP padrón elegible. `cast` verifica por-voto + dedup nullifier + ++contador; auditoría = re-ejecutar el conteo.

## Rulings de de-risking
- Poseidon **in-circuit**; el contrato trata hashes como **opacos** (nunca recomputa nativa). Showcase = BLS12-381 + ASP (privacidad cumplidora, criterio SDF).
- **NO** recursión/MACI/batch-verify custom en el build (roadmap). **NO** BN254.

## Estado actual
Spike 🟢: privacy-pools **9/9 tests** (incl. nullifier-reuse + ASP); verificador en testnet `CACFO5YAVIUZYINQTFDVHE5GBLYJ7ALQERA7AXB235KMWBIPHRRKZ57M`; prueba BLS12-381 fresca OK.
**Tarea 1 del build** = `stellar contract invoke` real en testnet (serializar structs G1/G2, copiar de `groth16_verifier/src/test.rs`) + adaptar `main.circom` (signal=voto, externalNullifier=election_id) + contrato `open_election`/`cast`/`result`/`audit`.

## Operación (WSL)
- Recuperar el entorno del spike sin copiar artefactos (lo que crashea WSL): `cd spike && ./bootstrap.sh`. Smoke test: `cd soroban-examples/privacy-pools/contract && cargo test --release`.
- Repo en filesystem **Linux**, **nunca `/mnt/c/`**. Nunca versiones/copies `target/`, `node_modules/`, `soroban-examples/` (ya en `.gitignore`).
