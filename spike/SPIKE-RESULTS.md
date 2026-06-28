# SPIKE-RESULTS — riesgo letal de VeritasVoice + ZK-Quorum-Rung0

**Fecha:** 2026-06-26 · **Objetivo del spike:** probar que el path "prueba ZK (membership + nullifier) generada con tooling Circom → verificada en un contrato Soroban on-chain" funciona HOY, y medir/clavar las incógnitas que podrían forzar un rewrite.

## Veredicto: 🟢 FULL GREEN — riesgo letal eliminado

| Check | Resultado |
|---|---|
| Toolchain (rust 1.96 + wasm32v1-none, node 24, stellar CLI 27, ark libs) | ✅ |
| BLS12-381 Groth16 verify dentro de un contrato Soroban (`groth16_verifier` test) | ✅ `test::test ... ok` |
| **Patrón membership + nullifier + ASP verifica on-chain** (privacy-pools, 9 tests) | ✅ 9/9 pass |
| Rechazo de doble-uso de nullifier (anti-doble-voto/spam) | ✅ `test_reuse_nullifier` |
| ASP / association-set enforced | ✅ `test_withdraw_association_root_mismatch` |
| Pruebas inválidas rechazadas | ✅ `test_deposit_and_withdraw_wrong_proof` |
| Build a WASM (`stellar contract build`) | ✅ 4486 bytes, exporta `verify_proof` |
| **Deploy real a testnet + fondeo friendbot** | ✅ ver IDs abajo |

**Artefactos en testnet:**
- Cuenta: `GAXCBZQNRJIU2NRWQJPFVO7IZ3Y46S6Q4BWCWC6LQSO7QDZOYKLY4FQC`
- Verificador desplegado: `CACFO5YAVIUZYINQTFDVHE5GBLYJ7ALQERA7AXB235KMWBIPHRRKZ57M`
- TX deploy: `c3cf4ded47992ec0b98aec674dbfb06bd24b7021149267d19af5bc8140b13507`

---

## 🔑 Hallazgo que CORRIGE el stack de los docs (evita un rewrite)

Los docs (deep-dives + tech-specs) asumían **BN254 + Semaphore (bn128) + circomlib Poseidon + showcase Poseidon/BN254 nativo**. La realidad empírica del código que **sí funciona y está shipped** en Stellar es otra:

1. **La curva del path Circom→Groth16→Soroban probado es BLS12-381, NO BN254.**
   - `groth16_verifier` (soroban-examples) usa `env.crypto().bls12_381().pairing_check`; su vk dice `"curve": "bls12381"` (fue demo de dic-2024 de las features BLS12-381).
   - `privacy-pools` (Nethermind): *"Groth16 zkSNARKs with **BLS12-381 curve**"*; su `cli/circom2soroban` y `libs/zk` importan `bls12_381`.
   - Las host functions **BN254 (P25/P26) existen y están vivas**, pero **no hay un verificador Groth16 de Circom + serializador shipped para BN254**. El path con tooling completo (serialización resuelta) es **BLS12-381**. Forkear Semaphore (que es bn128) habría chocado pared.

2. **La base de VeritasVoice/Quorum NO es Semaphore — es un fork de `privacy-pools`.**
   - Trae justo nuestro patrón: `commitment.circom` (`commitment = Poseidon(value,label,Poseidon(nullifier,secret))`, `nullifierHash = Poseidon(nullifier)`), `merkleProof.circom` (membership) y, en `main.circom`, **membership en `stateRoot` + membership en `associationRoot` (ASP) + `nullifierHash` de salida**.
   - Resuelve la serialización (`cli/circom2soroban`), trae el verificador (`libs/zk` + el contrato `groth16_verifier` importado vía `contractimport!`), y un Merkle incremental (`libs/lean-imt`).

3. **Poseidon: confirmado el ruling, pero el par concreto es `poseidon255` (circom) ↔ `soroban-poseidon` (Rust), NO circomlib ni host nativa.**
   - El README de privacy-pools lo dice literal: implementaron su propia Poseidon *"to have a hash that is consistent between the Circom circuit and Rust code"*, y la **host function Poseidon nativa (CAP-75) aún no la usan** (la mencionan como mejora futura para árboles más profundos).
   - Existe el crate `soroban-poseidon = "25.0.0"` (lado Rust) que casa con `poseidon255.circom` (lado circuito). Ese es el par consistente a usar.

