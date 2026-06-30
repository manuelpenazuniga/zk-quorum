# ZK-Quorum — ledger de ejecución multiagente

**Documento:** registro operativo complementario de
`docs/plan/ZK-QUORUM-EXECUTION-PLAN.md`  
**Zona horaria:** America/Santiago  
**Inicio de ejecución:** 2026-06-29  
**Deadline interpretado:** 2026-07-02, America/Santiago  
**Política:** append-only; una prueba en curso no se registra como aprobada

## 1. Propósito y reglas de evidencia

Este archivo preserva lo que de otro modo quedaría solamente en la consola:

- asignación de modelos y sesiones OpenCode;
- ramas, worktrees y commits;
- comandos ejecutados y resultados observados;
- hallazgos de auditoría y su disposición;
- decisiones del integrador;
- preguntas abiertas, diferenciando bloqueantes de no bloqueantes;
- gates aprobados, rechazados y pendientes.

Un resultado se marca:

- `VERIFICADO`: el integrador observó el comando y su salida;
- `AGENTE`: reportado por un agente, pendiente de repetición independiente;
- `AUDITORÍA`: hallazgo read-only de Qwen o GLM;
- `EN CURSO`: proceso activo, sin aceptación;
- `RECHAZADO`: no satisface el gate;
- `PENDIENTE`: todavía no ejecutado.

No se acepta como evidencia:

- una afirmación en un mensaje de commit sin script versionado;
- una prueba positiva marcada `#[ignore]`;
- un adapter mock como sustituto de una integración real;
- un test ejecutado con una versión distinta de la fijada;
- un árbol de trabajo sucio como entregable integrable.

## 2. Autorización y límites

El usuario autorizó explícitamente:

1. enviar el contenido de este repositorio a los modelos OpenCode indicados;
2. usar un sistema multiagente para implementación y auditoría;
3. usar MiniMax M3 para volumen de trabajo;
4. usar DeepSeek V4 Pro para Rust, ZK y depuración profunda;
5. reservar Qwen 3.7 Max y GLM-5.2 para auditoría;
6. trabajar sin recortes funcionales por cuota antes del deadline.

Se preservan como cambios ajenos al trabajo:

```text
?? spike/package.json
?? spike/package-lock.json
```

No deben borrarse, modificarse ni incluirse accidentalmente en un commit.

## 3. Routing costo/beneficio aplicado

| Rol | Modelo | Uso real | Estado |
|---|---|---|---|
| Orquestación e integración | Codex | gates, revisión, decisiones y merge | activo |
| Producto Node/TypeScript | MiniMax M3 | protocolo, relayer, auditor, web | activo |
| Circuitos/Rust ZK | DeepSeek V4 Pro | Circom, credential y vectores | activo |
| Contrato Soroban/Rust | DeepSeek V4 Pro | verifier, contrato y tests | activo |
| Auditoría de seguridad | Qwen 3.7 Max | plan, producto, circuitos y contrato | read-only |
| Auditoría de release | GLM-5.2 | arquitectura e integración final | pendiente del cierre de lanes |

Qwen y GLM no integran ni editan código. Los cambios de producto se devuelven a
M3; los cambios Rust/ZK se devuelven a DeepSeek V4 Pro.

## 4. Estado base y commits

Estado observado el 2026-06-29 09:37:30 -04:

```text
main:             c2b0389
agent/crypto:     9b96da1
agent/contract:   8191ab2
agent/product:    37c7ad4
```

Commits de planificación y foundation:

```text
f04f134 docs: freeze audited execution plan
6796f27 build: add reproducible project foundation
873ab73 build: reserve isolated lane manifests
4d45e73 build: require Stellar CLI 27 in foundation checks
8191ab2 build: keep agent worktrees inside workspace
c2b0389 build: exclude nested agent worktrees from workspace
```

Commits de lanes existentes:

```text
9b96da1 feat(crypto): implement ballot circuits and vectors
37c7ad4 feat(product): scaffold relayer web and auditor
```

Ninguna lane se ha integrado a `main`.

## 5. Worktrees

Comando:

```bash
git worktree list --porcelain
```

Resultado relevante:

```text
worktree .../zk-quorum
branch refs/heads/main

worktree .../zk-quorum/.worktrees/contract
branch refs/heads/agent/contract

worktree .../zk-quorum/.worktrees/crypto
branch refs/heads/agent/crypto

worktree .../zk-quorum/.worktrees/product
branch refs/heads/agent/product
```

Las rutas `.worktrees/` y `.bootstrap/` están ignoradas. Cada agente tiene
ownership de su lane. No se permiten ediciones cruzadas.

## 6. Foundation reproducible

Versiones fijadas:

```text
Node.js:            24.x
Rust/Cargo:         1.96.0
Circom:             2.2.3
snarkjs:            0.7.6
Stellar CLI:        27.x
soroban-sdk:        25.1.0
soroban-poseidon:   25.0.0
```

Resultados ya verificados:

```text
bootstrap inicial:   completado
bootstrap repetido:  no-op
verify foundation:   0 hard failures, 0 soft failures
```

Correcciones realizadas durante foundation:

- se elevó el requisito de Stellar CLI a major 27;
- los worktrees se movieron dentro del workspace;
- el workspace Cargo excluye los worktrees anidados;
- las fuentes upstream necesarias se copiaron a `.bootstrap/reference` para
  auditoría reproducible sin permisos externos.

## 7. Sesiones OpenCode

Sesiones relevantes observadas:

```text
ses_0ec98d312ffeKCtgGFjj3U96K1  zkq-U0-product-skeleton/remediation
ses_0ec724ec7ffev31u1FEvHSmvNo  zkq-crypto-qwen-audit
ses_0ec716809ffeEWz1wOlqVf3uoU  zkq-contract-qwen-audit
ses_0ec848f9fffegbJL0FARazB5Yv  zkq-C0-crypto-final/remediation
ses_0ec85a542ffe6wC5ZGFpQeJek5  zkq-C1-contract-final/remediation
ses_0ec7e5cc6ffes1GYrjeCaNQhF3  zkq-product-qwen-audit
```

Procesos activos al corte de este registro:

```text
MiniMax M3       producto: remediación integrador antes de commit
DeepSeek V4 Pro  crypto: remediación de auditoría Qwen
DeepSeek V4 Pro  contrato: remediación de auditoría Qwen
```

## 8. Lane crypto — evidencia antes de remediación

Commit auditado:

```text
9b96da1 feat(crypto): implement ballot circuits and vectors
```

Métricas R1CS reportadas y observadas:

```text
R0:
  non-linear constraints: 5,613
  linear constraints:     8,839
  total:                 14,452

R1:
  non-linear constraints: 6,094
  linear constraints:     9,607
  total:                 15,701
```

Orden congelado de señales:

```text
R0 [
  nullifierHash,
  vote,
  optionCount,
  stateRoot,
  associationRoot,
  electionScope
]

R1 [
  nullifierHash,
  ballotCommitment,
  optionCount,
  stateRoot,
  associationRoot,
  electionScope
]
```

Vectores Poseidon Circom/Rust que coincidieron:

```text
P2(1,2)
  28821147804331559602169231704816259064962739503761913593647409715501647586810

P3seq(1,2,3)
  25449209717923527142952704227728043701726876483169650107300041471510623667078

P2(0,0)
  51576823595707970152643159819788304363803754756066229172775779360774743019614

P2(1234567890,9876543210)
  27771607038322859082949799815786464601077828110800763259574488164592802051706

credentialCommitment(111,222,333)
  33380155885179640208912473019492003279421010499170178573196933234221612903872
```

Rust reportó:

```text
cargo test:                  12 passed
cargo check:                 passed
cargo clippy -D warnings:    passed
```

Problema de evidencia detectado por el integrador:

```text
?? scripts/build-test-fixtures.js
?? scripts/test-witness.js
```

Los 9 witness tests reportados no eran reproducibles desde Git porque sus
scripts no estaban en el commit. Además, la primera ejecución se hizo bajo
Node 22, no Node 24. Por eso Gate C0 quedó `RECHAZADO`.

## 9. Auditoría Qwen 3.7 Max — crypto

Resultado read-only:

```text
Critical: 0
High:     3
Medium:   5
Low:      4
```

Conclusión:

```text
Circuit soundness: sin defectos encontrados por inspección.
Merge: condicional; no integrar antes de remediar High.
```

High:

1. el commit afirma compatibilidad `no_std`, pero el crate usa
   `std::vec::Vec` y no declara `#![no_std]`;
2. los scripts de witness están sin trackear;
3. los golden vectors carecen de un tercer engine independiente.

Medium:

1. manifests con métricas R1CS `TBD`;
2. `setup_power: 14` sin justificación documentada;
3. `Cargo.lock` raíz vacío y sin trackear;
4. clonación del mensaje de scope en cada intento, aceptable sólo por ser
   tooling;
5. los fixtures usan un scope sintético y no ejercitan la derivación real.

Verificación de soundness reportada por Qwen:

- credential commitment coincide con la fórmula congelada;
- nullifier scoped coincide con la fórmula congelada;
- ambos Merkle paths están restringidos;
- `associationRoot = 0` no crea bypass;
- `optionCount` queda en `[1,16]`;
- `vote < optionCount`;
- `salt != 0` en R1;
- no se encontraron señales unconstrained;
- los negativos fallan por restricciones reales, no por el harness.

Remediación asignada a DeepSeek V4 Pro:

- crate `no_std` real con build WASM;
- versionar y endurecer ambos scripts;
- recompilación limpia bajo Node 24.2.0;
- tercer engine Poseidon BigInt;
- manifests sin `TBD`, hashes y métricas reales;
- setup power mínimo justificado;
- tres vectores literales de `electionScope`;
- al menos un witness que use scope derivado;
- no incluir el `Cargo.lock` raíz vacío.

Estado: `EN CURSO`.

## 10. Lane contrato — evidencia antes de remediación

Resultados observados:

```text
contracts/zk-quorum:
  44 passed, 0 failed, 0 ignored

crates/zk:
  9 passed, 0 failed, 1 ignored
```

La prueba ignorada era:

```text
test test::test_valid_proof ... ignored
```

El fixture local mezclaba:

- `alpha` de `test_with_hardcoded_vk`;
- `beta`, `delta` e IC de otro fixture;
- un proof no correspondiente;
- un solo public signal.

Esto explica el `false`: no es evidencia de incompatibilidad del host BLS.
Gate contractual quedó `RECHAZADO`.

## 11. Auditoría Qwen 3.7 Max — contrato

Resultado read-only:

```text
Critical: 3
High:     5
Medium:   6
Low:      4
Merge:    DO NOT MERGE
```

Critical:

1. no existe prueba Groth16 positiva ejecutada;
2. el contrato viola la arquitectura congelada al verificar localmente en vez
   de usar `contractimport!` y la dirección almacenada;
3. `recompute_ballot_commitment` puede panicar con salt/scope no canónicos.

High:

1. un ballot commitment R1 duplicado puede sobrescribir estado pendiente;
2. el hash de VK se almacena, pero no se vincula a los bytes usados;
3. `ElectionStatus` queda stale;
4. reveal no rechaza salt cero;
5. los eventos omiten `public_schema_version`.

Medium:

1. extensión TTL innecesaria de claves ausentes R0;
2. `fr_to_u32` enmascara con `unwrap_or(0)`;
3. tally bucket enmascara con `unwrap_or(0)`;
4. counters commit/reveal de R0 son semánticamente ambiguos;
5. VK con `ic_len = 0` llega a una ruta de pánico;
6. public signals no rechazan escalares no canónicos `>= r`.

Remediación asignada a DeepSeek V4 Pro:

- contrato verifier separado;
- `contractimport!` real y llamada cross-contract;
- build ordenado y reproducible sin commitear WASM;
- fixture upstream positivo exacto, sin `#[ignore]`;
- checks `0 < scalar < r` y errores tipados;
- rechazo de ballot commitment duplicado antes de mutar;
- binding SHA-256 de VK;
- status derivado del ledger;
- versión de schema en eventos;
- contadores/tallies con overflow tipado;
- cero `unwrap`/`expect`/`panic` en producción;
- prueba cross-contract positiva sin mock.

Estado: `EN CURSO`.

## 12. Lane producto — scaffold y primera auditoría

Commit inicial:

```text
37c7ad4 feat(product): scaffold relayer web and auditor
```

Resultado inicial reportado:

```text
protocol:  42 tests
relayer:   58 tests
auditor:   19 tests
web:       10 tests
evidence:   8 tests
```

