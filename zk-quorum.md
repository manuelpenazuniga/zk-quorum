# ZK-Quorum — Urna secreta institucional: ID verificada, voto anónimo, escala que no se cae, auditable para siempre

> **VISIÓN HISTÓRICA / NO USAR COMO SPEC (2026-06-29).**
> Este documento contiene claims y pseudocódigo anteriores al audit del circuito
> real, incluyendo Semaphore, BN254, `externalNullifier`, señal de voto,
> paralelismo y escala no medidos. La especificación y ejecución autoritativas
> están en `docs/plan/ZK-QUORUM-EXECUTION-PLAN.md`. Los claims finales se
> reescribirán únicamente desde evidencia.

**Proyecto en profundidad** · Modelo: Opus 4.8 · Fecha: 2026-06-26 · Deadline: 2026-06-29 12:00 PST (~3 días)
**Stack:** **fork de `privacy-pools`** (Circom/Groth16, **BLS12-381**): membership + nullifier + **ASP** · proving en navegador (snarkjs `--curve bls12381`) · Poseidon `poseidon255`↔`soroban-poseidon` · verificador `groth16_verifier` (BLS12-381) · capa clásica de Stellar (throughput) · Soroban · Passkeys (Secp256r1) · SEP-41 (USDC)

> ✅ **CORRECCIÓN POST-SPIKE (2026-06-26 — ver `spike/SPIKE-RESULTS.md`).** El spike (9/9 tests + deploy testnet) probó que la ruta Circom→Groth16→Soroban **shipped es BLS12-381, NO BN254**, y que Rung 0 = **fork de `privacy-pools`** (su circuito `Withdraw` ya es membership+nullifier+**ASP**), no Semaphore. **Donde abajo se diga "Semaphore", "BN254/MSM nativo" o "circomlib Poseidon", léase → BLS12-381 + privacy-pools + `poseidon255`↔`soroban-poseidon`.** Esto va *encima* de la corrección de escalabilidad (paralelismo, no recursión) de la nota de ingeniería siguiente.
**Una frase que gana:** *"500 personas votan, el sistema no se cae, y al cerrar cualquiera puede re-auditar matemáticamente que nadie votó dos veces y que el conteo cuadra — sin saber jamás quién votó qué."*

> ⚙️ **Nota de ingeniería (ver `techs-specs-zk-quorum.md`):** la versión previa de este doc apostaba el MVP a **agregación/recursión** y a un claim **O(1)**, que sobre Stellar **no es un camino probado y listo**. Este doc ya está corregido: el MVP descansa en **paralelismo + throughput** (cada voto = una prueba **Semaphore** verificada on-chain, barata y nativa; Stellar absorbe el volumen). Recursión/MACI = **roadmap**, nunca en el camino de build. El "no se cae" se sostiene en tecnología **viva en mainnet**, no por venir.

---

## 0. Tesis (el porqué profundo)

La votación institucional —sindicatos, empresas, municipios, comunidades— está rota por **los dos extremos a la vez**:

- **Papel:** caro, lento, y siempre hay un perdedor que grita "fraude" sin poder probarlo ni desmentirlo. La integridad descansa en "confía en el escrutador".
- **Electrónico centralizado:** una caja negra. "Confía en el servidor del administrador." Nadie audita el binario que cuenta.

Hoy se paga a notarios y firmas administradoras de elecciones **precisamente porque ninguna parte confía en la otra**. Es un mercado que existe solo para suplir la falta de una garantía matemática.

ZK ofrece esa garantía. Pero el reto que separa "un juguete de voto on-chain" de **infraestructura electoral seria** es uno solo: **escala sin caerse, y auditoría permanente**. La contribución de ZK-Quorum es **arquitectónica**, y su corrección de ingeniería es no apostarla a magia: una elección es **embarazosamente paralela** — cada voto es una verificación Groth16 **independiente y barata** (Semaphore + BN254 nativo). No necesitas plegar N pruebas en una; necesitas **N verificaciones baratas**, y para eso sirve **el alto throughput de la capa clásica de Stellar**. El blockchain no es decorado: **es el sustrato que sostiene el sistema** — porque escala como capa de pagos, no porque inventemos recursión sin probar.