4. **El "showcase de tech nueva" se reancla, honesto:** verificación ZK on-chain (BLS12-381 host functions) + **ASP / privacidad cumplidora** (criterio SDF) + `soroban-poseidon`. BN254/MSM = **stretch opcional** (no hay referencia shipped → no apostar el MVP). El hackathon premia "ZK load-bearing sobre Stellar", no exige BN254.

---

## Stack de build corregido (de-riskeado, para VeritasVoice y Quorum-Rung0)

```
Curva:        BLS12-381  (snarkjs --curve bls12381)
Circuitos:    fork de privacy-pools/circuits  (commitment + merkleProof + poseidon255)
Poseidon:     poseidon255 (circom)  ↔  soroban-poseidon 25.0.0 (Rust)   [par consistente]
Verificador:  groth16_verifier (BLS12-381), importado vía contractimport! (como privacy-pools)
Serialización: cli/circom2soroban  (vk/proof/public → formato Soroban)
Merkle:       libs/lean-imt (incremental)
SDK:          soroban-sdk 25.1.0  ·  stellar CLI 27  ·  target wasm32v1-none
Red:          testnet (deploy ya validado)
```

**Mapeo a nuestros proyectos** (el circuito `Withdraw` de privacy-pools es el molde):
- **VeritasVoice:** `stateRoot` = roster del grupo; `nullifierHash` = unicidad por tópico (`label`=topic); el `signal`/`content_hash` se añade como public input; `associationRoot` = ASP "miembros en regla". Recompensa USDC vía SEP-41 (como el `withdraw` mueve token).
- **Quorum-Rung0:** `stateRoot` = padrón; `nullifierHash` = unicidad por elección (`label`/externalNullifier = election_id); el voto = public signal; `associationRoot` = ASP padrón elegible. `cast` verifica por-voto (paralelo), contadores on-chain, auditoría re-ejecutable.

---

## Actualización — cierre del spike (lado cliente validado)

Tras instalar el tooling (circom **2.2.3**, snarkjs) se cerró el lado cliente:

| Check | Resultado |
|---|---|
| circom 2.2.3 + snarkjs instalados (soportan `--prime/--curve bls12381`) | ✅ |
| **Generar prueba FRESCA con nuestro snarkjs** (Groth16, bls12381) | ✅ `proof_fresh.json` |
| **Verificar la prueba fresca off-chain** (`snarkjs groth16 verify`) | ✅ `[INFO] snarkJS: OK!` (public = `33`) |
| Serializar vk/proof/public con `stellar-circom2soroban` | ✅ emite los let-bindings Rust; `public_0 = 0x21 = 33` (coincide) |

**Estado:** el ciclo completo está validado por partes — **cliente** (circom→snarkjs→prueba BLS12-381 válida→`circom2soroban`) y **on-chain** (el contrato verifica con las host functions `bls12_381` reales en el Env de Soroban, que ejecuta el mismo WASM+host que testnet; + contrato desplegado en testnet). El **riesgo letal está muerto**.

**Lo único pendiente (plomería, NO riesgo):** el `stellar contract invoke` literal en testnet. `verify_proof(vk, proof, pub_signals)` toma structs (`VerificationKey`/`Proof` con `G1Affine`/`G2Affine`); `circom2soroban` da las coords en decimal → hay que serializarlas al `BytesN` que esperan los args (la misma conversión que hace `groth16_verifier/src/test.rs`). Eso es la **Tarea 1 del build**, no una incógnita: el `test.rs` ya tiene esa conversión funcionando para copiar.

## Próximos pasos del build (el spike ya validó el camino)

1. **Generar una prueba propia** (no la fixture): instalar `circom` 2.2.x + `snarkjs`, compilar `commitment+merkleProof` (curva bls12381), trusted setup pequeño, generar proof, pasarla por `circom2soroban`, e **invocar `verify_proof` on-chain** en el contrato ya desplegado (`CACFO5…RKZ57M`). *(El test local ya ejecuta el WASM real + host crypto, así que esto es confirmación, no riesgo.)*
2. **Adaptar el circuito** al statement de VeritasVoice/Quorum (añadir el public signal del voto/contenido; ajustar el label al topic/election_id).
3. **Medir costo on-chain** de un `verify_proof` real (instrucciones) para confirmar holgura.

## Reproducir
```
spike/soroban-examples/groth16_verifier      → cargo test --release   (smoke BLS12-381)
                                             → stellar contract build  (wasm)
spike/soroban-examples/privacy-pools/contract → cargo test --release   (membership+nullifier+ASP, 9/9)
deploy: stellar contract deploy --wasm …groth16…wasm --source spike --network testnet
```
