# T0 — R0 real en Stellar testnet

Fecha de inicio: 2026-07-02 19:05:03 America/Santiago  
Base: `main@767725e`  
Gates previos: C0, C1, E0 y U-Pre Chromium cerrados  
Cutoff externo: fecha 2026-07-02; hora exacta no informada

## 1. Objetivo

Ejecutar una elección R0 completa sobre Stellar testnet con los WASM y assets
auditados:

```text
build limpio
→ deploy groth16-verifier
→ deploy zk-quorum con constructor real
→ electionScope ligado al contract ID testnet
→ open_election
→ proof fresca R0
→ cast válido
→ proof criptográficamente inválida con nullifier fresco
→ duplicate
→ result/audit/eventos
→ evidencia pública reproducible
```

T0 usa invocación directa por Stellar CLI. No mezcla el scaffold del relayer,
no afirma que el relayer productivo esté listo y no despliega el frontend.

## 2. Red, identidad y límites

- Red: `testnet`.
- Passphrase exacta: `Test SDF Network ; September 2015`.
- RPC configurado por Stellar CLI; registrar URL efectiva sin headers secretos.
- Stellar CLI: 27.0.0.
- Source/admin/relayer común: identidad local `zkq-t0-20260702`, guardada en
  macOS Keychain.
- Address público observado:
  `GCWZZEAFBUN2S2WOV5FFBX4QVRA7AORQLMUHJDCIMZZCO24YDXVTLDAG`.
- Saldo inicial observado: `10000.0000000` XLM testnet.
- `vv-e2e2` queda como respaldo; no usar dos sources en una misma corrida.
- `vv-testnet` fue eliminado del almacén local después de que un worker
  ejecutara indebidamente `stellar keys show`; se considera comprometido y
  queda prohibido reutilizarlo.
- Nunca imprimir/exportar seed ni secret key. Los logs deben fallar si aparece
  un StrKey secreto `S...`.
- Quedan explícitamente prohibidos `stellar keys show`, `stellar keys export`,
  lectura de archivos de identidad y cualquier comando que revele material
  secreto. Solo se permiten `stellar keys address` y `stellar keys ls`.
- No usar mainnet, fondos reales, wallet del votante ni analytics.
- Kimi K2.7 Code: deshabilitado.

## 3. Artefactos congelados

El runner debe ejecutar `scripts/build-verifier-first.sh` y fijar:

```text
groth16_verifier.wasm
SHA-256 d6f6bb12d2e8f88ab34b076ef8800c8ea53c0e504ea8c85269b6cb6b75fa94ab

zk_quorum.wasm
SHA-256 b9c6b42bafd7f1fe5b01884593793b804d0a88ed6be01eabab94c34fa0508c30
```

Setup C0:

```text
r0_final.zkey
SHA-256 519cc5cb6f34227da36c0a11b75e7b684a3f2e85109b36e8485ea5adbd8330d1
```

Generar `vk_r0.bin` y `vk_r1.bin` con `tools/circom2soroban`; calcular sus
SHA-256 y pasar esos hashes exactos al constructor. Nunca suministrar una VK
desde el caller de `cast`.

## 4. Preflight obligatorio

Un comando `scripts/run-t0-testnet-r0.sh --prepare-only` debe:

1. exigir Node 24, Rust 1.96, Circom 2.2.3, snarkjs 0.7.6, Stellar CLI 27 y
   target `wasm32v1-none`;
2. exigir `network=testnet` y rechazar mainnet/passphrase distinta;
3. resolver únicamente el address público de `zkq-t0-20260702`;
4. consultar ledger/RPC y balance público;
5. descargar/verificar assets C0;
6. ejecutar verifier-first desde limpio;
7. comparar hashes WASM esperados;
8. generar VK bins y validar hashes/formato;
9. crear `tmp/t0/` limpio sin secretos;
10. no enviar transacciones.

El modo con escritura externa debe ser explícito: `--execute`. Sin ese flag,
el script no despliega ni invoca.

## 5. Deploy

### 5.1 Verifier

- Consultar primero el contrato histórico
  `CACFO5YAVIUZYINQTFDVHE5GBLYJ7ALQERA7AXB235KMWBIPHRRKZ57M`.
- Registrar si existe y su WASM hash; no reutilizarlo salvo igualdad exacta con
  el hash congelado y prueba explícita de interfaz compatible.
- Por reproducibilidad T0 puede desplegar una instancia nueva del verifier
  auditado.
- Capturar contract ID, install/deploy transaction hash, ledger y costo.
- Confirmar on-chain WASM hash igual al local.

### 5.2 ZK-Quorum

Desplegar una instancia nueva con constructor:

```text
admin       = address público zkq-t0-20260702
verifier    = contract ID verifier T0
vk_r0       = raw tmp/t0/vk_r0.bin
vk_r1       = raw tmp/t0/vk_r1.bin
vk_r0_hash  = SHA-256(vk_r0.bin), 32 bytes
vk_r1_hash  = SHA-256(vk_r1.bin), 32 bytes
```

Para `Bytes`/`BytesN`, usar flags `--<arg>-file-path` y contenido binario raw,
no argumentos hex enormes. Esta variante está documentada oficialmente por
Stellar CLI.

Capturar contract ID, tx hash, ledger, costo y confirmar:

- WASM hash on-chain = local;
- `get_admin` = address esperado;
- `get_verifier` = verifier T0.