> **Insight de máxima abstracción:** ZK-Quorum no es "una dApp de voto". Es **verificación paralela de un conjunto privado de alta cardinalidad, anclada en un ledger auditable**. Voto es la instancia. El mismo motor hace subastas selladas, encuestas privadas, estadística confidencial (mediana salarial), o proof-of-reserves. La invariante: *muchos provers privados → muchas verificaciones baratas → un veredicto público auditable*. (La compresión a **una** prueba O(1) vía recursión es el **techo/roadmap**, no el MVP.)

---

## 1. Las cuatro propiedades (lo que ninguna otra herramienta da junta)

Una urna seria necesita **simultáneamente**:

| # | Propiedad | Qué garantiza | Cómo la damos |
|---|---|---|---|
| 1 | **Elegibilidad** | solo miembros del padrón votan | membership Merkle (Semaphore, Poseidon circomlib in-circuit) contra `R_roll` |
| 2 | **Unicidad** | uno por cabeza, anti-relleno de urna | `nullifierHash` con `externalNullifier = election_id` (Semaphore) |
| 3 | **Secreto del voto** | el voto no es linkable a la persona | **escalera de rungs** (§3.5): Rung 0 anónimo-público → Rung 1 commit-reveal (secreto real) |
| 4 | **Integridad del conteo** | el resultado es demostrablemente correcto | conteo on-chain re-ejecutable por cualquiera (auditoría permissionless) |

**Por qué solo ZK:** login da 1 y 2 pero **mata 3**. El papel da 3 pero no demuestra 1, 2 ni 4. Solo un sistema ZK entrega las cuatro **a la vez**. Quita la privacidad y es vigilancia; quita la prueba y es una caja negra. Es el caso de uso canónico de ZK, llevado a producción real. *(Nota: la propiedad 3 se entrega por niveles — ver la escalera de rungs en §3.5; el MVP garantizado es anónimo-pero-público, el secreto-hasta-cierre se añade con commit-reveal.)*

---

## 2. La arquitectura que NO se cae (el corazón del proyecto)

### 2.1 El error a evitar (y el que NO debemos cometer)

Hay **dos** trampas, no una:
- **Trampa ingenua:** no verificar nada por voto y confiar en un servidor que cuenta → caja negra.
- **Trampa "elegante" (la que el doc previo cayó):** apostar el MVP a **una sola prueba de tally O(1) vía recursión/agregación**. Sobre Stellar **eso no es un camino probado y listo hoy** → riesgo de chocar pared a 36h del deadline. **Lo sacamos del build.**

### 2.2 La arquitectura correcta: paralelismo + throughput (no agregación)

**El insight honesto:** una elección es **embarazosamente paralela**. Cada voto es una verificación Groth16 **independiente y barata** (P25/P26 hacen un pairing nativo asequible). No plegamos N pruebas en una; hacemos **N verificaciones baratas independientes**, y **eso es justo para lo que sirve una L1 de alto TPS**.

```
        TESIS CORREGIDA: "escala porque Stellar escala"
  cada voto ──► tx propia ──► el contrato verifica 1 prueba Semaphore
                                (BN254+MSM nativo, barato) + dedup nullifier + ++counter
  miles de votos ──► miles de tx ──► Stellar las digiere por throughput
  (no hay un cómputo gigante que pueda reventar; hay muchos chiquitos e independientes)
```

**Costos (claim honesto):**
- **Por voto, on-chain:** **una** verificación Groth16 barata + `insert` de nullifier + `++` de contador. **O(n) en total, pero cada uno barato y constante.** No es O(1) total — **y no necesita serlo**: el "no se cae" viene del **throughput de Stellar**, que es real y probado.
- **MSM (P26) se usa de verdad:** el verificador Groth16 estándar combina los public inputs con **multi-scalar multiplication nativa** → P26 ejercitado en cada `cast`. El showcase es genuino sin batch custom.

> **La compresión a O(1)** (batch verification custom o recursión/folding) es una **optimización de eficiencia futura** — el tier "wild" de la convocatoria — que documentamos como **roadmap**, no como dependencia del MVP.

### 2.3 Esquema criptográfico = **Semaphore** (no se escribe circuito)

**Inscripción:** la organización publica el padrón como `Group` de Semaphore (árbol de identity commitments, Poseidon circomlib **in-circuit**); la raíz `R_roll` es pública. Cada miembro tiene una `Identity` (su `secret`).

