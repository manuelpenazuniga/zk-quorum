# Brief C0-REPRO-2 — assets inmutables y gate limpio

## Contrato de tarea

```text
TASK_ID: C0-REPRO-2
ROLE: implementador ZK
MODEL: opencode-go/deepseek-v4-pro
WORKTREE: /Volumes/MacMiniExt/dev/web3/zk-quorum/zk-quorum/.worktrees/crypto
BASE_COMMIT: 0a71316
OWNER: circuits/**, crates/credential/**, scripts ZK y manifests C0
REMOTE_WRITES: prohibidos; Codex publica assets después
```

`BASE_COMMIT` identifica el inicio del diff funcional; no es una orden de
reset. El worktree puede contener commits documentales posteriores. Está
prohibido ejecutar `git reset`, `git checkout`, `git restore`, rebase o borrar
commits. También está prohibido abrir subagentes: el implementador debe leer y
editar directamente sólo los archivos necesarios.

Autoridad técnica:

- `docs/plan/ZK-QUORUM-EXECUTION-PLAN.md`: §3, §5, §6, Gate C0 y §15.1.
- `docs/internal/agent-context-protocol.md`.

## Problema reproducido

Gemini 3.1 Pro High rechazó `0a71316`:

```text
Critical: 1
High:     3
Medium:   1
Low:      1
```

1. El setup genera ptau/zkeys/VKs distintos y sobrescribe la verdad
   versionada. Registrar un hash no hace reproducible el gate.
2. Los assets correspondientes a los hashes declarados no existen localmente
   ni en una URL inmutable.
3. `run-all-tests.sh` borra outputs y no recrea todos los directorios.
4. `gate-c0.js` depende de archivos temporales ignorados.
5. Los negativos aceptan excepciones operacionales arbitrarias como PASS.
6. `check-setup-reproducibility.js` rompe argumentos `-n=...`.
7. Manifests conservan Node 22 y drift de hashes.
8. El circuito debe rechazar `nullifierSecret == 0`, con negativos R0/R1.

## Diseño obligatorio

- Una ceremonia dev/hackathon genera una vez:
  `pot14_final.ptau`, `r0_final.zkey`, `r1_final.zkey`.
- No usar entropía determinista pública ni registrar secretos de contribución.
- Los tres archivos permanecen ignorados y se entregan a Codex con path,
  bytes y SHA-256. No se commitean.
- URL default estable:
  `https://github.com/manuelpenazuniga/zk-quorum/releases/download/c0-setup-v1/<file>`.
- Añadir un fetch idempotente, atómico y fail-closed que verifique nombre,
  tamaño y SHA-256 antes de instalar assets.
- Permitir override `ZKQ_SETUP_BASE_URL` para validar contra un directorio/HTTP
  local, sin debilitar el default de release.
- El gate desde clon limpio descarga/verifica assets; nunca regenera setup ni
  sobrescribe VK/manifests.
- La ceremonia one-shot queda separada del gate reproducible.
- Los VK exportados de esos zkeys se convierten en la única verdad versionada.
- Los manifests registran Node 24, hashes/bytes reales, comandos exactos,
  release URL y frontera de reproducibilidad correcta.
- Los negativos sólo pasan por el error esperado de constraint/proof; errores
  de archivo, spawn, parse, toolchain o I/O deben fallar el gate.
- Corregir creación de directorios y quoting/argument arrays.
- Eliminar el `Cargo.lock` raíz no rastreado si sólo es un artefacto generado.

## Acceptance

```text
Node 24 exacto
Circom 2.2.3
snarkjs 0.7.6
Rust 1.96
git diff --check
run-all-tests desde build limpio
gate-c0 usando assets verificados
verify-manifests
setup/prove/verify BLS12-381 R0 y R1
proof/public mutations negativas explícitas
nullifierSecret=0 negativo R0 y R1
ningún test ignorado
worktree limpio y commit único
```

Si la URL default todavía no existe, valida con
`ZKQ_SETUP_BASE_URL=file://...`, crea un commit estable y termina `partial`
indicando exclusivamente los assets que Codex debe publicar. No intentes
publicar, crear releases, hacer push ni cambiar remotes.

## Salida

Menos de 800 tokens, sin diffs ni logs completos:

```text
STATUS:
TASK_ID:
BASE_COMMIT:
COMMIT:
FILES_CHANGED:
TESTS:
LINT:
ASSETS: path | bytes | sha256
FINDINGS_REMEDIATED:
BLOCKERS:
REPORT_PATH:
NEXT_SAFE_STEP:
```

Logs completos: `/tmp/zkq-agent-runs/C0-REPRO-2/`.
