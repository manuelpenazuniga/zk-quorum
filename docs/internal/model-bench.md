# Routing multiagente v4 — costo/beneficio operativo

**Vigente desde:** 2026-07-01

**Ámbito:** ZK-Quorum y referencia para repos Rust/Web3
**Autoridad específica de ZK-Quorum:** `docs/plan/ZK-QUORUM-EXECUTION-PLAN.md`

## 1. Cambio de política

Qwen 3.7 Max y GLM-5.2 quedan retirados del routing. La causa es costo
operacional observado —una cuenta consumida en un día—, no una evaluación
negativa de su calidad. No se usan como implementación, auditoría, fallback ni
desempate.

Qwen 3.7 Plus es un modelo distinto y queda autorizado exclusivamente como
fallback de auditoría read-only cuando Gemini 3.1 Pro High no esté disponible
o rechace la tarea. Kimi K2.7 Code queda deshabilitado por defecto: su objetivo
de consumo es casi cero y requiere autorización explícita del usuario por
emergencia.

Todos los modelos OpenCode se invocan exclusivamente mediante el provider
`opencode-go`. No se usa OpenCode Zen ni IDs `opencode/...`.

La arquitectura vigente separa cuatro funciones:

| Función | Herramienta | Economía |
|---|---|---|
| Plan, briefs, revisión y decisión de gate | Codex, esta sesión | no escribe código de producción |
| Implementación pesada | OpenCode Go | cuota por ventana de 5 h; reservar para cambios reales |
| Worker ligero y auditoría independiente | `agy` / Antigravity CLI | plan generoso; absorbe lectura, tests y auditorías |
| Auditoría premium | GPT-5.5 high por Codex CLI | reservar para hitos críticos y cualquier flujo con fondos |

## 2. Inventario verificado localmente

Comprobado nuevamente el 2026-07-01 con `opencode models opencode-go`:

```text
opencode-go/deepseek-v4-pro
opencode-go/kimi-k2.7-code
opencode-go/minimax-m3
opencode-go/minimax-m2.7
opencode-go/qwen3.7-plus
```

OpenCode Go también publica `opencode-go/qwen3.7-max`; queda expresamente
prohibido. `opencode-go/qwen3.7-plus` sólo audita y nunca implementa.

Comprobado con `agy models`:

```text
Gemini 3.1 Pro (High)
Gemini 3.5 Flash (Medium)
Gemini 3.5 Flash (High)
```

`agy` también lista variantes Low. Están prohibidas para este proyecto porque
la reducción de calidad no compensa el ahorro.

Comprobado con una sesión efímera y read-only de Codex CLI:

```text
model: gpt-5.5
reasoning effort: high
sandbox: read-only
resultado: GPT-5.5 HIGH CLI AVAILABLE
```

## 3. Router de implementación — OpenCode Go

| Modelo | Primario | Fallback permitido | No asignar |
|---|---|---|---|
| DeepSeek V4 Pro | Circom, primitivas ZK, Rust/Soroban, bugs de soundness y serialización | esperar cuota o replanificar | docs rutinarias, auditoría final |
| Kimi K2.7 Code | deshabilitado por defecto | sólo emergencia autorizada explícitamente por el usuario | routing automático, auditoría, trabajo rutinario |
| MiniMax M3 | TypeScript/Node, relayer, web, scripts, CI, integración de producto | MiniMax M2.7 para partes mecánicas; replanificar lo complejo | decisión de gate |
| MiniMax M2.7 | tests mecánicos, fixtures, codemods y overflow de M3 | M3 si falla una vez por comprensión del sistema | criptografía o contrato crítico |

Distribución inicial de la cuota OpenCode, ajustable por carga real:

| Pool | Objetivo |
|---|---:|
| DeepSeek V4 Pro | 35–50% |
| MiniMax M3 | 30–40% |
| MiniMax M2.7 | 15–25% |
| Kimi K2.7 Code | 0% por defecto; excepción explícita fuera del presupuesto normal |