**Emisión (prueba en el navegador del votante):** una prueba **Semaphore** estándar que demuestra:
1. membership ∈ `R_roll` (elegibilidad),
2. `nullifierHash` con `externalNullifier = election_id` (unicidad: un voto por miembro por elección),
3. difunde un `signal` (= el voto, en Rung 0; = `hash(voto, salt)`, en Rung 1).

Salidas públicas (opacas para el contrato): `R_roll, election_id (externalNullifier), nullifierHash, signalHash`. **El contrato verifica esta prueba en el `cast`** (BN254 nativo), rechaza nullifiers duplicados y suma el contador. **Sin agregador, sin tally-SNARK, sin recursión.**

### 2.4 Poseidon: solo in-circuit

Semaphore hashea todo (Merkle, nullifier, signal) **dentro del circuito** (circomlib). El contrato trata `R_roll`/`nullifierHash`/`signalHash` como **field elements opacos** y **nunca recomputa Poseidon nativa** (sus parámetros no coinciden con circomlib — ver tech-spec §4). El showcase on-chain = **BN254 `pairing_check` + MSM nativos**.

### 2.5 Auditoría permanente (la otra mitad de tu pedido)

Todo vive en el ledger **append-only y público**: `R_roll` y cada voto `(nullifierHash, signal/commitment, prueba)`. Tras la elección, **cualquiera** descarga los datos y **re-ejecuta el conteo**:
- ningún `nullifierHash` se repite (nadie votó dos veces),
- cada prueba verifica contra `R_roll` (todos elegibles),
- el contador cuadra con la suma de los votos.

El perdedor ya no grita fraude sin pruebas: o lo demuestra con matemática, o se calla. **La auditoría es permissionless, no "confía en el tribunal electoral".** *(El secreto del voto durante la elección depende del rung — ver §3.5.)*

---

## 3. Por qué Stellar específicamente (no cualquier cadena)

| Necesidad de Quorum | Qué de Stellar la cubre |
|---|---|
| Digerir O(n) escritos baratos (la avalancha) | **Capa clásica:** miles de ops/s, fees ínfimos, finalidad ~5s |
| Verificación SNARK barata **por voto** | **BN254 `pairing_check` nativo (P25/P26)** en Soroban |
| Batch verification de muchos votos | **MSM nativo (P26)** — la feature más nueva, justo la que necesitamos |
| Commitments/nullifiers/Merkle | **Poseidon circomlib in-circuit** (el contrato no recomputa; trata hashes como opacos) |
| Padrón como "set limpio" | patrón **ASP** (membership en set certificado) |
| UX sin seed phrase | **Passkeys (Secp256r1)** nativo |
| Cobro del servicio (SaaS) | **USDC/EURC vía SEP-41** |
| Auditoría permanente | ledger **append-only** público |

Es la única cadena donde *throughput de pagos masivo* y *primitivas ZK nativas baratas* conviven — y donde la pieza más nueva (MSM) es exactamente la que la escala necesita. Eso es "leer entre líneas" la convocatoria.

### 3.5 La escalera del secreto del voto (elige por tiempo, sin tech exótica)

El "secreto del voto" se entrega por niveles. Cada rung es **construible con tecnología viva**; eliges hasta dónde llegas según el tiempo, sin riesgo de rewrite.

| Rung | Qué añade | Cómo | Tech | 3 días |
|---|---|---|---|---|
| **0 — Voto anónimo público** *(MVP garantizado)* | identidad oculta, anti-Sybil, auditable | Semaphore: `signal = voto`; contador on-chain | 🟢 todo probado | **Ship seguro** |
| **1 — Secreto hasta el cierre** | el voto no se ve durante la elección | commit-reveal: `signal = hash(voto, salt)`; fase reveal tras cerrar | 🟢 hash + fase | **Si el Día 2 va bien** |
| **2 — Tally cifrado sin reveal** | no hace falta fase de revelado | ElGamal homomórfico en BabyJubjub + prueba de decodificación | 🟡 +alcance | Roadmap cercano |
| **3 — Coercion resistance + O(1)** | anti-compra de votos, escala ilimitada | MACI + recursión/folding | 🔴 no listo en Stellar | **Roadmap, no tocar** |

**Recomendación:** **ship Rung 0** (verificado + anónimo + anti-Sybil + auditable + throughput-escalable, todo garantizado). Si el Día 2 cierra con holgura, **sube a Rung 1** (commit-reveal) y tienes "secreto del voto" real con un hash y una fase de revelado. **Honestidad de alcance (dilo en el README):** Rung 0 hace visible el voto a medida que entra (no hay secreto-hasta-cierre ni resistencia a coerción); Rung 1 lo cierra. El jurado premia la honestidad.

