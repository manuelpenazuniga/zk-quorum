# ZK-Quorum — Plan maestro de arquitectura, implementación y auditoría multiagente

**Estado:** plan auditado y congelado; ejecución multiagente en curso, sin lanes integradas todavía
**Fecha de congelamiento inicial:** 2026-06-29
**Deadline informado y corregido explícitamente por el usuario:** 2026-07-02; hora exacta externa pendiente de registrar
**Freeze interno:** 2026-07-01 20:00 America/Santiago; después solo se aceptan fixes bloqueantes y material de entrega
**Repositorio:** `manuelpenazuniga/zk-quorum`
**Autoridad operativa:** este documento reemplaza los planes de ejecución anteriores cuando exista contradicción.
**Ledger de ejecución:** `docs/plan/OPEN-CODE-EXECUTION-LOG.md`; conserva sesiones, comandos, resultados, hallazgos y disposiciones posteriores al freeze.
**Regla principal:** primero se congela y audita el statement criptográfico; después se implementa. Ningún agente puede reinterpretar la arquitectura por su cuenta.

---

## 0. Propósito y definición de éxito

ZK-Quorum es una urna institucional sobre Stellar/Soroban con:

1. **Elegibilidad:** cada voto presenta una prueba ZK de pertenencia a un registro de credenciales y a un conjunto de elegibilidad.
2. **Unicidad por elección:** la misma credencial no puede votar dos veces en la misma elección, pero sus participaciones no deben ser enlazables entre elecciones.
3. **Privacidad:** la prueba no revela la identidad ni la credencial privada. La privacidad frente al ledger requiere además que la cuenta que envía la transacción no identifique al votante.
4. **Integridad:** solo se cuenta un voto después de validar su prueba y sus public signals.
5. **Auditabilidad:** los casts y reveals exitosos producen evidencia recuperable desde el ledger; un auditor independiente puede reconstruir el tally y verificar las pruebas.

### 0.1 Entregables obligatorios

- Rung 0 completo: voto público, identidad/credencial oculta.
- Rung 1 completo: commit durante la elección y reveal posterior.
- Contrato Soroban desplegado y ejercitado en testnet.
- Circuitos Groth16/BLS12-381, setup de desarrollo y manifiestos verificables.
- Cliente web que genera la prueba localmente.
- Relayer de demostración para evitar ligar la cuenta Stellar del votante al voto.
- Auditor independiente desde eventos/transacciones.
- Demo de carga objetivo de 500 votantes, con claims limitados a resultados medidos.
- Tests unitarios, de circuito, integración, testnet y seguridad.
- README, arquitectura, threat model, evidencia testnet, video y material de submission.

### 0.2 Propiedades que no se afirmarán

- No hay coercion resistance ni receipt-freeness.
- Rung 0 no oculta el valor del voto.
- Rung 1 depende de que el votante revele; existe riesgo de abstención en reveal.
- El issuer/ASP es una entidad confiable para emitir una sola credencial por identidad.
- El trusted setup del hackathon no es apto para producción.
- “500 votos”, “barato”, “paralelo” y “auditable para siempre” solo se usarán si la evidencia final soporta cada claim.
- Recursión, MACI y agregación O(1) no forman parte del build.

---

## 1. Evidencia de estado del repositorio

### 1.1 Estado Git observado

```text
branch: main
upstream: origin/main
commits: 2
HEAD: 5061040 docs: add CLAUDE-MEMORY.md with project state and ZK stack details
tracked product code: none
untracked:
  spike/package.json
  spike/package-lock.json
```

El repositorio versionado contiene documentación, el bootstrap del spike y su informe. El contrato, los circuitos adaptados, el cliente, el relayer, el auditor y el CI todavía no existen en Git.

### 1.2 Código regenerado localmente

```text
spike/soroban-examples commit:
7b168174ae1268dab91a0190d80a94ab7ff41b59

spike/soroban-examples size:
~1.2 GiB

spike/node_modules size:
~63 MiB
```

`spike/soroban-examples` está ignorado. Debe tratarse como upstream de referencia, nunca como directorio de implementación.

### 1.3 Toolchain observado

```text
OpenCode:       1.17.11
Rust:           1.96.0
Cargo:          1.96.0
target:         wasm32v1-none instalado
Circom local:   2.2.3
Node efectivo:  22.23.1
npm:            10.9.8
Stellar CLI:    no instalado en este entorno
```

La documentación anterior decía Node 24 y Stellar CLI 27. La implementación no debe asumirlos hasta instalarlos, fijarlos y registrar el resultado.

### 1.4 Tests reejecutados

```text
privacy-pools/contract:
  9 passed; 0 failed

groth16_verifier:
  1 passed; 0 failed
```

Esto valida las fixtures y el código upstream actualmente regenerado. No valida todavía ZK-Quorum ni una prueba propia invocada en testnet.

### 1.5 Estado de artefactos ZK

No se encontraron preservados:

- `.ptau`;
- `.zkey`;
- `verification_key.json`;
- `proof.json`;
- `public.json`;
- manifest o checksum de la prueba fresca descrita por el spike.

Por tanto, la prueba fresca histórica no es reproducible desde el repositorio actual. El build debe regenerar y documentar sus propios artefactos.

### 1.6 Estado testnet heredado

El informe declara:

```text
verifier:
CACFO5YAVIUZYINQTFDVHE5GBLYJ7ALQERA7AXB235KMWBIPHRRKZ57M

deploy tx:
c3cf4ded47992ec0b98aec674dbfb06bd24b7021149267d19af5bc8140b13507
```

La existencia histórica del deploy no reemplaza:

- validación de que el contrato sigue accesible;
- invocación con el nuevo VK/proof;
- deploy del contrato ZK-Quorum;
- medición de recursos.

---

## 2. Errores corregidos respecto de los planes anteriores

### 2.1 `externalNullifier` no existe en upstream

El circuito actual calcula:

```text
nullifierHash = Poseidon255(nullifier)
```

No existe `externalNullifier`. El diseño correcto será:

```text
nullifierHash = Poseidon255(nullifierSecret, electionScope)
```

`electionScope` será public input, se almacenará en la configuración de la elección y estará domain-separated por red, contrato, ID de elección y versión del circuito.

### 2.2 El voto no está ligado a la prueba actual

`privacy-pools/main.circom` tiene `withdrawnValue`, no un ballot signal. No se renombrará semánticamente sin cambiar el statement: se crearán circuitos de voto explícitos.

### 2.3 `label` no es `externalNullifier` ni necesariamente un ID

En upstream, `label` forma parte del commitment y se prueba contra `associationRoot`. Para ZK-Quorum se define explícitamente como un identificador aleatorio de credencial/policy tag emitido o aceptado por el ASP.

No se derivará directamente de documento de identidad, correo o dato personal.

### 2.4 ASP no sustituye al registro de credenciales

- `stateRoot`: prueba que el commitment de credencial fue registrado.
- `associationRoot`: prueba que el `label` privado sigue elegible para esa elección.

El circuito debe usar el mismo `label` en el commitment y en el Merkle proof del ASP.

### 2.5 No se autenticará al votante en `cast`

Un `voter.require_auth()` o parámetro `voter: Address` público ligaría la cuenta Stellar al voto/nullifier. `cast` y `reveal` aceptarán una prueba válida desde cualquier submitter.

La demo usará una cuenta relayer común. La alternativa de enviar directamente existe, pero reduce la privacidad de red y debe explicarse.

### 2.6 Los eventos de transacciones fallidas no son audit trail

Solo se publicarán eventos después de una verificación exitosa. Una invocación revertida no puede usarse como evidencia persistente emitida por el contrato.

### 2.7 Los eventos no eliminan TTL ni archivado

Los eventos/tx forman parte del ledger, pero su recuperación depende de RPC, Horizon o un archivo histórico. “Para siempre” requiere una estrategia de archivado/indexado, no solo `env.events().publish()`.

### 2.8 No se almacenará un `Vec` global de nullifiers

El upstream hace búsqueda lineal y reescribe el vector. ZK-Quorum usará una entrada persistente por:

```text
(election_id, nullifier_hash) -> true
```

### 2.9 La ejecución no es completamente “embarrassingly parallel”

La verificación es independiente, pero un contador único por opción crea write contention. Se implementarán tally buckets determinísticos para distribuir escrituras.

