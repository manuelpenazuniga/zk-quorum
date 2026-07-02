/**
 * Worker entry point for RealR0ProvingAdapter with snarkjs 0.7.6.
 *
 * This worker has NO mock fallback. Manifest is mandatory — the worker
 * fails-closed if the manifest cannot be loaded or validated.
 *
 * Protocol:
 *   Main → Worker: { type: "job", jobId: number, payload: ProvingRequest }
 *   Worker → Main: { type: "progress", jobId, payload: ProvingProgress }
 *   Worker → Main: { type: "result", jobId, payload: ProvingResponse }
 */
import { type ProvingRequest, type ProvingResponse, type ProvingProgress } from "../adapters/provingAdapter.js";
import { RealR0ProvingAdapter, type AssetManifest } from "../adapters/realProvingAdapter.js";

// ── Config ──

const ASSETS_BASE = "/upre-assets";

let adapter: RealR0ProvingAdapter | null = null;
let adapterReady = false;
let adapterError: string | null = null;

// ── Initialization (mandatory) ──

async function initAdapter(): Promise<void> {
  const manifestUrl = `${ASSETS_BASE}/manifest.json`;
  const wasmUrl = `${ASSETS_BASE}/main.wasm`;
  const zkeyUrl = `${ASSETS_BASE}/r0_final.zkey`;
  const vkUrl = `${ASSETS_BASE}/r0_vk.json`;

  // Manifest is mandatory
  const manifestResp = await fetch(manifestUrl);
  if (!manifestResp.ok) {
    throw new Error(`manifest error: cannot fetch manifest (HTTP ${manifestResp.status})`);
  }
  const manifest = await manifestResp.json() as AssetManifest;

  // Adapter will fetch and verify all three assets (wasm, zkey, vk) during prove()
  adapter = new RealR0ProvingAdapter(wasmUrl, zkeyUrl, vkUrl, manifest);
  adapterReady = true;
}

// Immediately initialize — fail-closed on error
(async () => {
  try {
    await initAdapter();
  } catch (e: unknown) {
    adapterError = e instanceof Error ? e.message : String(e);
    // Worker stays in error state; no mock fallback
  }
})();

// ── Message handling ──

self.addEventListener("message", async (ev: MessageEvent<{ readonly type: string; readonly jobId: number; readonly payload?: unknown }>) => {
  const msg = ev.data;
  if (!msg || typeof msg.type !== "string") return;

  // Cancel: boundary terminates the worker for real cancellation.
  // This signal is best-effort for in-flight async steps.
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

  // Wait for adapter to be ready (or fail)
  while (!adapterReady && adapterError === null) {
    await new Promise((r) => setTimeout(r, 10));
  }

  if (adapterError !== null || adapter === null) {
    self.postMessage({
      type: "result",
      jobId,
      payload: { ok: false, reason: `prover error: init failed — ${adapterError ?? "adapter not available"}` } satisfies ProvingResponse,
    });
    return;
  }

  try {
    const result: ProvingResponse = await adapter.prove(req, onProgress);
    self.postMessage({ type: "result", jobId, payload: result });
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e ?? "unknown");
    const safeReasons = new Set(["cancelled"]);
    const safeReason = safeReasons.has(reason)
      || reason.startsWith("prover error: ")
      || reason.startsWith("manifest error: ")
      || reason.startsWith("encoding error: ")
      || reason.startsWith("verify error: ")
      || reason.startsWith("invalid request: ")
      ? reason
      : "prover error: internal";
    self.postMessage({
      type: "result",
      jobId,
      payload: { ok: false, reason: safeReason } satisfies ProvingResponse,
    });
  }
});