---

## 4. Arquitectura de sistema

```mermaid
sequenceDiagram
    autonumber
    participant Org as Org (publica padrón)
    participant Roll as Contrato Padrón (R_roll)
    participant V as Votante (navegador)
    participant Box as Contrato Urna (Soroban)
    participant Aud as Auditor (cualquiera)

    Org->>Roll: publica R_roll (Group Semaphore, Poseidon circomlib)
    Note over V: snarkjs WASM: prueba Semaphore<br/>membership + nullifierHash + signal (=voto R0 / hash(voto) R1)
    V->>Box: cast(prueba, nullifierHash, signal) — tx propia, barata
    Box->>Box: verify_groth16 (BN254+MSM nativo) + dedup nullifier + ++counter
    Note over V,Box: miles de votos = miles de tx independientes<br/>Stellar las absorbe por throughput (no hay cómputo gigante)
    Aud->>Box: descarga (R_roll, todos los votos, contadores)
    Box-->>Aud: re-ejecuta: sin nullifiers repetidos + todos elegibles + conteo cuadra<br/>(R1: votos secretos hasta el reveal)
```

### 4.1 Contrato Soroban (interfaz)

```rust
impl ZkQuorum {
    fn open_election(env, admin, election_id: u64, r_roll: BytesN<32>,
                     options: u32, opens: u64, closes: u64);

    // Emisión: cada voto se VERIFICA on-chain (barato, nativo). Paralelo, no agregado.
    fn cast(env, election_id: u64, proof: Groth16Proof,
            nullifier_hash: BytesN<32>, signal: BytesN<32> /* =voto (R0) | hash(voto,salt) (R1) */)
        -> Result<(), Error> {
        require!(now() < storage.closes(election_id), Closed);
        require!(!storage.nullifiers(election_id).contains(nullifier_hash), DoubleVote);
        // prueba Semaphore: membership ∈ R_roll + nullifierHash(externalNullifier=election_id) + signalHash
        let pubs = [storage.r_roll(election_id), election_id, nullifier_hash, hash(signal)];
        require!(verify_groth16(&SEMAPHORE_VK, &proof, &pubs), BadProof); // BN254 + MSM nativo
        storage.nullifiers(election_id).insert(nullifier_hash);
        // R0: signal es el voto → ++tally[signal].  R1: guarda el commitment para la fase reveal.
        tally_or_store(env, election_id, signal);
        Ok(())
    }

    // Solo Rung 1: revelar y contar tras el cierre.
    fn reveal(env, election_id: u64, vote: u32, salt: BytesN<32>) -> Result<(), Error>;

    fn result(env, election_id: u64) -> Tally; // contadores on-chain

    // Auditoría permissionless: re-ejecuta el conteo sin revelar identidades.
    fn audit(env, election_id: u64) -> AuditBundle; // R_roll + lista de (nullifierHash, signal, proof) + tally
}
```

**Almacenamiento:** por elección — `R_roll`, `Map<nullifierHash,()>`, `tally[]` (contadores), votos `(nullifierHash, signal, proof)`. Sin acumulador Poseidon on-chain (las raíces/hashes son public inputs opacos). Cada `cast` cuesta una verificación barata; **no hay tally-SNARK ni agregador**.

---

## 5. El slice vertical para 3 días (real vs mock)

**Recorte:** una elección, sí/no (o 3 opciones one-hot), ~100–500 votantes simulados, **Rung 0** (verificación por-voto; sin recursión, sin agregador).

| Componente | Estado |
|---|---|
| Circuito = **Semaphore** (membership + nullifier + signal) | **REAL** (fork, no se escribe) |
| Proving en navegador (snarkjs) | **REAL** |
| `cast`: verifica prueba on-chain (BN254+MSM) + dedup nullifier + ++contador | **REAL** |
| Conteo on-chain (contadores) | **REAL** |
| Auditoría permissionless (`audit` + script re-ejecutor) | **REAL** |
| Padrón firmado de la org | **MOCK honesto** |
| Commit-reveal (Rung 1, secreto-hasta-cierre) | **si el Día 2 va bien** |
| Tally homomórfico / threshold (Rung 2) | **roadmap** (documentar) |
| Recursión, MACI, batch-verify custom (Rung 3 / O(1)) | **roadmap, fuera del build** |
| Passkeys + pago SaaS USDC | **si alcanza** |