Qwen 3.7 Max rechazó el merge por:

- modulus equivocado;
- botones HTML permanentemente disabled por presencia del atributo;
- rate limit vinculado al idempotency key;
- fallback R1 al bucket cero;
- replay inconsistente tras error;
- hashes inventados en reveal;
- JSON no canónico;
- byte extra en election scope;
- mocks aceptantes en el arranque de producción;
- auditor noop capaz de declarar `ok: true`.

Después de la primera remediación M3 se observaron:

```text
protocol:  58 passed
relayer:   80 passed
auditor:   30 passed
web:       12 passed
evidence:   8 passed
```

Y build TypeScript/Vite limpio en los cinco paquetes. Estos resultados todavía
no constituyen aceptación porque la revisión del integrador encontró:

1. public signals mezclaban decimal de snarkjs con hex de protocolo;
2. el límite HTTP no imponía el count exacto del schema;
3. producción importaba validators desde `mockAdapters`;
4. seguían existiendo hashes placeholder;
5. payload/event validation del auditor era incompleta;
6. se destruía el socket antes de escribir el 413;
7. `@types/node` quedó en major 22 para runtime Node 24;
8. `clientTag` se registraba innecesariamente.

Disposición congelada por el integrador:

- wire format de public signals: decimal unsigned canónico;
- cada señal debe estar en `[0,r)`;
- no se permiten ceros a la izquierda salvo `"0"`;
- conversión a `0x` de 32 bytes sólo dentro del parser;
- requests con discriminator `action` explícito;
- allowlist exacta de keys;
- reveal sin payload hash no verificable;
- CastResponse rechazado usa hashes null, nunca cero inventado;
- tx hash canónico `0x` + 64 hex minúsculo;
- producción no importa módulos mock;
- body excedido responde 413 observable y cierra la conexión después.

Estado: segunda remediación M3 `EN CURSO`. Después corresponde re-audit Qwen.

## 13. Vectores interoperables congelados

### 13.1 Election scope

Vector A:

```text
network:  Test SDF Network ; September 2015
contract: 0x11 repetido 32 bytes
election: 0x22 repetido 32 bytes
message length: 140 bytes
counter:  0
scope:    0x0b667e4a71d35199a50ec46d35ad8112c97537ed9cba84eebbc51080106130a8
```

Vector B:

```text
network:  Public Global Stellar Network ; September 2015
contract: 0xaa repetido 32 bytes
election: 0xbb repetido 32 bytes
counter:  1
scope:    0x1a2d555082335dcf53d47a6e31cbdb1076a1c1f41d5ceca38421a55b01f4abb2
```

Vector C:

```text
network:  Test SDF Network ; September 2015
contract: 0x01 repetido 32 bytes
election: 0xff repetido 32 bytes
counter:  3
scope:    0x3042d22d781a4aa3b7cc9cd7d903ccf84d0de242657dbe616b181b6d09a4382c
```

### 13.2 Mensaje exacto

```text
u32BE(len(domain)) || UTF8("zk-quorum:election-scope:v1") ||
u32BE(len(network)) || UTF8(network) ||
u32BE(32) || raw_contract_id_32 ||
u32BE(32) || raw_election_id_32 ||
counter_u8
```

No existe byte adicional de versión. Se aceptan counters `0..=255`. El digest
es válido sólo si `0 < digest < r`.

## 14. Preguntas abiertas

### 14.1 Bloqueantes ahora

```text
Ninguna.
```

Las fórmulas, schemas, routing de modelos, lanes y gates de remediación están
suficientemente definidos para continuar.

### 14.2 No bloqueantes hasta despliegue

1. hora exacta del deadline del 2026-07-02;
2. cuenta, operador y hosting final del relayer;
3. política institucional frente a no-reveal R1;
4. política de retención del archivo off-chain;
5. URLs finales de explorer/submission.

Supuestos operativos mientras no se indique otra cosa:

- deadline: cierre del 2026-07-02 en America/Santiago;
- relayer: fail-closed sin credenciales/configuración real;
- no-reveal: se informa y audita, no se inventa penalidad on-chain;
- contenido privado: minimización y no logs de IP/credential/salt/proof.

## 15. Próximos gates