## 6. Elección y scope

Crear un election ID aleatorio de 32 bytes y persistir solo sus bytes públicos.
Decodificar el contract StrKey a sus 32 bytes (`stellar strkey decode`).

Calcular:

```text
SHA-256(
  u32BE(len("zk-quorum:election-scope:v1")) || tag ||
  u32BE(len(network_passphrase))            || network_passphrase ||
  u32BE(32)                                 || contract_id_bytes ||
  u32BE(32)                                 || election_id_bytes
)
```

Aplicar rejection sampling a BLS12-381 Fr exactamente como
`packages/protocol/src/scope.ts`; prohibido reducir módulo.

Usar los roots depth 10 de la fixture R0 auditada, option count 5 y timestamps
derivados del ledger testnet actual:

```text
opens_at         <= ledger timestamp actual
closes_at        >= actual + 3600
reveal_closes_at = 0
mode             = R0
```

`open_election` requiere auth del mismo admin `zkq-t0-20260702`. Capturar tx/costo y
leer `get_election` para comparar todos los campos.

## 7. Proof y serialización

1. Construir input desde `r0-vote-0.json`, reemplazando solo
   `electionScope` por el scope testnet derivado.
2. Compilar circuit R0 desde limpio y verificar R1CS hash.
3. Generar witness y proof fresca con `r0_final.zkey`.
4. `snarkjs groth16 verify` debe pasar.
5. Convertir proof/public a bytes Soroban con el conversor Rust auditado.
6. Confirmar 384 bytes de proof y 196 bytes de public signals.
7. Registrar hashes de proof/public JSON y binarios.

## 8. Secuencia de invocaciones

### 8.1 Cast válido

- Invocar `cast` con raw `proof.bin` y `public.bin`.
- Capturar tx hash, ledger y recursos.
- Confirmar `is_nullifier_used=true`.
- Confirmar tally total exactamente 1 en opción 0.
- Capturar `VoteCastV1` y comparar election ID, nullifier, vote, bucket,
  schema y hashes proof/public.

### 8.2 Proof inválida, nullifier fresco

- Copiar A sobre C en proof bytes para conservar un punto estructuralmente
  válido pero una ecuación Groth16 inválida.
- Mutar canónicamente el nullifier public signal para que no choque con el
  usado.
- La invocación debe fallar con `ProofVerificationFailed`.
- El tx no debe producir evento exitoso.
- El nullifier mutado debe seguir sin usar.
- Tally y result deben permanecer idénticos.

### 8.3 Duplicate

- Repetir la proof/public válida.
- Debe fallar con `NullifierAlreadyUsed`.
- Sin nuevo evento exitoso ni mutación de tally/result.

### 8.4 Resultado

- `result`: `[1,0,0,0,0]`, commit/reveal/non-reveal en cero.
- `audit_summary`: roots/scope/mode/options/status coherentes.
- Consultar eventos desde el ledger inicial T0; exactamente un
  `VoteCastV1` exitoso para la elección.

## 9. Evidencia

Generada bajo `tmp/t0/` (ignorada):

```text
manifest.json
commands.json
transactions.json
contracts.json
costs.json
events.json
proof.json
public.json
vk_r0.bin / vk_r1.bin
proof.bin / public.bin
negative-results.json
final-state.json
replay.json
```

El manifest usa keys/tipos exactos, SHA-256 de cada artefacto y liga:

```text
network/passphrase
source public address
start/end ledger
contract IDs
WASM/VK hashes
election ID/scope/roots
tx hashes
proof/public hashes
```

Crear después `docs/evidence/testnet.md` solo con evidencia pública y
limitaciones. No versionar proofs/VKs binarios ni logs crudos.

## 10. Replay fail-closed

`scripts/replay-t0-testnet-r0.*` debe:

- validar schemas exactos y hashes;
- volver a consultar contract hashes, election, result y audit summary;
- consultar tx hashes/eventos por RPC;
- comparar estado remoto con manifest;
- ejecutar snarkjs verify local;
- rechazar evidencia faltante, extra o alterada;
- fallar si encuentra secret StrKeys o campos privados.

## 11. Acceptance gate

```text
prepare-only: PASS
historical verifier disposition: documented
verifier deploy/hash: PASS
zk-quorum deploy/constructor/hash: PASS
scope testnet/domain: PASS
open election: PASS
fresh proof/snarkjs: PASS
valid cast/event/tally: PASS
invalid proof fresh-nullifier/no mutation: PASS
duplicate/no mutation: PASS
result/audit: PASS
replay remoto+local: PASS
Gemini 3.1 Pro High: 0 Critical/High
```

T0 no se cierra por obtener contract IDs solamente. Cualquier `|| true`,
expected failure sin comprobar discriminante, hash auto-referencial o ausencia
de replay mantiene el gate en `NO-PASA`.

## 12. Routing

- Codex: brief, preflight, revisión, integración y gate.
- OpenCode Go MiniMax M3: script/CLI/evidencia inicial.
- DeepSeek V4 Pro: fallback para encoding, Soroban/RPC o debugging complejo.
- MiniMax M2.7: tests mecánicos después de estabilizar.
- Gemini 3.1 Pro High: auditor final read-only.
- GPT-5.5 high: no se usa en T0 salvo que aparezcan fondos reales o cambios al
  verifier/contrato auditado.
- Kimi K2.7 Code: no usar.