**Demo de escala:** simular 500 votantes (script que genera 500 pruebas Semaphore), mostrar las txs entrando independientes y baratas, el contador subiendo en vivo, y un auditor **re-ejecutando el conteo**. El "no se cae" se *demuestra* (throughput real), no se promete (recursión).

---

## 6. Plan de 3 días (sprint real)

**Día 1 — Spike letal + emisión.**
- Desplegar el fork de `groth16_verifier`; generar una prueba **Semaphore** en navegador y **verificarla on-chain** *(riesgo #1; mismo spike que VeritasVoice)*. Medir costo y clavar la serialización.
- `cast`: verifica la prueba + dedup nullifier + ++contador. *Hito: 10 votantes emiten, duplicados rechazados, contador sube.*

**Día 2 — Elección completa (Rung 0) + auditoría.**
- `open_election` + `cast` + `result` + `audit`. Script re-ejecutor del conteo. *Hito: elección anónima completa, auditable, 50→500 votos.*

**Día 3 — (si alcanza) Rung 1 commit-reveal + demo de escala + video.**
- `signal = hash(voto, salt)` + `reveal`; o saltar a pulir Rung 0.
- Demo de 500 votantes; README honesto (rungs: R1 si está, R2/R3 = roadmap); video 2–3 min.

---

## 7. Modelo de amenaza (lo que un jurado de élite atacará)

| Ataque / pregunta | Respuesta de diseño |
|---|---|
| **"No escala / se cae con volumen"** | Cada voto = una verificación Groth16 **independiente y barata** (BN254 nativo); miles de votos = miles de tx que Stellar absorbe por **throughput**. No hay un cómputo gigante que reventar. Lo demostramos con 500. |
| **Doble voto** | `nullifierHash` (Semaphore, `externalNullifier=election_id`) con dedup on-chain → imposible repetir. |
| **Voto de no-elegibles** | Membership contra `R_roll` **verificado en cada `cast`**; la auditoría lo re-verifica. |
| **¿Se sabe quién votó qué?** | Identidad oculta por el nullifier (anónimo). El secreto del **valor** del voto durante la elección depende del rung: Rung 0 lo hace público-pero-anónimo; **Rung 1 (commit-reveal)** lo oculta hasta el cierre. Declarado en README. |
| **¿Confías en el servidor que cuenta?** | No: el conteo on-chain es **re-ejecutable** por cualquiera a partir de las pruebas. No hay binario de confianza. |
| **Coerción / compra de votos** (receipt-freeness) | Frontera dura y honesta; mitiga key-switching estilo MACI (**roadmap Rung 3**). Lo declaramos, no lo escondemos. |
| **Spam de votos basura (sin elegibilidad)** | Imposible: el `cast` **verifica la prueba de membership**, no acepta entradas sin prueba válida → no hay basura que inflar. |
| **Censura (no incluyen mi voto)** | Cada voto es su propia tx pública; un voto omitido es **detectable** (tu tx existe en el ledger pero no se contó → la auditoría no cuadra). |
| **"¿Por qué no Helios / voto centralizado?"** | Helios confía en su servidor para el conteo; aquí el conteo es público-verificable y el throughput descansa en una L1 de pagos. |

---

## 8. El video que gana (guion, 2–3 min)

> *"Una elección sindical. 500 personas. En papel, tarda días y el que pierde grita fraude. Mira esto: cada votante prueba que está en el padrón y emite su voto de forma anónima —nadie puede ligar el voto a su nombre. El sistema **no se cae**: cada voto es una transacción barata que Stellar verifica al instante; 500 votos son 500 transacciones independientes, y Stellar mueve millones. Cerramos. Ahora soy un observador cualquiera: descargo todos los votos y **re-ejecuto el conteo yo mismo** —compruebo que nadie votó dos veces, que todos eran elegibles, y que el resultado es exacto—, **sin poder saber jamás quién votó qué**. El que pierde ya no grita fraude: o lo prueba con matemática, o se calla. Esto no es una app de voto. Es infraestructura electoral que cualquiera puede auditar."*

**Diapositiva clave:** muchos votos → muchas verificaciones baratas **e independientes** (BN254/MSM nativo) → un ledger auditable. La flecha "escala porque Stellar escala". Esa imagen *es* la tesis (la compresión a una sola prueba O(1) se menciona como roadmap).

---

## 9. Diferenciación y abstracción (máximo nivel)

**Vs la pila del jurado:** casi todos harán "membership + nullifier" para un voto de juguete sin escala ni auditoría. Quorum es el único que ataca **la escala y la auditoría** —lo que separa un demo de un producto— sostenido en algo **probado** (throughput de Stellar + verificación nativa), no en algo por venir. El uso de **MSM nativo (P26)** en cada verificación es el guiño técnico genuino. La compresión a O(1) (tier "wild") se vende como **visión/roadmap**, que es donde es honesta.

**El primitivo reutilizable (verificación paralela + ledger auditable):**
> `App ZK escalable = N verificaciones baratas e independientes (Soroban + BN254 nativo) sobre el ledger de alto throughput de Stellar, re-ejecutables por cualquiera. Para CUALQUIER "muchos provers privados → muchas verificaciones baratas → un veredicto auditable".` *(La compresión a una sola prueba O(1) vía recursión es el techo, no la base.)*

Instancias del mismo motor:
- **Subasta de oferta sellada** (commit-reveal + prueba de oferta válida).
- **Encuesta/estadística confidencial** (mediana salarial, censo privado).
- **Proof-of-reserves** (cada cuenta prueba su saldo; suma auditable).
- **Airdrop/quadratic funding** anti-Sybil a gran escala.

Ganas el hackathon con una urna sindical y sales con un **patrón de verificación ZK escalable** que vale para media docena de verticales.

---

## 10. Viabilidad comercial

- **Comprador:** **sindicatos** (voto secreto legalmente obligatorio para directiva/huelga — mercado con presupuesto y obligación legal), **empresas** (juntas de accionistas, comités de empresa, board), **municipios/comunidades** (referendos, presupuestos, juntas de vecinos), colegios profesionales, cooperativas.
- **Modelo:** SaaS **por elección** en USDC (Stellar mismo cobra el servicio). Reemplaza notarios y firmas administradoras (miles de USD por elección) con un fee fracción del costo.
- **Foso:** confianza/auditabilidad como producto; integraciones de padrón (lock-in); reputación de "elecciones que nadie pudo impugnar".
- **Encaje legal:** muchas jurisdicciones **exigen** voto secreto verificable para sindicatos/corporativo → comprador con deadline regulatorio.

---

## 11. Riesgos y mitigaciones

| Riesgo | Sev. | Mitigación |
|---|---|---|
| Costo de verificación on-chain por voto | Media | Groth16 + BN254/MSM nativos (vivos en mainnet); medir Día 1. Cada verificación es barata; Stellar absorbe el volumen. |
| Apostar a recursión/agregación (no lista) | **Era Alta — ELIMINADA** | Fuera del build; MVP = verificación por-voto. Recursión = roadmap. |
| Secreto-hasta-cierre en Rung 0 | Media | Declararlo; subir a **Rung 1 commit-reveal** (trivial) si el Día 2 va bien. |
| Receipt-freeness / coerción | Media | Frontera honesta; MACI (Rung 3, roadmap). |
| Alcance (`cast`+dedup+conteo+audit en 3 días) | Media | Es Semaphore + storage básico; mismo spike que VeritasVoice. Passkey/SaaS/R1 si alcanza. |
| "Demasiado ambicioso para el jurado" | Baja | El MVP es tan construible como VeritasVoice; la ambición (O(1)/MACI) se vende como visión. |

---

## 12. Checklist de entrega

- [ ] Repo + README honesto (rungs: R0 entregado, R1 si está; R2/R3/recursión/MACI = roadmap; mock vs real).
- [ ] ZK **load-bearing**: las 4 propiedades a la vez (§1) — sin ZK no existen juntas.
- [ ] Stellar **load-bearing como infraestructura**: throughput clásico (absorbe los votos) + verificación nativa por-voto en Soroban + auditoría append-only.
- [ ] Tech nueva exhibida y **central**: **BN254 + MSM (P25/P26)** en cada verificación, ASP (padrón), Secp256r1, SEP-41. *(Poseidon = circomlib in-circuit, no nativa on-chain.)*
- [ ] Video 2–3 min: votos baratos e independientes → contador en vivo → auditoría permissionless (re-ejecución del conteo).
- [ ] Demo de escala (≥500 votantes simulados) que *muestra* el "no se cae" (throughput real).