Los porcentajes son límites de routing, no garantías del proveedor. La métrica
de valor es:

```text
valor = gates cerrados con tests / llamadas OpenCode consumidas
```

No se optimiza por cantidad de texto ni por número de archivos modificados.

## 4. Router de `agy`

| Modelo | Uso |
|---|---|
| Gemini 3.5 Flash Medium | inventario, clasificación, lectura cruzada, actualización de tests no críticos y verificación documental |
| Gemini 3.5 Flash High | preflight, revisión documental y trabajo ligero; no decide el gate final |
| Gemini 3.1 Pro High | auditor primario de producto, arquitectura, security/soundness, ZK/Soroban y release |

Reglas:

1. `agy` puede implementar sólo trabajo ligero claramente delimitado.
2. Un auditor `agy` no corrige el mismo diff que audita.
3. Flash Medium/High no emite el gate final; el gate usa Gemini 3.1 Pro High.
4. Pro High debe clasificar Critical/High/Medium/Low y adjuntar evidencia
   reproducible.
5. Low no se usa.

Fallbacks:

```text
Gemini 3.1 Pro High no disponible/rechaza
  -> opencode-go/qwen3.7-plus read-only
Qwen 3.7 Plus no disponible
  -> GPT-5.5 high sólo para C1/A0/fondos;
     en cualquier otro gate, queda bloqueado
```

No se degrada a Low para mantener throughput.

## 5. GPT-5.5 high

GPT-5.5 high es auditor premium read-only. Se invoca:

- obligatoriamente para cualquier cambio que custodie, transfiera o autorice
  fondos;
- en ZK-Quorum para el cierre del verifier/contrato C1 y el gate final A0;
- cuando Codex y Gemini 3.1 Pro High discrepen sobre un Critical/High;
- una vez que los workers ya corrigieron hallazgos conocidos, nunca como
  sustituto de lint/tests básicos.

Comando validado:

```bash
codex exec \
  -C '/ruta/absoluta/al/worktree' \
  --ephemeral \
  --sandbox read-only \
  --model gpt-5.5 \
  -c 'model_reasoning_effort="high"' \
  --output-last-message /tmp/zkq-gpt55-audit.txt \
  "<prompt de auditoría>"
```

Si el modelo deja de estar disponible por CLI, se usa el mismo prompt en una
consola GPT-5.5 high separada y se registra manualmente session ID, fecha,
commit auditado y respuesta íntegra.

## 6. Comandos de referencia

Implementación pesada:

```bash
opencode run \
  --agent build \
  --model opencode-go/deepseek-v4-pro \
  --title zkq-crypto-TASK_ID \
  "<brief cerrado, paths, acceptance y tests>"
```

```bash
opencode run \
  --agent build \
  --model opencode-go/kimi-k2.7-code \
  --title zkq-integration-TASK_ID \
  "<brief cerrado, paths, acceptance y tests>"
```

```bash
opencode run \
  --agent build \
  --model opencode-go/minimax-m3 \
  --title zkq-product-TASK_ID \
  "<brief cerrado, paths, acceptance y tests>"
```

Worker ligero:

```bash
agy \
  --model 'Gemini 3.5 Flash (Medium)' \
  --add-dir '/ruta/absoluta/al/worktree-aislado' \
  --dangerously-skip-permissions \
  --print-timeout 900s \
  -p "<task acotado>"
```

Auditoría:

```bash
agy \
  --model 'Gemini 3.1 Pro (High)' \
  --add-dir '/ruta/absoluta/al/worktree' \
  --print-timeout 900s \
  -p "<auditoría estrictamente read-only del commit exacto>"
```

Fallback read-only cuando Gemini 3.1 Pro High no esté disponible o rechace:

```bash
opencode run \
  --agent plan \
  --model opencode-go/qwen3.7-plus \
  --title zkq-audit-TASK_ID \
  "<brief read-only; commit exacto; findings con archivo:línea; no editar>"
```

Codex compara `git status` y `git diff` antes/después. Qwen 3.7 Plus no recibe
permisos de implementación y nunca se sustituye por Qwen 3.7 Max.