### 2.10 Rung 1 no es “solo un hash”

Requiere:

- circuito separado o statement versionado;
- commitment ligado a `electionScope`;
- fase reveal;
- verificación de rango privada;
- prevención de double reveal;
- tally posterior;
- política para non-reveals;
- interoperabilidad Poseidon Circom/Rust.

### 2.11 El hash de tres inputs de upstream es una zona insegura

El helper Rust upstream usa `poseidon_hash_native::<4>` para tres inputs, mientras `commitment.circom` contiene una composición secuencial de hashes de dos inputs y un comentario contradictorio. Los tests preservados solo prueban interoperabilidad para uno y dos inputs.

ZK-Quorum no usará Poseidon directo de tres inputs. Toda composición se define con `Poseidon255(2)`:

```text
P2(a, b) = Poseidon255 de dos inputs
P3seq(a, b, c) = P2(P2(a, b), c)
```

Rust debe implementar exactamente la misma composición con dos llamadas de dos inputs.

---

## 3. Stack congelado

| Capa | Decisión |
|---|---|
| Proof system | Groth16 |
| Curva | BLS12-381 |
| Circuit compiler | Circom 2.2.3 |
| Prover | snarkjs 0.7.x con BLS12-381 |
| Hash de circuito | `poseidon255.circom` |
| Hash Rust compatible | `soroban-poseidon` `=25.0.0`, sujeto a golden vectors |
| Verifier | `groth16_verifier` BLS12-381 vía `contractimport!` |
| Contract SDK | `soroban-sdk` 25.1.0 |
| Rust | 1.96.0 |
| WASM target | `wasm32v1-none` |
| Stellar CLI | 27.x, a instalar y fijar |
| Serialización | fork de `circom2soroban` + `libs/zk` |
| Merkle | fork de `lean-imt` y pruebas cross-language |
| Red | Stellar testnet |

### 3.1 Prohibiciones

- No BN254.
- No Semaphore.
- No circomlib Poseidon.
- No Poseidon host/configurable ni aridad nueva sin prueba de equivalencia.
- No recursión.
- No MACI.
- No custom batch verification.
- No actualización de dependencias sin decision record.
- No symlinks a `spike/soroban-examples`.

---

## 4. Modelo de credenciales e issuer

### 4.1 Flujo de emisión

1. El votante verifica su identidad fuera de cadena con la organización.
2. El votante genera localmente:
   - `nullifierSecret`;
   - `trapdoor`;
   - `label` aleatorio.
3. Calcula:

```text
precommitment = Poseidon255(nullifierSecret, trapdoor)
credentialCommitment = Poseidon255(label, precommitment)
```

4. Entrega `credentialCommitment` y `label` al issuer después de autenticarse.
5. El issuer aplica la regla “una credencial por identidad” fuera de cadena.
6. `credentialCommitment` entra al `stateRoot`.
7. `label` entra al `associationRoot` si la credencial está elegible.

### 4.2 Privacidad y límites

- El issuer conoce la relación identidad ↔ commitment/label durante emisión.
- El issuer no conoce `nullifierSecret` ni `trapdoor`.
- Al votar, el circuito no revela commitment, label, secrets ni Merkle path.
- El issuer no puede calcular el nullifier sin los secretos.
- Timing, IP, navegador comprometido o colusión con un relayer con logging quedan fuera de la protección criptográfica.

### 4.3 Revocación

`stateRoot` puede representar el registro estable. `associationRoot` se congela por elección y puede excluir labels revocados o no vigentes sin revelar cuál label usa un votante concreto.

Una vez abierta la elección:

- ninguno de los roots puede cambiar;
- cambiar elegibilidad exige cancelar y crear otra elección/versionar explícitamente la raíz.

---

## 5. Domain separation y tipos canónicos

### 5.1 Election scope

Se define fuera del circuito mediante rechazo, no mediante reducción modular silenciosa:

```text
message =
  len("zk-quorum:election-scope:v1") || "zk-quorum:election-scope:v1" ||
  len(network_passphrase)            || network_passphrase ||
  len(contract_id)                   || contract_id ||
  len(election_id)                   || election_id

for counter in 0..=255:
  digest = SHA-256(message || counter_u8)
  candidate = unsigned_big_endian_integer(digest)
  if 0 < candidate < BLS12_381_SCALAR_MODULUS:
    electionScope = candidate encoded as canonical 32-byte big-endian
    stop

fail if no candidate was accepted
```

La serialización `len(x)` usa `u32` big-endian. `network_passphrase` y el domain tag son UTF-8; `contract_id` se decodifica a sus 32 bytes binarios; `election_id` son 32 bytes binarios, no una representación JSON o hexadecimal textual. El algoritmo debe:

- estar implementado una sola vez en el cliente/tooling;
- producir una codificación canónica de 32 bytes;
- tener golden vectors;
- no reducir inputs dentro del contrato;
- estar documentado con endianness.

El contrato almacena `electionScope` al abrir la elección y compara byte por byte con el public signal parseado. El tooling de admin y el auditor verifican que el scope corresponde a red, contrato e ID; el contrato no rederiva SHA-256 durante `cast`.

### 5.2 Public signal schema versionado

Nunca se asumirán índices dispersos dentro del código. Se definirá:

```text
PUBLIC_SCHEMA_V1_R0:
  0 nullifierHash       output
  1 vote                public input
  2 optionCount         public input
  3 stateRoot           public input
  4 associationRoot     public input
  5 electionScope       public input

PUBLIC_SCHEMA_V1_R1:
  0 nullifierHash       output
  1 ballotCommitment    output
  2 optionCount         public input
  3 stateRoot           public input
  4 associationRoot     public input
  5 electionScope       public input
```

El orden se considera provisional hasta confirmarlo con `public.json`; después se congela mediante:

- una constante de schema;
- golden fixture;
- test de round-trip;
- documentación generada.

---

## 6. Circuitos

### 6.1 Componentes comunes

`credential.circom`:

```text
credentialCommitment = Poseidon255(
  label,
  Poseidon255(nullifierSecret, trapdoor)
)
```

`membership.circom`:

- demuestra `credentialCommitment ∈ stateRoot`;
- demuestra `label ∈ associationRoot`;
- obliga a que el label usado en ambos lugares sea el mismo;
- no admite el bypass `associationRoot == 0`.

`scoped-nullifier.circom`:

```text
nullifierHash = Poseidon255(nullifierSecret, electionScope)
```

### 6.2 Rung 0 — voto público

Public inputs:

- `vote`;
- `optionCount`;
- `stateRoot`;
- `associationRoot`;
- `electionScope`.

Private inputs:

- `label`;
- `nullifierSecret`;
- `trapdoor`;
- state Merkle index/siblings;
- ASP Merkle index/siblings.

Constraints adicionales:

```text
vote cabe en u32
optionCount cabe en u32
1 <= optionCount <= MAX_OPTIONS
vote < optionCount
```

La validación de rango debe existir en circuito y contrato. El comparador y `Num2Bits` se copiarán con licencia y commit fijado desde circomlib, pero no se importará circomlib Poseidon. Casos frontera obligatorios: `(vote=4, options=5)` pasa; `(5,5)`, `(0,0)` y `options=MAX_OPTIONS+1` fallan.

### 6.3 Rung 1 — commit/reveal

Public inputs:

- `optionCount`;
- `stateRoot`;
- `associationRoot`;
- `electionScope`.

Private inputs adicionales:

- `vote`;
- `salt`.

Outputs:

```text
nullifierHash = Poseidon255(nullifierSecret, electionScope)
voteSaltHash = Poseidon255(vote, salt)
ballotCommitment = Poseidon255(voteSaltHash, electionScope)
```

Constraints:

```text
vote < optionCount
salt != 0
```

`salt != 0` se implementa con `IsZero` o un inverse witness y un negative witness test; no se deja como pseudocódigo.

El frontend genera `salt` con CSPRNG y lo interpreta como scalar canónico mediante rejection sampling. El circuito solo puede probar que no es cero, no que tenga entropía; salts pequeños o memorizables permitirían brute-force sobre las opciones.

Durante reveal, el contrato recomputa las dos llamadas `Poseidon255(2)` con `soroban-poseidon = "=25.0.0"`. Antes de aceptar R1 debe existir un gate duro de golden vectors Circom ↔ Rust para:

- un input, solo si una función lo usa;
- dos inputs;
- la composición secuencial `P2(P2(a,b),c)`.

No se usa `Poseidon255(3)` directo.

### 6.4 Profundidades

Objetivo inicial:

```text
state tree depth:       10  (capacidad 1024)
association tree depth: 10  (capacidad 1024)
MAX_OPTIONS:            16
```

Esto cubre 500 votantes sin cargar el circuito con profundidad 20. Las profundidades solo cambian después de medir:

- constraints;
- proving time;
- memory;
- setup power;
- on-chain resources.

### 6.5 Trusted setup

Proceso:

1. Compilar R1CS.
2. Ejecutar `snarkjs r1cs info`.
3. Elegir el menor power que cubra el número real de constraints.
4. Generar o reutilizar un Powers of Tau BLS12-381 con checksum verificado.
5. Hacer contribución de desarrollo.
6. Generar zkey separado para R0 y R1.
7. Ejecutar la contribución circuit-specific/Phase 2 con `snarkjs zkey contribute`.
8. Verificar el zkey y exportar verification keys.
9. Generar beacon/contribución final si el tiempo lo permite.

Versionado:

- no versionar `.ptau` ni `.zkey` en Git;
- versionar VK JSON si su tamaño lo permite;
- versionar manifest con SHA-256, tamaño, comando, versión y URL/release del artefacto;
- registrar que el setup de hackathon es confiable y no productivo.

---

## 7. Contrato Soroban

### 7.1 API congelable

```rust
constructor(
    admin: Address,
    verifier: Address,
    vk_r0: Bytes,
    vk_r1: Bytes,
    vk_r0_hash: BytesN<32>,
    vk_r1_hash: BytesN<32>,
)

open_election(
    admin: Address,
    election_id: BytesN<32>,
    election_scope: BytesN<32>,
    mode: ElectionMode,
    state_root: BytesN<32>,
    association_root: BytesN<32>,
    option_count: u32,
    opens_at: u64,
    closes_at: u64,
    reveal_closes_at: u64,
) -> Result<(), Error>

cast(
    election_id: BytesN<32>,
    proof_bytes: Bytes,
    public_signals_bytes: Bytes,
) -> Result<(), Error>

reveal(
    election_id: BytesN<32>,
    vote: u32,
    salt: BytesN<32>,
    ballot_commitment: BytesN<32>,
) -> Result<(), Error>

result(election_id: BytesN<32>) -> Result<ElectionResult, Error>

audit_summary(election_id: BytesN<32>) -> Result<AuditSummary, Error>

extend_election_ttl(
    election_id: BytesN<32>,
    threshold: u32,
    extend_to: u32,
) -> Result<(), Error>
```

### 7.2 Autorización

- `constructor`: deployment-controlled.
- `open_election`: `admin.require_auth()`.
- `cast`: sin autenticación del votante.
- `reveal`: sin autenticación del votante; quien conoce `(vote, salt)` puede revelar el commitment.
- `extend_election_ttl`: permissionless y el caller paga.
- No habrá función administrativa para cambiar roots o tallies.

### 7.3 Orden seguro de `cast`

1. Parsear longitud exacta y codificación de public signals.
2. Cargar elección.
3. Validar ventana y modo.
4. Comparar option count, roots y election scope.
5. Validar rango del voto en R0.
6. Derivar nullifier key.
7. Rechazar nullifier ya usado antes de pagar el pairing.
8. Construir tipos del verifier usando el VK almacenado, nunca uno del caller.
9. Invocar `verify_proof`.
10. Si es falso, retornar sin escribir.
11. Marcar nullifier.
12. Actualizar tally bucket R0 o guardar commitment R1.
13. Emitir evento exitoso.
14. Extender TTL si está bajo threshold.

### 7.4 Tally shardeado

Se usarán 16 buckets:

```text
bucket = low_nibble(nullifierHash)
TallyBucket(election_id, option, bucket) -> u64
```

`result()` suma como máximo:

```text
MAX_OPTIONS * 16
```

lecturas. Esto reduce la contención respecto de un único contador por opción y mantiene un resultado on-chain acotado.

Para R1, el bucket se fija al registrar el commitment y se conserva en:

```text
PendingCommitment(election_id, ballot_commitment)
  -> { bucket, revealed: false }
```

### 7.5 Storage

Instance storage:

- admin;
- verifier address;
- VKs o referencias inmutables;
- versión del contrato.

Persistent storage:

- election config;
- nullifier flags con key canónica `DataKey::Nullifier(election_id, nullifier_hash)`;
- tally buckets;
- R1 pending/revealed flags;
- `commit_count`, `reveal_count` y totals.

No se almacenan proofs completas ni un vector global de votos.

### 7.6 TTL

El SDK 25.1.0 expone:

```rust
env.storage().persistent().extend_ttl(key, threshold, extend_to);
env.storage().instance().extend_ttl(threshold, extend_to);
```

`threshold` y `extend_to` se expresan en ledgers. No se hardcodearán equivalencias temporales sin consultar la configuración real de la red.

Política:

- extender instance/code al inicializar y durante operaciones administrativas;
- extender elección, buckets y nullifiers al escribir;
- permitir mantenimiento permissionless;
- acotar `threshold` y `extend_to` a una política fija y al máximo de la red para impedir parámetros arbitrarios;
- documentar restauración/archivado;
- medir el costo.

### 7.7 Eventos

R0:

```text
VoteCastV1 {
  election_id,
  nullifier_hash,
  vote,
  tally_bucket,
  public_schema_version,
  proof_hash,
  public_signals_hash,
}
```

R1:

```text
VoteCommittedV1 {
  election_id,
  nullifier_hash,
  ballot_commitment,
  tally_bucket,
  public_schema_version,
  proof_hash,
  public_signals_hash,
}

VoteRevealedV1 {
  election_id,
  ballot_commitment,
  vote,
}
```

Los eventos se emiten únicamente después de actualizar estado con éxito.

`proof_hash` y `public_signals_hash` son SHA-256 de los bytes exactos procesados. Permiten que el auditor compruebe que el artefacto archivado corresponde a la invocación, sin almacenar la proof completa.

`result()` R1 no itera pending commitments: suma tally buckets actualizados por `reveal` y devuelve además `commit_count`, `reveal_count` y `non_reveal_count = commit_count - reveal_count`.

---

## 8. Relayer y privacidad de red

### 8.1 Motivo

Aunque la prueba oculte la identidad del registro, la cuenta fuente de una transacción Stellar es pública. Si el votante usa una cuenta institucional conocida, el voto queda correlacionable.

### 8.2 Relayer de demo

El servicio:

1. recibe proof/public signals sin secretos;
2. limita tamaño y rate;
3. verifica off-chain antes de gastar fees;
4. simula la transacción;
5. la firma con una cuenta relayer común;
6. devuelve tx hash;
7. no persiste payload, IP ni user-agent en el modo demo.

Operación de carga:

- mantiene una cola única por cuenta relayer para secuenciar transaction sequence numbers;
- no dispara 500 transacciones concurrentes con el mismo sequence number;
- registra balance inicial/final y fee real;
- calcula antes de L0 el fondeo requerido para 500 tx más margen;
- ejecuta un preflight de 10 tx consecutivas para descubrir rate limits;
- usa backoff acotado e idempotency keys.

El relayer nunca recibe:

- nullifier secret;
- trapdoor;
- salt antes de que el usuario decida revelar;
- Merkle credential completa fuera del proof payload necesario.

### 8.3 Fallback y censura

- El usuario puede cambiar de relayer.
- Puede enviar directamente, aceptando menor privacidad.
- Una tx rechazada sigue siendo observable como intento en infraestructura de red, pero no produce un evento exitoso del contrato.
- El relayer no puede falsificar ni modificar public signals sin invalidar la prueba.

---

## 9. Auditoría verificable

### 9.1 Auditor R0

1. Descubre `VoteCastV1`.
2. Verifica que cada nullifier sea único por election.
3. Recupera tx/envelope e inputs desde RPC/archivo.
4. Reejecuta Groth16 off-chain con el VK manifest.
5. Comprueba roots, option count y scope.
6. Reconstruye tally.
7. Compara contra `result()`.

