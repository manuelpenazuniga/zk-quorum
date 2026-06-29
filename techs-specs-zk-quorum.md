# Tech-Specs — ZK-Quorum (validación de ingeniería senior ZK/Stellar)

> **DOCUMENTO HISTÓRICO / SUPERADO PARA IMPLEMENTACIÓN (2026-06-29).**
> Conserva el razonamiento que llevó al spike, pero todavía mezcla
> Semaphore/BN254 con el stack post-spike y afirma que `externalNullifier` y
> `signal` ya existen. La arquitectura y el plan vigentes están en
> `docs/plan/ZK-QUORUM-EXECUTION-PLAN.md`.

**Rol:** Senior Blockchain Engineer (ZK + Stellar) · **Fecha:** 2026-06-26 · **Para:** de-riskear el build de 3 días
**Mandato:** ninguna tecnología en el camino crítico puede estar sin lanzar, incompleta o ser impracticable.

> ✅ **CORRECCIÓN POST-SPIKE (2026-06-26 — ver `spike/SPIKE-RESULTS.md`):** el spike (9/9 tests + deploy a testnet) probó que el path Circom→Groth16→Soroban **shipped es BLS12-381, NO BN254**, y que Rung 0 = **fork de `privacy-pools`** (su circuito `Withdraw` ya es membership+nullifier+**ASP**), no Semaphore. **Lee "Semaphore / BN254 nativo / circomlib Poseidon" de abajo como → BLS12-381 + privacy-pools + `poseidon255`↔`soroban-poseidon` + `circom2soroban`.** Esto se suma a la corrección de escalabilidad (paralelismo, no recursión). Deps congeladas de §10 ya corregidas.

---

## 0. Veredicto de viabilidad (TL;DR)

