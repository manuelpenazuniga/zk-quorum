# U-Pre — prover R0 real en navegador

Fecha: 2026-07-02  
Base: `main` después de `748f8de`  
Gate anterior: E0 `APROBADO E INTEGRADO`

## 1. Objetivo

Reemplazar el mock del worker por un prover R0 real y producir evidencia
reproducible en un navegador Chromium de:

```text
fixture depth 10
→ Web Worker
→ snarkjs 0.7.6 groth16.fullProve
→ 6 public signals canónicas
→ snarkjs verify con VK final C0
→ proof/public bytes y hashes
→ cancelación/error sin secretos en respuesta o red
```

Este hito valida Chromium desktop. No debe afirmar compatibilidad con Safari,
Firefox ni móvil hasta ejecutar esos motores y congelar una matriz objetivo.

## 2. Restricciones congeladas

- Node 24; `snarkjs = 0.7.6` exacto.
- R0 `PublicVoteR0(10)`, BLS12-381.
- Circuit WASM recompilado y validado por el hash R1CS C0.
- Proving key `r0_final.zkey` obtenida del release público C0 y verificada por
  tamaño/SHA-256 mediante `scripts/fetch-setup-assets.js`.
- VK JSON: `circuits/artifacts/manifests/r0_vk.json`.
- No CDN, analytics, telemetría externa ni prover remoto.
- Los assets pesados son staging ignorado; no versionar `.wasm`, `.zkey`,
  witness, proof ni secretos.
- Kimi K2.7 Code no se usa. Implementación ZK/integración: DeepSeek V4 Pro.
- Auditor final: Gemini 3.1 Pro High read-only, un único audit tras preflight.

## 3. Diagnóstico de base

- `apps/web/src/worker/proverWorker.ts` instancia `MockProvingAdapter`.
- `apps/web/src/adapters/provingAdapter.ts` solo produce bytes/hashes sintéticos.
- `workerBoundary.cancel()` envía un mensaje al mismo worker. Eso no garantiza
  cancelación mientras `fullProve` ocupa el event loop; U-Pre debe terminar el
  worker y resolver la promesa pendiente como `cancelled`.
- El voter usa inputs/signals mock. U-Pre no debe presentar ese flujo como
  producción completa ni enviar al relayer.
- El replay E0 ya fija el orden de señales y el encoding Soroban; cualquier
  serializador browser debe tener equivalencia demostrable con ese formato.

## 4. Entregables

### 4.1 Staging reproducible

Un script fail-closed debe:

1. verificar toolchain y assets C0;
2. recompilar R0 desde limpio;
3. comprobar el hash R1CS contra el manifest;
4. copiar únicamente `main.wasm`, `r0_final.zkey`, `r0_vk.json` y un manifest
   público a un directorio ignorado servido por Vite;
5. registrar tamaño y SHA-256 de cada asset;
6. no copiar el fixture con secretos al directorio público.

El manifest servido debe tener schema/version exactos y hashes esperados. El
worker verifica hashes antes de probar o el gate falla.

### 4.2 Prover real

- Añadir `snarkjs@0.7.6` como dependencia runtime exacta de `apps/web`.
- Implementar un adapter R0 real que solo se instancie dentro del worker.
- Usar `groth16.fullProve(inputs, wasmUrl, zkeyUrl)`.
- Exigir que el resultado tenga exactamente seis señales decimales Fr
  canónicas y sea igual a las señales esperadas cuando el request las incluya.
- Verificar la proof con la VK final antes de devolver éxito.
- Serializar proof/public signals al encoding exacto consumido por Soroban.
- Calcular SHA-256 sobre los bytes canónicos reales, no sobre JSON sintético.
- Nunca incluir inputs, secretos, witness o stack crudo en respuesta/log/error.
- Rechazar mensajes con keys/tipos/schema desconocidos.

### 4.3 Worker boundary

- Máximo un job in-flight.
- Cada job tiene ID; mensajes tardíos de un worker anterior se ignoran.
- `cancel()` termina el worker, resuelve el job como error tipado `cancelled` y
  permite crear un worker nuevo para el siguiente job.
- `terminate()` también resuelve/rechaza de forma determinista; no deja Promise
  pendiente.
- Errores se reducen a códigos/mensajes allowlisted sin material privado.

### 4.4 Harness de gate

Una página separada de la UI de votación debe permitir, sin relayer:

- `Run valid R0`;
- `Run invalid witness`;
- `Cancel`;
- mostrar stage, duración, resultado de verify, tamaños/hashes y métrica de
  memoria disponible;
- exponer un resultado JSON pequeño y estable para automatización;
- no renderizar ni conservar inputs secretos después de iniciar el job.

El fixture de gate puede entrar al bundle de desarrollo o construirse dentro
del worker, pero no debe descargarse por una request separada ni aparecer en
DOM, consola, URL, local/session storage o respuesta del worker.

## 5. Evidencia de navegador

El runner de U-Pre debe arrancar Vite en modo producción/preview y ejecutar en
Chromium real:

1. carga del harness;
2. proof válida y verify `true`;
3. signals iguales al fixture E0;
4. proof/public hashes no nulos y bytes con longitudes exactas;
5. invalid witness falla con error sanitizado;
6. cancelación termina en tiempo acotado y un job posterior vuelve a pasar;
7. ninguna request POST/PUT/PATCH/DELETE durante el gate;
8. solo GET locales allowlisted para HTML/JS/worker/WASM/zkey/VK/manifest;
9. ningún valor de `nullifierSecret`, `trapdoor`, siblings ni witness aparece
   en URL, request body, response del worker, DOM, consola o storage;
10. registrar user agent, duración y memoria observada. Si la API de peak
    memory no existe, reportar `unsupported`; nunca inventar una cifra.

Guardar evidencia ignorada bajo `tmp/u-pre/`:

```text
manifest.json
browser-result.json
network.json
console.json
screenshot.png
```

El manifiesto liga por SHA-256 la build, assets y evidencias. El screenshot es
informativo; los JSON y exit codes son autoritativos.

## 6. Tests obligatorios antes del navegador

- adapter: valid, bad schema, signal mismatch, verify false, error sanitizado;
- serialización: golden vectors contra el formato E0/Rust;
- boundary: single-flight, cancel, terminate, stale message, recovery;
- staging: asset faltante/corrupto/hash incorrecto;
- build/typecheck;
- suite U0 existente sin regresión;
- ningún test `ignored`, `skip`, `todo` ni `only`.

## 7. Acceptance gate

U-Pre Chromium solo pasa si:

```text
fullProve real: PASS
snarkjs verify in worker: PASS
public signals exactas: PASS
encoding Soroban/golden: PASS
invalid witness: PASS
cancel + recovery: PASS
network allowlist/no secret leak: PASS
tests/build/typecheck: PASS
Gemini audit: 0 Critical/High
```

El gate no autoriza testnet ni fondos. El adapter del voter no se considera
production-ready hasta eliminar sus inputs/signals mock y completar T0.

## 8. Fuera de alcance

- R1 browser proving;
- envío al relayer/testnet;
- wallet admin;
- soporte móvil;
- afirmar compatibilidad Safari/Firefox sin evidencia;
- optimizar cambiando circuito, profundidad, proving system o mover el prover
  fuera del cliente.