### 9.2 Auditor R1

Además:

1. descubre commitments;
2. verifica unicidad de nullifiers;
3. valida cada proof de commit;
4. descubre reveals;
5. recomputa Poseidon(vote, salt, scope);
6. marca non-reveals;
7. reconstruye tally solo con reveals válidos;
8. compara contra `result()`.

### 9.3 Artefactos de auditoría

- JSON schema versionado.
- Lista de tx hashes.
- VK hashes.
- contract IDs y WASM hash.
- script reproducible.
- reporte de inconsistencias con exit code no cero.
- archivo content-addressed de proof/public bytes, indexado en tiempo real por el auditor/relayer;
- hash del archivo comparado con `proof_hash`/`public_signals_hash` del evento.

La auditoría histórica no dependerá exclusivamente de la retención de un RPC público. Para la demo, el bundle se publica como artefacto de release o almacenamiento content-addressed; producción requiere un archivo independiente y redundante.

---

## 10. Estructura objetivo del repositorio

```text
.
├── Cargo.toml
├── Cargo.lock
├── rust-toolchain.toml
├── package.json
├── package-lock.json
├── README.md
├── LICENSE
├── contracts/
│   └── zk-quorum/
├── crates/
│   ├── zk/
│   ├── lean-imt/
│   └── credential/
├── circuits/
│   ├── common/
│   ├── public-vote/
│   ├── commit-vote/
│   ├── test/
│   └── artifacts/
│       └── manifests/
├── apps/
│   └── web/
├── services/
│   └── relayer/
├── tools/
│   ├── circom2soroban/
│   ├── credential-cli/
│   └── auditor/
├── scripts/
│   ├── bootstrap/
│   ├── setup/
│   ├── deploy/
│   ├── demo/
│   └── load/
├── tests/
│   ├── fixtures/
│   └── e2e/
├── docs/
│   ├── plan/
│   ├── architecture/
│   ├── audit/
│   └── evidence/
└── .github/
    └── workflows/
```

---

## 11. Sistema multiagente

### 11.1 Herramientas, modelos y routing vigente

Cambio autorizado el 2026-06-30: Qwen 3.7 Max y GLM-5.2 quedan retirados por
costo operacional observado, no por calidad. Todos los implementadores
OpenCode usan exclusivamente el provider `opencode-go`; no se usa OpenCode
Zen.

IDs confirmados por `opencode models opencode-go`:

```text
opencode-go/deepseek-v4-pro
opencode-go/kimi-k2.7-code
opencode-go/minimax-m3
opencode-go/minimax-m2.7
opencode-go/qwen3.7-plus
```

Modelos confirmados por `agy models`:

```text
Gemini 3.1 Pro (High)
Gemini 3.5 Flash (Medium)
Gemini 3.5 Flash (High)
```

GPT-5.5 con reasoning `high` fue validado mediante Codex CLI en modo efímero y
read-only. Las variantes Low de Antigravity están prohibidas.

| Herramienta/modelo | Uso | Política económica |
|---|---|---|
| Codex, esta sesión | plan, briefs, revisión y decisión de gate | no escribe código de producción |
| DeepSeek V4 Pro | circuitos, Rust/Soroban, integración ZK y debug fino | OpenCode escaso; reservar para implementación pesada |
| Kimi K2.7 Code | deshabilitado por defecto | objetivo casi cero; sólo emergencia con autorización explícita del usuario para la tarea |
| MiniMax M3 | producto, relayer, web, scripts y CI | driver principal de producto |
| MiniMax M2.7 | tests, fixtures, codemods y overflow | trabajo mecánico acotado |
| Gemini 3.5 Flash Medium/High | worker ligero y preflight | no decide gates finales |
| Gemini 3.1 Pro High | auditoría primaria de producto/security/soundness/release | auditor independiente preferido |
| Qwen 3.7 Plus | fallback read-only de auditoría | usar `opencode-go/qwen3.7-plus`; nunca Max |
| GPT-5.5 high | audit premium C1/A0 y cualquier hito con fondos | sólo sobre commits estabilizados |

### 11.2 Topología: tres lanes y auditoría independiente

No se crearán diez worktrees. La coordinación se mantiene acotada:

```text
main/integration
├── wt/crypto       DeepSeek V4 Pro
├── wt/contract     DeepSeek V4 Pro
└── wt/product      MiniMax M3 / MiniMax M2.7

auditorías read-only:
├── Codex: revisión continua y gate
├── Gemini 3.1 Pro High: auditor primario de todos los gates
├── Qwen 3.7 Plus: fallback read-only
└── GPT-5.5 high: C1/A0 premium
```

### 11.3 Ownership

`wt/crypto`:

- `circuits/**`;
- `crates/credential/**`;
- `tools/circom2soroban/**`;
- `circuits/artifacts/manifests/**`;
- tests de circuitos y golden vectors.

`wt/contract`:

- `contracts/**`;
- `crates/zk/**`;
- tipos, storage, eventos y tests del contrato.

`wt/product`:

- `apps/**`;
- `services/**`;
- `scripts/**`;
- `tools/credential-cli/**`, consumiendo `crates/credential` sin reimplementar hashes;
- `tools/auditor/**`;
- `.github/**`;
- README y docs de uso.

Integrador:

- `Cargo.toml` raíz;
- `Cargo.lock`;
- `package.json` raíz;
- `package-lock.json`;
- `.gitignore`;
- `rust-toolchain.toml`;
- este plan y su §22 de decisiones;
- merges/cherry-picks.

Codex puede inspeccionar y coordinar esos archivos, ejecutar verificaciones y
realizar integración mecánica de commits auditados. Cualquier cambio de código
de producción dentro de ellos se delega a un implementador.

### 11.4 Contrato de salida de cada agente

El protocolo operacional completo está en
`docs/internal/agent-context-protocol.md`. Cada sesión recibe un bundle mínimo
con task, worktree absoluto, commit base, ownership, cláusulas aplicables,
acceptance criteria y comandos. No recibe por defecto todos los documentos
históricos.

Cada sesión guarda logs completos en `/tmp/zkq-agent-runs/<TASK_ID>/` y termina
con una salida visible menor a 800 tokens:

```text
STATUS: done | partial | blocked
TASK_ID:
BASE_COMMIT:
COMMIT:
FILES_CHANGED:
TESTS:
LINT:
HASHES:
FINDINGS: Critical/High/Medium/Low
BLOCKERS:
REPORT_PATH:
NEXT_SAFE_STEP:
```

No se imprimen diffs ni logs completos. En éxito se reportan comando, conteo y
`PASS`; en fallo, el primer error relevante y un tail máximo de 40 líneas. No
se acepta `done` sin commit limpio, tests o evidencia explícita de por qué no
aplican.

### 11.5 Flujo de bajo consumo sin reducción de calidad

1. Un implementador produce un commit estabilizado.
2. Codex ejecuta preflight mecánico antes de consumir una auditoría.
3. Gemini 3.1 Pro High audita el delta exacto y las invariantes aplicables.
4. No se auditan worktrees sucios ni el mismo commit con dos modelos en
   paralelo.
5. Un segundo auditor sólo se abre por indisponibilidad, desacuerdo
   reproducible, Critical/High o gate premium.
6. GPT-5.5 high recibe únicamente C1/A0/fondos después de tests verdes y audit
   primario; nunca se usa para explorar una implementación inestable.
7. A0 conserva la auditoría integral. Los audits incrementales no reemplazan
   el gate final.
8. Cada integración produce un checkpoint durable y el siguiente turno parte
   de ese resumen, no del transcript completo.

### 11.6 Reglas de escalamiento

- M3 encuentra un problema ZK/Rust no mecánico: escala inmediatamente a V4 Pro.
- M3 falla una vez por comprensión multiarchivo: entrega diagnóstico y se
  replanifica con M3/M2.7 o DeepSeek según dominio.
- V4 Pro no está disponible por cuota/billing: el lane se replanifica o espera
  cuota. Kimi no es fallback automático.
- Kimi queda deshabilitado. Sólo puede abrirse si el usuario autoriza
  explícitamente una emergencia concreta; una sesión máxima y stop inmediato
  si entra en diagnóstico iterativo.
