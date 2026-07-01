# Protocolo de contexto y costo para agentes

Este documento operacional complementa
`docs/plan/ZK-QUORUM-EXECUTION-PLAN.md`. No modifica ningún gate técnico:
reduce relecturas, duplicación de auditorías y logs enviados al orquestador.

## 1. Invariantes de calidad

- No se elimina ningún test, auditoría, modelo de gate ni criterio de aceptación.
- Critical/High continúa bloqueando integración y release.
- El auditor sigue siendo independiente del implementador.
- A0 conserva una revisión integral del repositorio.
- GPT-5.5 high continúa reservado para C1/A0/fondos, pero sólo recibe commits
  estabilizados que ya pasaron tests y la auditoría primaria.
- Kimi continúa deshabilitado salvo autorización explícita del usuario.

## 2. Ciclo obligatorio de una tarea

1. Codex crea un brief acotado con `TASK_ID`, commit base, owner, archivos
   permitidos, acceptance criteria y comandos de validación.
2. Un solo implementador trabaja hasta producir un commit limpio o un blocker
   reproducible. No se auditan estados intermedios ni worktrees sucios.
3. El integrador ejecuta el preflight mecánico: `git status --short`,
   `git diff --check`, pins y el script de gate.
4. Gemini 3.1 Pro High audita el commit exacto contra su padre o base declarada.
   Recibe el diff, las cláusulas aplicables y el resumen de evidencia; no una
   copia indiscriminada de todos los documentos históricos.
5. Si el auditor encuentra Critical/High, el mismo implementador recibe un
   brief de remediación. El auditor no corrige su propio finding.
6. Tras un resultado limpio, Codex decide el gate, integra mecánicamente y crea
   un checkpoint documental.
7. La revisión integral se repite en A0; el uso de deltas durante desarrollo no
   sustituye el audit final.

No se ejecutan dos auditorías del mismo commit en paralelo. Un segundo auditor
sólo se abre por indisponibilidad, desacuerdo técnico reproducible,
Critical/High o un gate premium expresamente definido.

## 3. Bundle mínimo de entrada

Todo prompt de agente debe contener o apuntar únicamente a:

```text
TASK_ID
ROLE
WORKTREE_ABSOLUTO
BASE_COMMIT
TARGET_COMMIT, si es auditoría
ARCHIVOS_PERMITIDOS
CLÁUSULAS_DEL_PLAN_APLICABLES
ACCEPTANCE_CRITERIA
COMANDOS_DE_VALIDACIÓN
PROHIBICIONES
```

El agente puede abrir archivos adicionales cuando una referencia concreta lo
requiera, pero no debe hacer inventarios completos ni releer todo el
repositorio por defecto.

## 4. Evidencia y límite de consola

Los logs completos se conservan fuera del chat en
`/tmp/zkq-agent-runs/<TASK_ID>/`. Sólo la evidencia final que forme parte del
release se copia posteriormente a una ruta versionada.

La salida visible de una sesión debe ser menor a 800 tokens y usar:

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

Reglas:

- no imprimir diffs completos;
- no imprimir logs completos de compilación o tests;
- en éxito, reportar comando, conteo y `PASS`;
- en fallo, reportar el comando, primer error relevante y un tail máximo de
  40 líneas;
- guardar el informe detallado en `REPORT_PATH`;
- no repetir contexto ya incluido en el brief;
- no declarar `done` sin commit limpio y evidencia.

Codex limita además la captura de cada sondeo de consola. Los procesos largos
se consultan espaciadamente y no se relanzan sólo por ausencia de output.

## 5. Routing económico

```text
ZK/Rust/Soroban complejo      -> DeepSeek V4 Pro
producto                      -> MiniMax M3
tests/codemods mecánicos      -> MiniMax M2.7
worker/preflight ligero       -> Gemini 3.5 Flash Medium/High
gate primario                 -> Gemini 3.1 Pro High
fallback read-only            -> Qwen 3.7 Plus
premium C1/A0/fondos          -> GPT-5.5 high
Kimi                          -> 0 por defecto
```

GPT-5.5 no recibe un repositorio en evolución: sólo el commit final, los
hallazgos previos, invariantes críticas y evidencia verde. Qwen 3.7 Max,
GLM-5.2 y variantes Low siguen prohibidos.

## 6. Secuencia y checkpoints

La ruta crítica vigente es:

```text
C0 reproducible
→ audit/integración C1
→ integración C0
→ E0 local
→ U-Pre
→ T0/R1
→ L0
→ A0
→ S0
```

Sólo se paralelizan tareas realmente independientes y con ownership disjunto.
Después de cada gate se registra:

- commit integrado;
- comandos y conteos;
- veredicto y findings;
- blocker o siguiente paso;
- estado limpio de los worktrees.

El turno siguiente parte de ese checkpoint y no de transcripts completos.
