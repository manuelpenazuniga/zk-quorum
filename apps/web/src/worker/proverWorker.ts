/**
 * Worker entry point — Vite bundles this as a separate chunk.
 *
 * The worker supports two modes:
 *   1. Real mode (default): uses RealR0ProvingAdapter with snarkjs 0.7.6.
 *      Loads assets from /upre-assets/ via fetch.
 *   2. Mock mode (fallback): uses MockProvingAdapter for development
 *      without proving assets. Activated when REAL_PROVER=0 env/signal.
 *
 * Protocol:
 *   Main → Worker: { type: "job", jobId: number, payload: ProvingRequest }
 *   Worker → Main: { type: "progress", jobId, payload: ProvingProgress }
 *   Worker → Main: { type: "result", jobId, payload: ProvingResponse }
 */
import { MockProvingAdapter, type ProvingRequest, type ProvingResponse, type ProvingProgress } from "../adapters/provingAdapter.js";
import { RealR0ProvingAdapter, type AssetManifest } from "../adapters/realProvingAdapter.js";

// ── Config ──

interface WorkerConfig {
  /** If true, attempt to use the real prover with snarkjs */
  real: boolean;
  /** Base path for U-Pre asset directory (served by Vite) */
  assetsBase: string;
}

let adapter: RealR0ProvingAdapter | MockProvingAdapter;
let adapterReady = false;
let adapterError: string | null = null;

// ── Initialization ──

async function initRealAdapter(config: WorkerConfig): Promise<void> {
  const manifestUrl = `${config.assetsBase}/manifest.json`;
  const wasmUrl = `${config.assetsBase}/main.wasm`;
  const zkeyUrl = `${config.assetsBase}/r0_final.zkey`;
  const vkUrl = `${config.assetsBase}/r0_vk.json`;

  let manifest: AssetManifest | null = null;
  try {
    const resp = await fetch(manifestUrl);
    if (resp.ok) {
      manifest = await resp.json() as AssetManifest;
    }
  } catch {
    // Manifest optional for development without assets
  }

  const vkResp = await fetch(vkUrl);
  if (!vkResp.ok) throw new Error(`manifest error: cannot fetch VK (${vkResp.status})`);
  const vkJson = await vkResp.json();

  adapter = new RealR0ProvingAdapter(wasmUrl, zkeyUrl, vkJson, manifest);
  adapterReady = true;
}

function initMockAdapter(): void {
  adapter = new MockProvingAdapter();
  adapterReady = true;
}

// Read config from worker startup data or defaults
const DEFAULT_CONFIG: WorkerConfig = {
  real: true,
  assetsBase: "/upre-assets",
};

// Immediately initialize
(async () => {
  try {
    await initRealAdapter(DEFAULT_CONFIG);
    // No console.log in worker — keep output clean
  } catch (e: unknown) {
    adapterError = e instanceof Error ? e.message : String(e);
    // Fall back to mock so the worker doesn't crash silently
    initMockAdapter();
  }
})();

// ── Message handling ──

self.addEventListener("message", async (ev: MessageEvent<{ readonly type: string; readonly jobId: number; readonly payload?: unknown }>) => {
  const msg = ev.data;
  if (!msg || typeof msg.type !== "string") return;

  // Handle cancel: the boundary terminates the worker, so this is a best-effort
  // signal. Since the adapter only checks `cancelled` between async steps,
  // and fullProve blocks the event loop, termination is the real mechanism.
  if (msg.type === "cancel") {
    if (adapter && typeof adapter.cancel === "function") {
      adapter.cancel();
    }
    return;
  }

  if (msg.type !== "job") return;
  if (typeof msg.jobId !== "number" || msg.payload == null) return;

  const jobId = msg.jobId;
  const req = msg.payload as ProvingRequest;

  const onProgress = (p: ProvingProgress) => {
    self.postMessage({ type: "progress", jobId, payload: p });
  };

  // Wait for adapter to be ready
  while (!adapterReady && adapterError === null) {
    await new Promise((r) => setTimeout(r, 10));
  }

  if (adapterError !== null) {
    self.postMessage({
      type: "result",
      jobId,
      payload: { ok: false, reason: `prover error: init failed — ${adapterError}` } satisfies ProvingResponse,
    });
    return;
  }

  try {
    const result: ProvingResponse = await adapter.prove(req, onProgress);
    self.postMessage({ type: "result", jobId, payload: result });
  } catch (e: unknown) {
    // Sanitize: never leak raw error content
    const reason = e instanceof Error ? e.message : String(e ?? "unknown");
    // Only allow known safe patterns
    const safeReasons = new Set(["cancelled"]);
    const safeReason = safeReasons.has(reason) || reason.startsWith("prover error: ") || reason.startsWith("manifest error: ") || reason.startsWith("encoding error: ") || reason.startsWith("verify error: ") || reason.startsWith("invalid request: ")
      ? reason
      : "prover error: internal";
    self.postMessage({
      type: "result",
      jobId,
      payload: { ok: false, reason: safeReason } satisfies ProvingResponse,
    });
  }
});