- M2.7 falla una vez por contexto: escala a M3.
- `agy` Flash Medium/High hace trabajo ligero y preflight. Gemini 3.1 Pro High
  decide el gate.
- Fallback de auditoría: Gemini 3.1 Pro High →
  `opencode-go/qwen3.7-plus` read-only. Si ambos fallan, C1/A0/fondos escalan a
  GPT-5.5 high; otros gates se bloquean. Nunca se degrada a Low.
- Un auditor no corrige el mismo diff que audita.
- Codex escribe planes/briefs y decide gates, pero no código de producción.
- Qwen 3.7 Max y GLM-5.2 no se invocan. Qwen 3.7 Plus se permite sólo como
  auditor read-only fallback.
- Hallazgo Critical/High bloquea merge/release.
- Divergencia entre auditores se resuelve con reproducción, no por votación.

### 11.7 Comandos base

Implementación OpenCode Go:

```bash
opencode run \
  --agent build \
  --model opencode-go/deepseek-v4-pro \
  --title zkq-crypto-TASK_ID \
  "Lee docs/plan/ZK-QUORUM-EXECUTION-PLAN.md y ejecuta solo TASK_ID..."
```

Trabajo de volumen:

```bash
opencode run \
  --agent build \
  --model opencode-go/minimax-m3 \
  --title zkq-product-TASK_ID \
  "Lee docs/plan/ZK-QUORUM-EXECUTION-PLAN.md y ejecuta solo TASK_ID..."
```

Fallback de implementación compleja:

```bash
opencode run \
  --agent build \
  --model opencode-go/kimi-k2.7-code \
  --title zkq-integration-TASK_ID \
  "Lee el brief congelado y ejecuta sólo TASK_ID..."
```

Worker ligero:

```bash
agy \
  --model 'Gemini 3.5 Flash (Medium)' \
  --add-dir '/ruta/absoluta/al/worktree-aislado' \
  --dangerously-skip-permissions \
  --print-timeout 900s \
  -p "Ejecuta sólo el task ligero indicado..."
```

Auditoría security/soundness:

```bash
agy \
  --model 'Gemini 3.1 Pro (High)' \
  --add-dir '/ruta/absoluta/al/worktree' \
  --print-timeout 900s \
  -p "Auditoría estrictamente read-only del commit exacto..."
```

Fallback de auditoría, sólo si Gemini 3.1 Pro High no está disponible o
rechaza:

```bash
opencode run \
  --agent plan \
  --model opencode-go/qwen3.7-plus \
  --title zkq-audit-TASK_ID \
  "Auditoría read-only del commit exacto; no edites; reporta archivo:línea..."
```

Qwen 3.7 Plus no implementa ni corrige su propio finding. Qwen 3.7 Max está
prohibido.

El worker usa un worktree aislado y necesita
`--dangerously-skip-permissions` porque print mode no puede aprobar writes de
forma interactiva. El auditor no recibe ese flag y queda read-only. Ambos usan
`--add-dir` absoluto; Codex verifica el diff antes/después. `--sandbox` queda
suspendido para repo porque la versión instalada ejecutó Git desde un scratch
incorrecto y terminó en panic; ver ledger §18.8. Se reactiva cuando una sonda
reproduzca correctamente el cwd.

Auditoría premium:

```bash
codex exec \
  -C '/ruta/absoluta/al/worktree' \
  --ephemeral \
  --sandbox read-only \
  --model gpt-5.5 \
  -c 'model_reasoning_effort="high"' \
  --output-last-message /tmp/zkq-gpt55-audit.txt \
  "Auditoría estrictamente read-only del commit exacto..."
```

Nunca usar:

```text
--dangerously-bypass-approvals-and-sandbox
```

`--dangerously-skip-permissions` sólo está permitido en `agy` para workers
ligeros, dentro de un worktree aislado y nunca durante auditorías.

---

## 12. DAG de implementación

### Gate P0 — Plan congelado

- Este documento conserva las auditorías históricas Qwen/GLM del 2026-06-29.
- El cambio de routing del 2026-06-30 se verifica con Codex + `agy`.
- Hallazgos clasificados y registrados.
- Fecha autoritativa e internal freeze registrados; la hora externa se verifica antes de S0 sin retrasar F0.

### Gate P1 — Remediation freeze

- Hallazgos Critical/High del plan resueltos o rechazados con razonamiento técnico.
- `CLAUDE.md` y `CLAUDE-MEMORY.md` reducidos a un brief coherente que apunta a este plan.
- `techs-specs-zk-quorum.md` y `zk-quorum.md` marcados como históricos donde contradigan este plan.
- Documento con checksum/commit identificable antes de lanzar agentes de implementación.
- Cero Critical/High abiertos.

### Gate F0 — Fundación reproducible

Tasks:

- `F0.1`: crear workspace y copiar componentes MIT mínimos.
- `F0.2`: atribución/licencia upstream.
- `F0.3`: pin toolchain y dependencias.
- `F0.4`: bootstrap idempotente.
- `F0.5`: instalar/verificar Stellar CLI.
- `F0.6`: CI base.
- `F0.7`: detectar `uname -s/-m`; descargar el binario Circom correcto o compilarlo; nunca bajar `linux-amd64` en macOS ARM.
- `F0.8`: checkout exacto de upstream `7b168174ae1268dab91a0190d80a94ab7ff41b59`, no `--depth 1` móvil.

Acceptance:

```text
clone limpio
→ bootstrap
→ upstream SHA exacto
→ circom --version/arquitectura correctas
→ cargo test
→ circuit compile smoke
→ web/relayer build
```

### Gate C0 — Statements y schemas

- R0/R1 Circom compilan.
- Golden vectors Poseidon y election scope.
- Golden gate obligatorio `P2(a,b)` y `P2(P2(a,b),c)` Circom ↔ Rust.
- Public schema confirmado desde `public.json`.
- R1CS info y setup power documentados.
- Negative witness tests.

### Gate K0 — Contrato unitario

- contrato compila WASM;
- VK fijo por mode;
- parse estricto;
- roots/scope/range verificados;
- nullifier per-key;
- buckets;
- TTL;
- eventos;
- tests negativos completos.

### Gate E0 — E2E local R0

```text
credential
→ trees
→ witness
→ proof
→ snarkjs verify
→ serialize
→ Soroban Env cast
→ duplicate reject
→ result
→ audit replay
```

### Gate T0 — Testnet R0

- verificar contrato heredado o redesplegar;
- deploy app;
- open election;
- cast válido;
- proof inválida;
- duplicate;
- result;
- recursos registrados.

### Gate R1 — Commit/reveal

- proof commit válida;
- vote oculto durante cast;
- reveal correcto;
- wrong salt;
- double reveal;
- non-reveal contabilizado;
- result final.

### Gate U0 — Producto

- web admin;
- web voter con proving en Web Worker;
- web audit;
- relayer;
- secretos nunca salen del cliente;
- sin analytics/logging;
- accesibilidad y manejo de errores.

### Gate U-Pre — Prover real en navegador

Antes de cerrar U0:

- ejecutar `snarkjs.groth16.fullProve` con los circuitos finales y depth 10;
- medir tiempo y peak memory en los navegadores objetivo;
- probar cancelación/error en Web Worker;
- verificar que ningún secret sale por red;
- si falla, V4 Pro diagnostica antes de cambiar arquitectura o mover el prover.

### Gate L0 — Carga

Escalera:

```text
1 → 10 → 50 → 100 → 500
```

Para cada nivel:

- proofs frescas;
- tx exitosas;
- retries/rate limits;
- latencia p50/p95;
- CPU/mem del prover;
- fee/recursos;
- distribución de tally buckets;
- auditor coincide.

El paso siguiente solo corre si el anterior es consistente.

### Gate L-Pre — Testnet y relayer

- 10 tx consecutivas con la cuenta relayer;
- sequence management correcto;
- rate limits conocidos;
- balance/fee estimado para 500 más margen;
- backoff e idempotencia probados.

### Gate A0 — Auditoría final

Gemini 3.1 Pro High:

- soundness;
- replay;
- domain separation;
- auth/privacy;
- storage mutation;
- event/audit completeness;
- R1.

Gemini 3.5 Flash High:

- build limpio;
- integración;
- testnet evidence;
- load methodology;
- docs/claims;
- release/submission.

GPT-5.5 high:

- verifier y parsing canónico;
- orden verify-before-mutate;
- invariantes de contrato y overflow;
- coherencia de remediaciones Critical/High;
- audit premium final A0.

Codex reconcilia evidencia y decide el gate; no corrige código de producción.

### Gate S0 — Submission

- tests verdes desde clon limpio;
- contrato IDs/tx hashes;
- WASM/VK hashes;
- audit report;
- README;
- limitaciones;
- video;
- links verificados;
- freeze de código con buffer.

---

## 13. Cronograma

La hora exacta del cierre del 2 de julio todavía debe registrarse. Se trabajará con un freeze interno anterior al deadline.

### 29 de junio — arquitectura y R0

- cerrar P0 y P1 antes de lanzar implementación;
- F0 foundation;
- C0 R0 statement;
- K0 skeleton/storage;
- comenzar E0.

### 30 de junio — R0 testnet y R1

- cerrar E0;
- cerrar T0;
- circuit/contract R1;
- relayer y frontend skeleton.

### 1 de julio — producto, carga y auditoría

- cerrar R1;
- cerrar U0;
- ejecutar carga escalonada hasta 500;
- auditorías `agy` High y GPT-5.5 high;
- remediación.

### 2 de julio — evidencia y entrega

- rerun limpio;
- video;
- README/submission;
- solo fixes bloqueantes;
- freeze y buffer de envío.

Si el cierre es temprano el 2 de julio, las tareas de entrega se adelantan al 1 de julio. No se elimina alcance silenciosamente: cualquier cambio queda en §22.

---

## 14. Matriz de tareas

| ID | Task | Owner | Depende | Acceptance principal |
|---|---|---|---|---|
| P0.1 | Auditar plan | histórico Qwen/GLM; vigente Codex + agy | — | hallazgos clasificados |
| P1.1 | Remediar/congelar plan | Integrador | P0.1 | sin Critical/High abiertos |
| F0.1 | Workspace/attribution | M3 + integrador | P1 | clone limpio |
| F0.2 | Toolchain/bootstrap | M3 | F0.1 | versiones verificadas |
| C0.1 | Credential/common | V4 Pro | P0 | golden vectors |
| C0.2 | R0 circuit | V4 Pro | C0.1 | positive/negative witnesses |
| C0.3 | R1 circuit | V4 Pro | C0.1 | private range + commitment |
| C0.4 | Setup/manifests | V4 Pro | C0.2/C0.3 | VK hashes reproducibles |
| K0.1 | Types/errors/config | V4 Pro | P0 | unit tests |
| K0.2 | cast R0 | V4 Pro | C0.2 | verify + dedup + bucket |
| K0.3 | cast/reveal R1 | V4 Pro | C0.3 | commit/reveal tests |
| K0.4 | TTL/events/audit summary | V4 Pro | K0.2 | storage tests |
| E0.1 | Credential/tree CLI | M3 | C0.1 | vectors match |
| E0.2 | Proof pipeline | M3 + V4 debug | C0.2 | E2E local |
| T0.1 | Deploy/invoke | M3 | E0/K0 | tx hashes |
| U0.1 | Relayer | M3 | E0.2/K0 | preverify/simulate/submit |
| U0.2 | Web admin/voter/audit | M3 + V4 integración prover | E0/T0/U-Pre | browser flow |
| L0.1 | Load harness | M3 | T0/L-Pre | 1→500 metrics |
| A0.1 | Security/soundness audit | Gemini 3.1 Pro High | R1/U0/L0 | findings |
| A0.2 | Product/release audit | Gemini 3.1 Pro High; Qwen 3.7 Plus fallback | R1/U0/L0 | findings |
| A0.3 | Premium verifier/final audit | GPT-5.5 high | A0.1/A0.2 | cero Critical/High |
| S0.1 | Docs/evidence/video | M3 + integrador | A0 | submission ready |

---

## 15. Test plan

### 15.1 Circuitos

- valid R0 for every option;
- vote == optionCount fails;
- optionCount == 0 fails;
- incorrect state path;
- incorrect ASP path;
- zero ASP bypass impossible;
- `associationRoot=0` con path inventado falla;
- `rg "backward compatibility" circuits/` no encuentra el bypass upstream;
- credential commitment JS/Rust/Circom coincide;
- incorrect scope;
- same secret/same scope → same nullifier;
- same secret/different scope → different nullifier;
- altered public vote invalidates proof;
- R1 wrong commitment;
- R1 out-of-range private vote;
- zero salt;
- Poseidon Rust/Circom golden vectors para P2 y P3 secuencial;
- serializer round-trip and public signal order.

### 15.2 Contrato

- constructor once;
- only admin opens;
- duplicate election;
- invalid roots/scope/options/timestamps;
- before open/after close;
- wrong mode/VK/schema length;
- malformed proof/public bytes returns typed error, no panic;
- root/scope/option mismatch;
- invalid proof no state changes;
- duplicate rejected;
- same credential different election accepted/unlinkable;
- nullifier key exacta `DataKey::Nullifier(election_id, nullifier_hash)`;
- bucket deterministic/distributed;
- tally overflow safe;
- R1 reveal window;
- wrong salt/commitment;
- double reveal;
- 10 commits/5 reveals reportan `non_reveal_count=5`;
- result states;
- TTL calls;
- successful events only.
- event proof/public hashes coinciden con payload.

### 15.3 Relayer

- body size/rate limits;
- off-chain verify before submit;
- invalid proof never reaches testnet;
- simulation failure;
- retry idempotency;
- no secret fields;
- logs redacted;
- submitter account common;
- alternate relay/direct mode.

### 15.4 Frontend

- secrets stay in worker/memory/local encrypted export;
- no network request during proving except selected relay submission;
- browser memory limits;
- progress/cancel/error;
- credential backup warning;
- R0 privacy warning;
- R1 reveal backup/reminder;
- accessibility.

### 15.5 Auditor

- missing tx;
- duplicate event;
- invalid proof;
- mismatched VK/WASM hash;
- wrong tally;
- R1 reveal without commit;
- non-reveal report;
- RPC pagination/retry;
- deterministic JSON/report exit codes.

---

## 16. Threat model

| Threat | Mitigation | Residual |
|---|---|---|
| doble voto | scoped nullifier + persistent key | issuer podría emitir credencial adicional |
| replay otra elección | electionScope domain-separated | replay en clone mal configurado si copia scope |
| voto no elegible | stateRoot + associationRoot | issuer/ASP es confiable |
| proof falsa | Groth16 verifier + VK fijo | trusted setup |
| modificar vote/public | public signal ligado al proof + contract check | ninguno conocido |
| correlación por cuenta | common relayer, no voter auth | IP/timing/relayer logs |
| relayer censor | múltiples relays/direct submit | direct submit reduce privacidad |
| issuer correlaciona | commitments hiding | timing/metadata |
| admin cambia root | roots inmutables post-open | admin elige roots iniciales |
| storage expiry | persistent TTL maintenance + archive | requiere operación continua |
| RPC pierde historia | archive/evidence bundle | disponibilidad externa |
| R1 no reveal | report non-reveals | tally puede sesgarse |
| coerción/receipt | no resuelto | roadmap MACI |
| malicious frontend | reproducible static build/CSP | supply chain/browser |
| setup comprometido | manifest/disclosure/multiparty future | demo setup trusted |

---

## 17. CI y reproducibilidad

Checks:

```text
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --release
stellar contract build
circom compile/tests
snarkjs verify golden fixtures
npm ci
npm test
npm run build
auditor fixture replay
license/secret scan
```

CI no regenerará Powers of Tau en cada push. Usará fixtures y verificará manifests/checksums. Un workflow manual/nightly podrá regenerar el proof pipeline.

Nunca se versionan:

- secrets;
- Stellar secret keys;
- `.env`;
- proof witness;
- salts;
- voter credential files;
- build artifacts grandes.

---

## 18. Demo y mediciones

### 18.1 Demo funcional

1. Admin carga 500 labels/commitments sintéticos.
2. Abre elección R0 o R1.
3. Voters generan proofs localmente.
4. Relayer envía.
5. Dashboard muestra confirmaciones y tally.
6. Duplicate se rechaza.
7. Auditor reconstruye y compara.

### 18.2 Evidencia de carga

El log debe contener:

- commit hash;
- tool versions;
- roots;
- contract/VK/WASM hashes;
- N solicitado/generado/enviado/aceptado;
- errores categorizados;
- tiempos;
- fees/recursos;
- tx hashes;
- bucket histogram;
- auditor diff.

No se extrapola “500” desde 50 sin etiquetarlo como extrapolación.

---

## 19. Documentación final

### README

- pitch honesto;
- propiedades;
- R0 vs R1;
- arquitectura;
- quickstart reproducible;
- testnet evidence;
- demo;
- auditor;
- load results;
- threat model;
- trusted setup disclosure;
- limitations;
- roadmap.

### Docs técnicas

- `docs/architecture/statement.md`;
- `docs/architecture/contract.md`;
- `docs/architecture/privacy.md`;
- `docs/evidence/testnet.md`;
- `docs/evidence/load.md`;
- `docs/audit/QWEN-AUDIT.md` y `docs/audit/GLM-AUDIT.md` como evidencia
  histórica del plan/commits que examinaron;
- `docs/audit/AGY-SECURITY-AUDIT.md`;
- `docs/audit/AGY-RELEASE-AUDIT.md`;
- `docs/audit/GPT55-PREMIUM-AUDIT.md`;
- `docs/audit/REMEDIATION.md`;
- §22 de este documento como registro de decisiones durante el sprint;
- `SUBMISSION.md`.

### Actualización de legacy docs

Antes del release:

- eliminar Semaphore/BN254/MSM de claims actuales;
- reemplazar “externalNullifier ya existe”;
- corregir ASP;
- corregir Rung 1;
- reemplazar “barato/500/para siempre” por medidas;
- marcar R0 como anonymous-public;
- documentar relayer.

---

## 20. Definition of done

El proyecto está terminado cuando:

1. Un clon limpio reproduce builds/tests.
2. R0 y R1 statements están documentados y auditados.
3. Proofs frescas verifican off-chain, local Soroban y testnet.
4. Nullifier está ligado a electionScope.
5. No hay voter auth en cast/reveal.
6. R0 y R1 sobreviven pruebas negativas.
7. El tally shardeado coincide con auditor.
8. TTL y archivo están documentados y probados proporcionalmente.
9. Frontend prueba localmente y usa relayer.
10. La carga de 500 tiene evidencia o el claim se retira.
11. Gemini 3.1 Pro High y GPT-5.5 high no tienen Critical/High abiertos sobre
    los commits finales; si Pro no está disponible, Qwen 3.7 Plus cubre el
    gate read-only como fallback.
12. README/video/submission solo contienen hechos demostrados.

---

## 21. Disposición histórica de auditorías del plan

Las secciones 21.1 y 21.2 registran evidencia producida el 2026-06-29. Qwen
3.7 Max y GLM-5.2 fueron retirados del routing el 2026-06-30 por costo; sus
hallazgos siguen siendo válidos para el plan que auditaron, pero no se les
asignan nuevas tareas.

### 21.1 Qwen 3.7 Max — security/soundness

| ID | Sev. auditor | Disposición | Cambio |
|---|---|---|---|
| Q-C1 | Critical | Aceptado | Se prohíbe Poseidon directo de 3 inputs; R1 usa `P2(P2(vote,salt),scope)` y golden gate. |
| Q-C2 | Critical | Aceptado | Se elimina bypass ASP y se agrega negative test explícito. |
| Q-H1 | High | Aceptado | `credential.circom` se escribe como circuito nuevo, no rename del Withdraw. |
| Q-H2 | High | Aceptado | `electionScope` ahora tiene SHA-256 + rejection sampling y encoding exacto. |
| Q-H3 | High | Aceptado | Key canónica de nullifier documentada. |
| Q-H4 | High | Aceptado | Public schema permanece provisional hasta fixture y luego se congela. |
| Q-H5 | High | Aceptado | Comparador/range constraints y casos frontera explícitos. |
| Q-M1 | Medium | Parcial | Se conserva 16 buckets y se mide histograma; no se usa un test estadístico flaky como criterio de correctness. |
| Q-M2 | Medium | Aceptado | R1 reporta commit/reveal/non-reveal counts y limitación de sesgo. |
| Q-M3 | Medium | Aceptado | Archivo content-addressed evita depender solo del RPC. |
| Q-M4 | Medium | Aceptado | `salt != 0` se implementa con IsZero/inverse y negative witness. |
| Q-M5 | Medium | Aceptado | Phase 2/zkey contribute explícito. |
| Q-M6 | Medium | Aceptado con ajuste | TTL permissionless sigue permitido, pero parámetros se acotan a política/red. |
| Q-L1 | Low | Aceptado | Profundidad 10 sujeta a medición de constraints/prover. |
| Q-L2 | Low | Aceptado | MAX_OPTIONS se declara circuito-versioned. |
| Q-L3 | Low | Aceptado | Eventos incluyen proof/public hashes. |
| Q-L4 | Low | Aceptado como diseño | Reveal permissionless es intencional; no cambia el resultado. |
| Q-L5 | Low | Aceptado | Claims hablan de distribución de contention y throughput medido, no paralelismo ilimitado. |

### 21.2 GLM-5.2 — arquitectura/release

| ID | Sev. auditor | Disposición | Cambio |
|---|---|---|---|
| G-C1 | Critical | Superseded por instrucción del usuario | La fecha autoritativa es 2026-07-02; hora externa pendiente; freeze interno 2026-07-01 20:00 CLT. |
| G-C2 | Critical | Procedimental | El plan se debe committear antes de lanzar agentes de implementación; no se hizo commit automático durante planificación. |
| G-H1 | High | Aceptado | Se agrega P1 remediation freeze. |
| G-H2 | High | Aceptado | Legacy docs se neutralizan en P1, no al final. |
| G-H3 | High | Rechazado parcialmente | R1 sí debe recomputar o usar segunda prueba. Se mantiene recomputación, pero con P2 secuencial y golden gate. La prohibición se limita a host/configuración no validada. |
| G-H4 | High | Aceptado | Exact pins, upstream SHA y builds reales en F0. |
| G-H5 | High | Aceptado | Bootstrap detecta plataforma y fija commit. |
| G-H6 | High | Aceptado | U-Pre valida prover browser; V4 interviene si falla. |
| G-H7 | High | Aceptado | L-Pre cubre fondeo, sequences y rate limit. |
| G-M1 | Medium | Aceptado | Test de bypass ASP explícito. |
| G-M2 | Medium | Aceptado | `.gitignore` se endurece en F0. |
| G-M3 | Medium | Aceptado | Relayer depende de proof pipeline E0.2. |
| G-M4 | Medium | Rechazado | `result()` no itera pending commitments; usa tally buckets y counts actualizados en reveal. Se aclaró el diseño. |
| G-M5 | Medium | Aceptado | Auditorías finales usan `--agent plan`, no fallback `explore→build`. |
| G-M6 | Medium | Parcial | Routing porcentual queda como política, tasks/owners son enforcement real. |

### 21.3 Estado de P1

Estado registrado al cerrar la auditoría histórica del plan:

- Critical/High de soundness: remediados en especificación.
- Critical de deadline: resuelto por instrucción explícita del usuario.
- Critical de versionado: pendiente de commit intencional, no de cambio técnico.
- En ese momento la implementación aún no se había iniciado; el estado vigente
  está en `docs/plan/OPEN-CODE-EXECUTION-LOG.md`.

---

## 22. Registro de decisiones congeladas

