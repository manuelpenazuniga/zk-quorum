# Routing multiagente v3 — costo/beneficio operativo

**Vigente desde:** 2026-06-30

**Ámbito:** ZK-Quorum y referencia para repos Rust/Web3
**Autoridad específica de ZK-Quorum:** `docs/plan/ZK-QUORUM-EXECUTION-PLAN.md`

## 1. Cambio de política

Qwen 3.7 Max y GLM-5.2 quedan retirados del routing. La causa es costo
operacional observado —una cuenta consumida en un día—, no una evaluación
negativa de su calidad. No se usan como implementación, auditoría, fallback ni
desempate.

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

Comprobado el 2026-06-30 con `opencode models opencode-go`:

```text
opencode-go/deepseek-v4-pro
opencode-go/kimi-k2.7-code
opencode-go/minimax-m3
opencode-go/minimax-m2.7
```

OpenCode Go también publica otros modelos, pero no pertenecen al router
congelado de ZK-Quorum.

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
| DeepSeek V4 Pro | Circom, primitivas ZK, Rust/Soroban, bugs de soundness y serialización | Kimi K2.7 Code cuando V4 Pro no esté disponible | docs rutinarias, auditoría final |
| Kimi K2.7 Code | implementación multiarchivo compleja, integración contract/prover, remediación precisa con tests | DeepSeek V4 Pro para ZK/Rust fino; M3 para producto | auditoría de su propio código |
| MiniMax M3 | TypeScript/Node, relayer, web, scripts, CI, integración de producto | Kimi K2.7 Code si el cambio cruza varias capas difíciles | decisión de gate |
| MiniMax M2.7 | tests mecánicos, fixtures, codemods y overflow de M3 | M3 si falla una vez por comprensión del sistema | criptografía o contrato crítico |

Distribución inicial de la cuota OpenCode, ajustable por carga real:

| Pool | Objetivo |
|---|---:|
| MiniMax M3 | 35–45% |
| DeepSeek V4 Pro | 25–35% |
| Kimi K2.7 Code | 10–20% |
| MiniMax M2.7 | 10–15% |

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
| Gemini 3.5 Flash High | auditoría amplia de producto, CI, release, privacidad operacional y coherencia de evidencias |
| Gemini 3.1 Pro High | auditoría de arquitectura, security/soundness, ZK/Soroban y arbitraje técnico basado en reproducción |

Reglas:

1. `agy` puede implementar sólo trabajo ligero claramente delimitado.
2. Un auditor `agy` no corrige el mismo diff que audita.
3. Medium no emite el gate final de crypto/contract.
4. High debe clasificar Critical/High/Medium/Low y adjuntar evidencia
   reproducible.
5. Low no se usa.

Fallbacks:

```text
Flash Medium no disponible -> Flash High
Flash High no disponible   -> Gemini 3.1 Pro High
Pro High no disponible     -> GPT-5.5 high sólo para C1/A0/fondos;
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
codex --ask-for-approval never exec \
  --ephemeral \
  --sandbox read-only \
  --model gpt-5.5 \
  -c 'model_reasoning_effort="high"' \
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
agy --prompt "<task acotado>" \
  --model 'Gemini 3.5 Flash (Medium)' \
  --sandbox \
  --print-timeout 5m
```

Auditoría:

```bash
agy --prompt "<auditoría estrictamente read-only del commit exacto>" \
  --model 'Gemini 3.1 Pro (High)' \
  --print-timeout 10m
```

En la versión observada el 2026-06-30, `--sandbox` ejecutó `git` desde el
directorio scratch de Antigravity y terminó en panic al buscar un worktree
inexistente. Para auditorías de repo se omite temporalmente ese flag, se usan
paths absolutos, el prompt prohíbe escrituras y Codex compara `git status/diff`
antes y después. Se debe reactivar el sandbox cuando el CLI corrija el bug.

Nunca se usa `--dangerously-skip-permissions` ni
`--dangerously-bypass-approvals-and-sandbox`.

## 7. Escalamiento y gates

```text
trabajo ligero
  -> Gemini 3.5 Flash Medium

implementación producto
  -> MiniMax M3
  -> Kimi K2.7 Code si cruza capas o M3 falla una vez

implementación Rust/ZK
  -> DeepSeek V4 Pro
  -> Kimi K2.7 Code si V4 no está disponible

auditoría general
  -> Gemini 3.5 Flash High

auditoría security/soundness
  -> Gemini 3.1 Pro High

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

## 9. Modelos retirados

| Modelo | Estado | Motivo |
|---|---|---|
| Qwen 3.7 Max | retirado | costo operativo: agotó la cuenta demasiado rápido |
| GLM-5.2 | retirado | costo operativo: agotó la cuenta demasiado rápido |

Sus auditorías históricas siguen siendo evidencia válida del commit que
examinaron. No autorizan nuevas llamadas ni forman parte del routing vigente.
