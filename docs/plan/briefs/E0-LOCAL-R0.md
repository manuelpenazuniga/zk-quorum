# Brief E0-LOCAL-R0 — proof real hasta Soroban Env

## Contrato de tarea

```text
TASK_ID: E0-LOCAL-R0
ROLE: implementador de integración ZK/Rust
MODEL: opencode-go/deepseek-v4-pro
WORKTREE: /Volumes/MacMiniExt/dev/web3/zk-quorum/zk-quorum/.worktrees/integration-e0
BASE_COMMIT: c97ee7b
OWNER: tools/circom2soroban/**, tests/e2e/**, scripts E0 y cambios mínimos
       de integración en contracts/**/Cargo.toml o root metadata
REMOTE_WRITES: prohibidos
```

No ejecutar `git reset`, `checkout`, `restore` ni rebase. No abrir subagentes.
No implementar testnet, UI, R1 ni refactors fuera de E0.

Autoridad:

- `docs/plan/ZK-QUORUM-EXECUTION-PLAN.md`: §5, §6.2, §7, Gate E0 y §15.
- `docs/internal/agent-context-protocol.md`.
- upstream únicamente
  `stellar/soroban-examples@7b168174ae1268dab91a0190d80a94ab7ff41b59`.

## Objetivo exacto

Probar de extremo a extremo, sin mocks:

```text
credential/trees fixture
→ witness R0
→ Groth16 proof BLS12-381 con r0_final.zkey
→ snarkjs verify con r0_vk.json
→ conversión canónica Soroban
→ Groth16VerifierContract real
→ ZkQuorumContract::cast
→ duplicate reject sin mutación
→ tally/result/eventos
→ replay verificable
```

## Requisitos

### 1. Conversor

Crear `tools/circom2soroban` con lockfile y tests. Debe convertir:

- snarkjs VK JSON → bytes `VerificationKey` de `crates/zk`;
- snarkjs proof JSON → bytes `Proof`;
- `public.json` → bytes `PublicSignals`.

Formato:

```text
VK: alpha G1(48) | beta G2(96) | gamma G2(96) | delta G2(96)
    | ic_len u32 BE | IC[i] G1(48)
proof: A G1(48) | B G2(96) | C G1(48)
public: len u32 BE | Fr[i] 32-byte BE
```

No asumir orden de limbs G2 ni flags de compresión. Comparar con el helper
upstream fijado y añadir round-trips conocidos contra `crates/zk`. Rechazar:

- coordenadas fuera de campo;
- puntos inválidos/no-on-curve;
- infinity donde no corresponda;
- Fr no canónico;
- señales con cantidad incorrecta;
- JSON malformado o campos extra ambiguos.

### 2. Runner reproducible

Crear `scripts/run-e0-local.sh` fail-fast que:

1. exige Node 24, Circom 2.2.3, snarkjs 0.7.6 y Rust 1.96;
2. usa `scripts/fetch-setup-assets.js` con la URL pública default;
3. compila circuitos/build fixtures desde limpio;
4. genera witness/proof/public R0 con el zkey final;
5. ejecuta `snarkjs groth16 verify`;
6. genera bytes canónicos mediante el conversor;
7. construye verifier-first;
8. ejecuta la integración Soroban Env;
9. genera un resumen/hashes pequeño.

Puede usar `ZKQ_CIRCOM_BIN`; nunca depende de un path oculto no documentado.
Los outputs van a `tmp/e0/` y permanecen ignorados.

### 3. Integración Soroban Env

Crear un test/runner Rust aislado que registre implementaciones reales:

- `Groth16VerifierContract`;
- `ZkQuorumContract`.

Inicializar el contrato con los bytes/hashes finales de VK R0/R1. Abrir una
elección R0 usando exactamente `stateRoot`, `associationRoot`,
`electionScope`, `optionCount` del `public.json`. Ejecutar:

- cast válido con proof real;
- nullifier marcado;
- tally exacto y `result`;
- evento con hashes correctos;
- segundo cast idéntico rechazado como duplicate sin cambiar tally;
- proof mutada rechazada sin cambiar nullifier/tally/eventos.

No usar fixtures c=33, identity points, verifier mock, static accept ni bypass.

### 4. Replay

Guardar un bundle mínimo bajo `tmp/e0/evidence/` con:

- proof/public JSON originales;
- proof/public bytes canónicos;
- SHA-256;
- roots/scope/election ID;
- resultado y evento observado.

Un comando independiente debe repetir `snarkjs verify` y comprobar hashes,
nullifier único y tally. Este replay cierra E0; el wiring definitivo del
auditor U0 puede consumirlo después.

## Acceptance

```text
git diff --check
node --check scripts JS nuevos/modificados
cargo fmt --check
cargo clippy -D warnings
cargo test del conversor
build-verifier-first PASS
run-e0-local.sh desde tmp limpio PASS
positive real proof PASS
invalid proof reject sin mutación
duplicate reject sin mutación
replay PASS
ningún test ignored
worktree limpio y commit único
```

## Salida

Menos de 800 tokens, sin diffs/logs:

```text
STATUS:
TASK_ID:
BASE_COMMIT:
COMMIT:
FILES_CHANGED:
TESTS:
HASHES:
E0_RESULT:
BLOCKERS:
REPORT_PATH: .agent-runs/E0-LOCAL-R0/
NEXT_SAFE_STEP:
```