| ID | Decisión | Razón | Cambio requiere |
|---|---|---|---|
| D-001 | Deadline operativo 2026-07-02; freeze 2026-07-01 20:00 CLT | Instrucción del usuario + buffer | usuario/integrador |
| D-002 | BLS12-381/Groth16/privacy-pools como referencia | spike probado | auditoría + nuevo spike |
| D-003 | Circuitos de ballot nuevos; no rename semántico de Withdraw | statement diferente | Gemini 3.1 Pro High + GPT-5.5 high + re-setup |
| D-004 | Nullifier `P2(secret, electionScope)` | unlinkability y anti-replay | auditoría de soundness |
| D-005 | Scope SHA-256 con rejection sampling | encoding canónico sin reducción silenciosa | golden vectors + auditoría |
| D-006 | ASP obligatorio y sin zero bypass | elegibilidad load-bearing | auditoría |
| D-007 | R1 `P2(P2(vote,salt),scope)` | evitar aridad 3 inconsistente | golden gate + re-setup |
| D-008 | Sin voter auth; relayer común | privacidad frente al ledger | threat-model review |
| D-009 | 16 tally buckets | reducir contention con result acotado | benchmark + auditoría |
| D-010 | Proofs fuera de storage, hashes en eventos y archivo content-addressed | costo + auditoría histórica | arquitectura/auditoría |
| D-011 | Tres implementation lanes | minimizar coordinación | integrador |
| D-012 | Auditores externos operan read-only y no corrigen su propio diff | independencia del gate | usuario |
| D-013 | Qwen 3.7 Max y GLM-5.2 retirados; Kimi casi cero; Gemini 3.1 Pro High audita, Qwen 3.7 Plus es fallback y GPT-5.5 high queda premium | costo operacional observado | usuario |

---

## Anexo A — Registro de consola y comprobaciones

### A.1 Inventario

```bash
pwd
git status --short --branch
git log --oneline --decorate -12
git ls-files | sort
find . -maxdepth 3 -type f | sort
du -sh . spike/soroban-examples spike/node_modules
```

Resultados relevantes:

```text
cwd=/Volumes/MacMiniExt/dev/web3/zk-quorum/zk-quorum
main...origin/main
2 untracked package files
2 commits
repo total ~1.3 GiB debido a artefactos ignorados
```

### A.2 Tests

```bash
cd spike/soroban-examples/privacy-pools/contract
cargo test --release

cd spike/soroban-examples/groth16_verifier
cargo test --release
```

Resultados:

```text
privacy-pools: 9 passed
groth16_verifier: 1 passed
```

### A.3 Toolchain

```bash
rustc --version
cargo --version
node --version
npm --version
spike/circom --version
rustup target list --installed
stellar --version
opencode --version
```

Resultados relevantes:

```text
rustc/cargo 1.96.0
node 22.23.1
npm 10.9.8
circom 2.2.3
wasm32v1-none installed
stellar command not found
opencode 1.17.11
```

### A.4 OpenCode Go, Antigravity y GPT-5.5

```bash
opencode models opencode-go
opencode agent list
opencode stats
agy models
```

Modelos usados por este plan:

```text
opencode-go/minimax-m3
opencode-go/minimax-m2.7
opencode-go/deepseek-v4-pro
opencode-go/kimi-k2.7-code
opencode-go/qwen3.7-plus
Gemini 3.5 Flash (Medium)
Gemini 3.5 Flash (High)
Gemini 3.1 Pro (High)
gpt-5.5 / reasoning high
```

Agentes primarios existentes:

```text
build
plan
```

`explore` y `general` están configurados como subagents; invocarlos directamente
con `opencode run --agent explore` hace fallback a `build`. OpenCode Go se usa
para implementación salvo la excepción read-only
`opencode-go/qwen3.7-plus`, que es fallback de auditoría. Los auditores
primarios usan `agy --add-dir <path-absoluto>` sin permisos de escritura;
Codex CLI usa `--sandbox read-only`. El `--sandbox` de `agy 1.0.14` permanece
suspendido por el bug de cwd documentado en el ledger.

### A.5 Auditorías iniciales OpenCode — registro histórico

Sesión DeepSeek V4 Pro:

```text
title: zkq-plan-technical-audit
mode: solicitado read-only; OpenCode hizo fallback de explore a build
hallazgos útiles:
  nullifier no scoped
  falta ballot signal
  ASP requiere semántica explícita
  TTL/setup/serialización deben planificarse
```

Correcciones aplicadas sobre su informe:

```text
label no se considera voter ID
cast no autentica al votante
no se hardcodean TTLs de red
no se guardan proofs en audit()
eventos fallidos no persisten
R1 es circuito/flujo separado
```

Sesión MiniMax M3:

```text
title: zkq-plan-program-audit
mode: solicitado read-only; OpenCode hizo fallback de explore a build
hallazgos útiles:
  routing costo-beneficio
  ownership y gates
  auditoría dual
  necesidad de reproducibilidad y submission evidence
```

Correcciones aplicadas:

```text
10 worktrees reducidos a 3 lanes
no se usan números absolutos especulativos de llamadas/costo
no se crean owners solapados para contract/src/test.rs
el auditor premium no integra código rutinario
500 votos es target medido, no claim asumido
```

Sesión Qwen 3.7 Max:

```text
title: zkq-plan-security-audit-final
mode: plan (read-only)
resultado:
  2 Critical, 5 High, 6 Medium, 5 Low
  hallazgo principal: aridad Poseidon 3 contradictoria en upstream
  disposición completa: §21.1
```

Sesión GLM-5.2:

```text
title: zkq-plan-release-audit-final
mode: plan (read-only)
resultado:
  2 Critical, 7 High, 6 Medium, 5 Low
  hallazgos principales: legacy auto-cargado, bootstrap no portable,
  browser prover sin validar y carga sin preflight operacional
  disposición completa: §21.2
```

### A.6 SDK TTL verificado localmente

Fuente:

```text
~/.cargo/registry/src/.../soroban-sdk-25.1.0/src/storage.rs
```

API confirmada:

```rust
Persistent::extend_ttl(&key, threshold, extend_to)
Instance::extend_ttl(threshold, extend_to)
```

La API define TTL en ledgers, no una duración fija en horas/días.

---

## Anexo B — Prompt contractual de implementación

```text
Lee completamente:
1. docs/plan/ZK-QUORUM-EXECUTION-PLAN.md
2. CLAUDE.md
3. spike/SPIKE-RESULTS.md

TASK_ID: <id>
OWNED_PATHS: <paths>
READ_ONLY_PATHS: <paths>
FORBIDDEN_PATHS: <paths>

No cambies stack, schema, public signal order, API o threat model.
Si detectas una contradicción, detente y entrega evidencia; no la resuelvas
reinterpretando el diseño.

Antes de editar:
- confirma estado Git;
- enumera archivos a tocar;
- enumera tests que demostrarán el resultado.

Al terminar devuelve:
STATUS, TASK_ID, BRANCH, COMMIT, FILES_CHANGED, TESTS_RUN, TEST_RESULTS,
ASSUMPTIONS, KNOWN_LIMITATIONS, BLOCKERS, NEXT_SAFE_STEP.
```

## Anexo C — Prompt Gemini 3.1 Pro High

```text
Auditoría estrictamente read-only.
No edites ni crees archivos.
Ataca:
- soundness de R0/R1;
- binding de public signals;
- scoped nullifier y replay;
- ASP/credential issuance;
- relayer/auth/privacy;
- storage/TTL/events;
- tally buckets;
- trusted setup;
- auditoría y claims.

Clasifica Critical/High/Medium/Low.
Cada hallazgo debe incluir evidencia, exploit/failure mode, remediation y test.
Separa bug comprobado de hipótesis.
```

## Anexo D — Prompt Gemini 3.5 Flash High

```text
Auditoría estrictamente read-only.
No edites ni crees archivos.
Evalúa:
- coherencia del plan y DAG;
- dependencias y ownership;
- reproducibilidad;
- integración Circom/Rust/Soroban/web/relayer;
- testnet/load methodology;
- gates y cronograma al 2026-07-02;
- documentación y submission truthfulness.

Busca decisiones que causen rework tardío.
Clasifica Critical/High/Medium/Low y propone gates verificables.
```

## Anexo E — Prompt GPT-5.5 high

```text
Auditoría premium estrictamente read-only del commit exacto indicado.
No edites, no crees archivos y no uses resultados de otro auditor como
autoridad. Reproduce o inspecciona:
- parsing canónico BLS12-381 Fr y rechazo de valores >= r;
- verifier Groth16 positivo y negativos;
- orden verify-before-mutate;
- overflow/underflow y storage invariants;
- binding de VK, public signals, roots y electionScope;
- auth/privacy y relayer;
- ausencia de tests ignored, mocks aceptantes y artefactos no reproducibles.

Clasifica Critical/High/Medium/Low. Para cada hallazgo incluye archivo/línea,
failure mode, reproducción, remediación mínima y test de aceptación. Termina
con MERGE o DO NOT MERGE y justifica el gate.
```