🟡→🟢 **CONSTRUIBLE, pero el doc original apuesta su tesis a una tecnología NO lista (recursión/agregación) y a un claim O(1) que es el ceiling, no el MVP.** Con **una reescritura del relato de escalabilidad** (la corrección #2, la más importante de las tres specs), Quorum pasa a 🟢 y conserva casi todo su atractivo.

**Las dos correcciones decisivas:**
1. **Poseidon solo in-circuit (igual que Terroir/VeritasVoice).** Nada de acumular un Merkle root con Poseidon nativa on-chain → evita el mismatch circomlib↔nativa.
2. **Reanclar la escalabilidad: NO "O(1) vía recursión", SÍ "paralelismo vergonzoso".** El voto es **Semaphore verificado por-voto on-chain** (verificación nativa barata), y **Stellar absorbe el volumen por throughput**, no por agregar pruebas. La recursión/MACI son **roadmap explícito**, jamás en el camino de build. Esto mantiene el "no se cae" — pero por una razón **a prueba de balas** en vez de una **no probada**.

---

## 1. Estado real de cada tecnología

| Tecnología | Rol en Quorum | Estado real (evidencia) | Riesgo rewrite | Fallback |
|---|---|---|---|---|
| **Semaphore (membership + nullifier + signal)** | el voto anónimo único | 🟢 Auditado, producción 2022+. Groth16/BN254. | **Nulo** | fork |
| **`groth16_verifier` Soroban (BN254 nativo)** | verificar cada voto on-chain | 🟢 Mainnet P25/P26 (2026). | **Nulo** | — |
| **MSM nativo (P26)** | combinación de public inputs del verificador | 🟢 **Mainnet 6-may-2026** (CAP-0074/Yardstick). | **Nulo** | el verificador ya lo usa internamente |
| **Capa clásica de Stellar (throughput)** | absorber la avalancha de votos | 🟢 Años moviendo miles de tx/s. | **Nulo** | — |
| **Counters / Map on-chain (tally + nullifiers)** | conteo y anti-doble-voto | 🟢 Storage Soroban básico. | **Nulo** | — |
| **Commit-reveal (secreto del voto)** | ocultar el voto hasta el cierre | 🟢 Patrón trivial (hash + fase reveal). | **Nulo** | rung 0 sin secreto-hasta-cierre |
| **Recursión / folding (prueba que verifica pruebas)** | "O(1) para N ilimitado" | 🔴 **NO hay camino probado en Soroban hoy.** | **Fatal si lo pones en el build** | **roadmap, fuera del MVP** |
| **MACI (coercion resistance)** | anti-compra de votos | 🔴 Complejo, no a 3 días. | **Fatal si lo intentas** | roadmap |
| **ElGamal homomórfico (tally cifrado)** | tally sin fase reveal | 🟡 Construible (BabyJubjub) pero +alcance. | Medio | rung 2, no MVP |
| **Poseidon nativa on-chain** | *no usar* | 🟡 params ≠ circomlib | — | in-circuit (circomlib) |

**Lectura:** todo lo verde **ship seguro**. Todo lo rojo (recursión, MACI) sale del camino crítico **hoy**, no a mitad de desarrollo. Esa es exactamente la decisión que pediste tomar por adelantado.

---

## 2. La corrección decisiva: reanclar el "no se cae"

### 2.1 Lo que el doc original promete (y por qué es riesgoso)
El `zk-quorum.md` dice: *"no verificamos una prueba por voto, sino una sola prueba de tally O(1)"* y apoya el MVP en **batch verification / agregación / recursión** (tier "wild"). Problema de ingeniería: **la recursión sobre Stellar no es un camino probado y listo.** Si arrancas el build asumiéndola, te arriesgas a chocar pared a 36 h del deadline. Eso viola tu mandato.

### 2.2 El reencuadre a prueba de balas: paralelismo, no agregación
**El insight honesto:** una elección es **embarazosamente paralela**. Cada voto es una verificación Groth16 **independiente y barata** (P25/P26 hacen un pairing nativo asequible). No necesitas plegar N pruebas en una; necesitas **N verificaciones baratas independientes**, y **eso es exactamente para lo que sirve una L1 de alto TPS**.

```
        TESIS CORREGIDA: "escala porque Stellar escala"
  cada voto ──► tx propia ──► el contrato verifica 1 Groth16 (nativo, barato)
                                   + dedup nullifier + ++counter
  miles de votos ──► miles de tx ──► Stellar las digiere por throughput
  (no hay un cómputo gigante que pueda reventar; hay muchos chiquitos)
```

- **Costo on-chain:** O(n) verificaciones, **cada una barata y constante**. NO es O(1) total — y no necesita serlo. El "no se cae" viene del **throughput de Stellar**, que es real y probado.
- **Auditable:** todos los votos (proof + nullifier + signal) quedan on-chain; cualquiera **replica el conteo** y verifica que no hay nullifiers repetidos y que todos ∈ padrón. Permissionless.
- **La agregación/recursión (O(1))** se convierte en lo que honestamente es: una **optimización de eficiencia futura**, documentada como roadmap, que usará MSM (P26) y folding cuando el tooling Stellar lo soporte. El **showcase de MSM sigue siendo genuino** porque el verificador Groth16 estándar **ya usa MSM nativo** para combinar los public inputs.

> Resultado: Quorum conserva su narrativa ("urna que no se cae, auditable") pero la sostiene una tecnología **viva y probada** (throughput + verificación nativa), no una **no lista** (recursión). Mantienes el techo como roadmap sin apostar el MVP a él.

---

## 3. El secreto del voto: la escalera de rungs (elige por tiempo, sin tech exótica)

| Rung | Qué da | Cómo | Tech | Veredicto 3 días |
|---|---|---|---|---|
| **0 — Voto anónimo público** *(MVP garantizado)* | identidad oculta, anti-Sybil, auditable | Semaphore: `signal = voto`; contador on-chain | 🟢 todo probado | **Ship seguro** |
| **1 — Secreto hasta el cierre** | + el voto no se ve durante la elección | commit-reveal: `signal = hash(voto, salt)`; fase reveal | 🟢 hash + fase | **Si el Día 2 va bien** |
| **2 — Tally cifrado sin reveal** | + sin fase reveal | ElGamal homomórfico en BabyJubjub + prueba de decodificación | 🟡 +alcance | Roadmap cercano |
| **3 — Coercion resistance + O(1)** | + anti-compra de votos, escala ilimitada | MACI + recursión | 🔴 no listo en Stellar | **Roadmap, no tocar** |

**Recomendación:** **ship Rung 0** (garantizado: verificado + anónimo + anti-Sybil + auditable + throughput-escalable). Si el Día 2 cierra con holgura, **sube a Rung 1** (commit-reveal) para tener "secreto del voto" real con tecnología trivial (un hash y una fase de revelado). Declara Rung 2/3 como roadmap. **Honestidad de alcance:** Rung 0 visibiliza el voto a medida que entra (no hay secreto-hasta-cierre ni coerción-resistencia); dilo en el README — el jurado premia la honestidad.

---

## 4. Riesgo Poseidon interop (mismo que en los otros dos)

Semaphore hashea **todo** (Merkle del padrón, nullifier, signalHash) **in-circuit** (circomlib). El contrato trata `merkleRoot, nullifierHash, signalHash` como **field elements opacos**: verifica el Groth16 (BN254 nativo), compara el root, dedup del nullifier, suma el contador. **Nunca recomputa Poseidon nativa.**

**Corrección concreta al original:** el `cast` del doc dice *"acumula un Merkle root incremental (Poseidon) on-chain"*. **Quitar eso.** No acumules un root con Poseidon nativa (riesgo de mismatch + costo). El "set" de votos es simplemente el **log on-chain de casts** (eventos/almacenamiento); si quieres un commitment del set para auditoría, deja que un cliente lo compute con circomlib y publícalo como dato, no como verdad on-chain recomputada.

---

## 5. Arquitectura técnica validada (Rung 0/1)

### 5.1 Contrato (corregido)
```rust
impl ZkQuorum {
    fn open_election(env, admin, election_id, roll_root: BytesN<32>, options: u32, opens, closes);

    // Rung 0: cada voto se VERIFICA on-chain (barato, nativo). Paralelo, no agregado.
    fn cast(env, election_id, proof: Groth16Proof,
            nullifier: BytesN<32>, signal: BytesN<32> /* = voto (R0) o hash(voto,salt) (R1) */)
        -> Result<(), Error> {
        require!(now() < closes, Closed);
        require!(public_root == storage.roll_root(election_id), BadRoot);
        require!(!storage.nullifiers(election_id).contains(nullifier), DoubleVote);
        require!(verify_groth16(&SEMAPHORE_VK, &proof, &[roll_root, election_id, nullifier, signal]), BadProof); // BN254+MSM nativo
        storage.nullifiers(election_id).insert(nullifier);
        // R0: signal es el voto → ++tally[signal]. R1: guarda el commitment para la fase reveal.
        tally_or_store(election_id, signal);
        Ok(())
    }

    // R1 únicamente: revelar y contar tras el cierre.
    fn reveal(env, election_id, vote: u32, salt: BytesN<32>) -> Result<(), Error>;

    fn result(env, election_id) -> Tally;     // contadores on-chain
    fn audit(env, election_id) -> AuditBundle; // roll_root + lista de (nullifier, signal) + tally
}
```

### 5.2 Circuito = Semaphore (no se escribe)
`signal`/`externalNullifier` ya existen en Semaphore. `externalNullifier = election_id` garantiza "un voto por miembro por elección". El `signal` transporta el voto (R0) o su commitment (R1). **Cero criptografía nueva.**

### 5.3 Showcase de tech nueva (genuino y vivo)
- **BN254 pairing nativo** verifica cada voto.
- **MSM nativo (P26)** combina los public inputs del verificador → P26 ejercitado de verdad en cada `cast`.
- **Throughput clásico** absorbe la avalancha.
- (Opcional) **Passkey** para emitir el voto con biometría.
- (Opcional) **USDC SEP-41** para el modelo SaaS (pago por elección).

---

## 6. Correcciones al `zk-quorum.md` original

| Sección | Dice | Corregir a |
|---|---|---|
| §0/§2 tesis "O(1) on-chain vía una sola prueba de tally" | apuesta a recursión no lista | **Rung 0 = O(n) verificaciones baratas + throughput.** O(1)/recursión = roadmap explícito. (ver §2 de esta spec) |
| §2.4 "batch verification (MVP) → recursión" | batch como MVP | Batch verification **custom = stretch**; el MVP **no lo necesita** (verificación por-voto). MSM lo usa el verificador estándar. |
| §2.2 `cast` "acumula R_set Poseidon on-chain" | Poseidon nativa on-chain | **Quitar.** Set = log on-chain; commitments del set los computa el cliente (circomlib). |
| §2.3 "prueba de tally del agregador" | agregador que ve aperturas | En Rung 0 no hay agregador (tally on-chain directo). Rung 1 = commit-reveal. Agregador/homomórfico = Rung 2. |
| §1 "secreto del voto" como dado | el MVP R0 no oculta el voto-en-tránsito | Aclarar la **escalera de rungs** (§3): R0 anónimo-público; R1 commit-reveal = secreto. |
| §5 "circuito `vote_cast` propio" | implica circuito propio | **Es Semaphore.** Forkear. |
| §11 riesgo "circuito de tally grande → proving lento" | asume tally-SNARK | Desaparece en Rung 0 (no hay tally-SNARK; hay contadores). |

> Nota importante: estas correcciones **no matan la idea** — la **salvan**. Quorum sigue siendo "urna verificada, anónima, auditable, que no se cae", pero ahora sobre cimientos que **no pueden obligarte a un rewrite**. El "tier wild" (recursión/MACI) se vende como visión/roadmap, que es donde es honesto.

---

## 7. Mejoras para subir el fit con el hackathon

1. **El demo de escala honesto.** Script que emite **500 votos** (500 pruebas Semaphore), muéstralos entrando como txs independientes y baratas, el contador subiendo en vivo, y la **auditoría permissionless** re-contando. El "no se cae" se **ve**, y es real (throughput), no prometido (recursión).
2. **Di "Semaphore + Stellar throughput".** Pitch de una frase, creíble para un jurado técnico, bajo riesgo.
3. **Commit-reveal si alcanzas** = "secreto del voto" de verdad, con un hash. Gran salto de calidad por poco costo.
4. **Encaje SDF:** padrón como **ASP/allowlist** (set certificado) + auditoría append-only = "privacidad cumplidora", criterio que la SDF premia.
5. **MSM explícito en README:** "cada voto se verifica con BN254/MSM nativos de P26" — guiño correcto y verificable.

---

## 8. Simplificaciones (anti over-engineering — aquí es donde más importa)

- ❌ **Fuera del build:** recursión, folding, MACI, batch verification custom, tally-SNARK agregado → ✅ verificación por-voto + contadores.
- ❌ Acumulador Merkle on-chain con Poseidon nativa → ✅ log de casts.
- ❌ Agregador off-chain + decodificación → ✅ tally on-chain directo (R0) / commit-reveal (R1).
- ❌ Secreto perfecto + coercion-resistance en el MVP → ✅ declarados como rungs superiores/roadmap.

**Net:** Quorum deja de ser "el más ambicioso y arriesgado" y pasa a ser **tan construible como VeritasVoice**, conservando la narrativa de infraestructura. Eso sube su ranking real para ganar.

---

## 9. Plan de cero-riesgo (3 días)

1. **Día 1 — Spike letal.** Prueba Semaphore en navegador → verifícala en el fork de `groth16_verifier` on-chain. *Es el mismo spike que VeritasVoice* (mismo primitivo). Si pasa, el núcleo está.
2. **Día 2 — `open`/`cast` (Rung 0) + dedup + contadores + `audit`.** Demo de 50→500 votos. *Hito: elección anónima completa, auditable, en vivo.*
3. **Día 3 — (si alcanza) commit-reveal (Rung 1) + demo de escala + README honesto (rungs/roadmap) + video.**

**Regla de oro:** Rung 0 debe estar terminado y verificando on-chain al final del Día 2. Todo lo demás es mejora, no dependencia.

---

## 10. Dependencias congeladas

```
Curva         BLS12-381  (snarkjs --curve bls12381)   ← NO bn128/BN254
base          fork de soroban-examples/privacy-pools  (circuito Withdraw = membership + nullifier + ASP)
circuitos     commitment.circom + merkleProof.circom + poseidon255  (signal = voto R0 / hash(voto) R1)
Poseidon      poseidon255 (circom)  ↔  soroban-poseidon 25.0.0 (Rust)
verificador   groth16_verifier (BLS12-381) importado vía contractimport!
serialización cli/circom2soroban
snarkjs       0.7.x (Groth16, bls12381)   ·   circom 2.2.x
soroban-sdk   25.1.0   ·   stellar CLI 27   ·   target wasm32v1-none
red           Stellar testnet (deploy del verificador YA validado en el spike)
NO en build:  recursión / MACI / batch-verify custom / BN254  → roadmap/stretch
```

**Garantía:** el MVP (Rung 0) usa exactamente el mismo primitivo probado que VeritasVoice (Semaphore) + storage básico + verificación nativa viva. **Ninguna tecnología "por lanzar" en el camino crítico.** La ambición (O(1)/recursión/MACI) queda como visión declarada, no como dependencia — que es justo lo que pediste.
