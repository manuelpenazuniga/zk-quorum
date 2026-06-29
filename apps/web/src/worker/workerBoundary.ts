import type { ProvingRequest, ProvingResponse, ProvingProgress } from "../adapters/provingAdapter.js";

export interface ProverClient {
  prove(req: ProvingRequest, onProgress: (p: ProvingProgress) => void): Promise<ProvingResponse>;
  cancel(): void;
  terminate(): void;
}

interface WorkerInbound {
  readonly type: "progress" | "result";
  readonly payload: ProvingProgress | ProvingResponse;
}

export function createWorkerProverClient(): ProverClient {
  let worker: Worker | null = null;
  let inflight: { resolve: (r: ProvingResponse) => void; reject: (e: Error) => void; onProgress: (p: ProvingProgress) => void } | null = null;

  const ensureWorker = (): Worker => {
    if (worker !== null) return worker;
    worker = new Worker(new URL("../worker/proverWorker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (ev: MessageEvent<WorkerInbound>) => {
      if (inflight === null) return;
      const msg = ev.data;
      if (msg.type === "progress") {
        inflight.onProgress(msg.payload as ProvingProgress);
        return;
      }
      if (msg.type === "result") {
        inflight.resolve(msg.payload as ProvingResponse);
        inflight = null;
      }
    });
    worker.addEventListener("error", (e: ErrorEvent) => {
      if (inflight !== null) {
        inflight.reject(new Error(e.message || "worker error"));
        inflight = null;
      }
    });
    return worker;
  };

  return {
    prove(req, onProgress) {
      const w = ensureWorker();
      return new Promise<ProvingResponse>((resolve, reject) => {
        inflight = { resolve, reject, onProgress };
        w.postMessage(req);
      });
    },
    cancel() {
      if (worker === null) return;
      worker.postMessage({ type: "cancel" });
    },
    terminate() {
      worker?.terminate();
      worker = null;
    },
  };
}

export class InlineProverClient implements ProverClient {
  private adapter: import("../adapters/provingAdapter.js").ProvingAdapter;
  constructor(adapter: import("../adapters/provingAdapter.js").ProvingAdapter) {
    this.adapter = adapter;
  }
  public async prove(req: ProvingRequest, onProgress: (p: ProvingProgress) => void): Promise<ProvingResponse> {
    return this.adapter.prove(req, onProgress);
  }
  public cancel(): void {
    this.adapter.cancel();
  }
  public terminate(): void {
    this.cancel();
  }
}
