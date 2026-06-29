/**
 * Worker entry point. Vite bundles this as a separate chunk and
 * instantiates it through `new Worker(new URL('./proverWorker.ts', import.meta.url), { type: 'module' })`.
 */
import { MockProvingAdapter, type ProvingRequest, type ProvingResponse, type ProvingProgress } from "../adapters/provingAdapter.js";

const adapter = new MockProvingAdapter();

self.addEventListener("message", async (ev: MessageEvent<ProvingRequest>) => {
  const req = ev.data;
  const onProgress = (p: ProvingProgress) => self.postMessage({ type: "progress", payload: p });
  try {
    const result: ProvingResponse = await adapter.prove(req, onProgress);
    self.postMessage({ type: "result", payload: result });
  } catch (e) {
    self.postMessage({
      type: "result",
      payload: { ok: false, reason: e instanceof Error ? e.message : String(e) } satisfies ProvingResponse,
    });
  }
});

self.addEventListener("message", (ev: MessageEvent<{ readonly type: "cancel" }>) => {
  if (ev.data?.type === "cancel") {
    adapter.cancel();
  }
});

void MockProvingAdapter;