Comprobado con `agy 1.0.14`:

- `-p`, `--print` y `--prompt` son alias de print mode;
- `--add-dir` debe recibir el worktree mediante path absoluto;
- un worker no puede aprobar escrituras interactivamente en print mode, por lo
  que sólo el worker aislado recibe `--dangerously-skip-permissions`;
- un auditor nunca recibe ese flag: las lecturas del `--add-dir` se permiten y
  las escrituras quedan denegadas;
- se usa `900s` por defecto para evitar resultados truncados.

En la versión observada el 2026-06-30, `--sandbox` ejecutó `git` desde el
directorio scratch de Antigravity y terminó en panic al buscar un worktree
inexistente. Se omite temporalmente para trabajo de repo, se exige worktree
aislado al worker y Codex compara `git status/diff` antes y después de toda
invocación. Se reactiva sólo cuando una sonda confirme el cwd correcto.

Nunca se usa `--dangerously-bypass-approvals-and-sandbox`. El permiso amplio
propio de `agy`, `--dangerously-skip-permissions`, se limita exclusivamente a
workers ligeros sobre worktrees aislados.

## 7. Escalamiento y gates

```text
trabajo ligero
  -> Gemini 3.5 Flash Medium

implementación producto
  -> MiniMax M3
  -> MiniMax M2.7 para correcciones mecánicas
  -> sin Kimi por defecto

implementación Rust/ZK
  -> DeepSeek V4 Pro
  -> esperar cuota o replanificar si V4 no está disponible
  -> Kimi sólo con autorización explícita del usuario para una emergencia

auditoría general
  -> Gemini 3.1 Pro High
  -> Qwen 3.7 Plus read-only como fallback

auditoría security/soundness
  -> Gemini 3.1 Pro High
  -> Qwen 3.7 Plus read-only como fallback

gate crítico C1/A0 o fondos
  -> Codex revisa evidencia
  -> GPT-5.5 high read-only
```

Un modelo que falla por cuota, billing o disponibilidad no se deja esperando:
se registra el error literal y se enruta al fallback. Un modelo que falla por
razonamiento entrega diagnóstico y diff parcial antes del cambio de owner.

Ningún modelo aprueba su propio trabajo. Critical/High abiertos bloquean merge.
La divergencia se resuelve reproduciendo el fallo, no votando entre modelos.

## 8. Criterio de costo/beneficio

OpenCode Go es el recurso escaso. No debe consumir llamadas en:

- inventarios que `rg`, tests o `agy` pueden producir;
- redacción de planes o prompts;
- reauditar un commit sin cambios;
- esperar una cuota agotada;
- corregir estilo antes de cerrar correctness.

`agy` absorbe lectura masiva, auditorías intermedias y trabajo mecánico. Codex
mantiene el estado, escribe briefs, revisa outputs y decide gates sin escribir
código de producción. GPT-5.5 high recibe sólo diffs estabilizados y evidencia
completa.

### 8.1 Controles obligatorios de contexto

- salida visible por agente menor a 800 tokens;
- logs completos en `/tmp/zkq-agent-runs/<TASK_ID>/`;
- éxito resumido como comando, conteo, hashes y `PASS`;
- fallo resumido con primer error y tail máximo de 40 líneas;
- no imprimir diffs completos;
- no auditar worktrees sucios;
- un auditor primario por commit;
- auditoría incremental durante desarrollo y revisión integral en A0;
- checkpoint después de cada gate.

El formato y ciclo exactos están congelados en
`docs/internal/agent-context-protocol.md`.

## 9. Modelos retirados

| Modelo | Estado | Motivo |
|---|---|---|
| Qwen 3.7 Max | retirado | costo operativo: agotó la cuenta demasiado rápido |
| GLM-5.2 | retirado | costo operativo: agotó la cuenta demasiado rápido |

Sus auditorías históricas siguen siendo evidencia válida del commit que
examinaron. No autorizan nuevas llamadas ni forman parte del routing vigente.