| Gate | Requisito | Estado |
|---|---|---|
| C0 | circuitos reproducibles, manifests completos, Node 24, no_std, tercer engine | EN CURSO |
| C1 | verifier positivo, contractimport, checks canónicos, eventos y state seguros | EN CURSO |
| U0 | protocolo/relayer/auditor coherentes y re-audit Qwen limpio | EN CURSO |
| I0 | integración de las tres lanes y tests root | PENDIENTE |
| Z0 | setup, proofs reales R0/R1 y contract bindings | PENDIENTE |
| T0 | despliegue testnet y relayer configurado | PENDIENTE |
| A0 | Qwen security + GLM release sin Critical/High | PENDIENTE |
| E0 | evidencia reproducible, load, submission y claims | PENDIENTE |

## 16. Criterio de merge

No se integra una lane si ocurre cualquiera de estos casos:

- Critical o High abierto;
- test ignorado;
- test positivo sustituido por mock;
- dependencia o toolchain fuera de pin;
- script de reproducción sin versionar;
- build que depende de un artefacto no generado por el flujo documentado;
- código de producción con adapters aceptantes por defecto;
- representación pública ambigua;
- working tree con archivos propios sin clasificar.

La integración se hará commit por commit, con repetición independiente de
tests desde el integrador y auditoría premium sólo después de corregir los
hallazgos de workers.

## 17. Recuperación de sesión y cuota — 2026-06-30

La sesión del integrador terminó inesperadamente después de lanzar tres
remediaciones frescas. Git, los worktrees y la base local de OpenCode
permitieron reconstruir el estado sin inferencias.

### 17.1 Causa confirmada

El log local de OpenCode contiene, para MiniMax M3 y DeepSeek V4 Pro:

```text
AI_APICallError: 5-hour usage limit reached.
Resets in 3hr 51min.
```

Los reintentos posteriores redujeron el contador hasta `3hr 43min`. No fue un
deadlock del repositorio ni una tarea de razonamiento larga.

Sesiones afectadas:

```text
ses_0ec63d39dffe7tLQXM2DxssGeB  crypto / DeepSeek V4 Pro
ses_0ec63920dffe39ACoSkQMFOEv5  contract / DeepSeek V4 Pro
ses_0ec63336dffeVWVkALuSoMi5Px  product / MiniMax M3
```

La base local confirmó para las tres respuestas:

```text
cost:             0
tokens.input:     0
tokens.output:    0
tokens.reasoning: 0
tool calls:       0
```

Por tanto, esas sesiones sólo conservan el prompt. No contienen trabajo
parcial que deba recuperarse o reconciliarse.

### 17.2 Estado durable recuperado

```text
main:             53a7612 antes de corregir CLAUDE*
agent/crypto:     9b96da1 + scripts witness untracked
agent/contract:   implementación completa sin commit
agent/product:    37c7ad4 + remediación M3 sin commit
```

No apareció ningún commit nuevo ni cambio de archivo posterior al corte por
cuota. Los cambios no commiteados previos permanecieron intactos.

El integrador corrigió `CLAUDE.md` y `CLAUDE-MEMORY.md`, que todavía afirmaban
que no existía producto versionado y que Stellar CLI estaba ausente:

```text
4ff0473 docs: recover current multi-agent state
```

### 17.3 Sincronización de documentación en worktrees

Los worktrees habían sido creados antes del ledger y de la corrección de
`CLAUDE*`. Antes de reanudar se interrumpieron las primeras sesiones del
30/06, todavía read-only, y se incorporaron a cada rama únicamente estos tres
commits documentales:

```text
14c7c95 docs: add multi-agent execution ledger
53a7612 docs: link execution ledger from master plan
4ff0473 docs: recover current multi-agent state
```

Esto evita que los agentes implementen contra el estado histórico. Al integrar
las lanes a `main` se cherry-pickeará sólo el commit funcional final de cada
lane; los equivalentes documentales ya existen en `main`.

### 17.4 Reanudación

Después del reset de cuota se relanzaron sesiones frescas:

```text
product:  MiniMax M3
contract: DeepSeek V4 Pro
crypto:   DeepSeek V4 Pro
```

La cuota quedó operativa: los tres modelos comenzaron lecturas y tool calls.
Los gates y ownership no cambiaron.
