import type { ProvingRequest, ProvingResponse, ProvingProgress } from "../adapters/provingAdapter.js";
// Vite ?worker import — triggers worker bundling (snarkjs included)
import ProverWorkerCtor from "./proverWorker?worker";

export interface ProverClient {
  prove(req: ProvingRequest, onProgress: (p: ProvingProgress) => void): Promise<ProvingResponse>;
  cancel(): void;
  terminate(): void;
}

// ── Worker message types ──

interface JobRequest {
  readonly type: "job";
  readonly jobId: number;
  readonly payload: ProvingRequest;
}

interface ProgressMessage {
  readonly type: "progress";
  readonly jobId: number;
  readonly payload: ProvingProgress;
}

interface ResultMessage {
  readonly type: "result";
  readonly jobId: number;
  readonly payload: ProvingResponse;
}

type InboundMessage = ProgressMessage | ResultMessage;

// ── Allowlisted error codes (no secrets, no stack traces) ──

const ALLOWLISTED_ERROR_CODES = new Set([
  "cancelled",
  "terminated",
  "stale job",
  "worker already busy",
]);

function isAllowlistedError(msg: string): boolean {
  return ALLOWLISTED_ERROR_CODES.has(msg)
    || msg.startsWith("prover error: ")
    || msg.startsWith("manifest error: ")
    || msg.startsWith("encoding error: ")
    || msg.startsWith("verify error: ")
    || msg.startsWith("invalid request: ");
}

function sanitizeBoundaryError(e: unknown): string {
  if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
  const msg = e instanceof Error ? e.message : String(e ?? "unknown");
  if (isAllowlistedError(msg)) return msg;
  return "prover error: internal";
}

// ── Default worker factory (uses Vite ?worker bundled import) ──

function defaultWorkerFactory(): Worker {
  return new ProverWorkerCtor();
}

// ── Factory ──

export function createWorkerProverClient(workerFactory?: () => Worker): ProverClient {
  const makeWorker = workerFactory ?? defaultWorkerFactory;
  let worker: Worker | null = null;
  let jobIdCounter = 0;
  let currentJobId: number | null = null;
  let inflight: {
    resolve: (r: ProvingResponse) => void;
    reject: (e: Error) => void;
    onProgress: (p: ProvingProgress) => void;
  } | null = null;
  let terminated = false;

  const ensureWorker = (): Worker => {
    if (terminated) throw new Error("terminated");
    if (worker !== null) return worker;
    worker = makeWorker();
    worker.addEventListener("message", (ev: MessageEvent<InboundMessage>) => {
      const msg = ev.data;
      if (inflight === null) return;
      if (msg.jobId !== currentJobId) return;

      if (msg.type === "progress") {
        inflight.onProgress(msg.payload as ProvingProgress);
        return;
      }
      if (msg.type === "result") {
        const rawPayload = msg.payload as ProvingResponse;
        let safePayload = rawPayload;
        if (!rawPayload.ok && typeof rawPayload.reason === "string") {
          if (!isAllowlistedError(rawPayload.reason)) {
            safePayload = { ok: false, reason: "prover error: internal" } as ProvingResponse;
          }
        }
        inflight.resolve(safePayload);
        inflight = null;
        currentJobId = null;
      }
    });
    worker.addEventListener("error", (e: ErrorEvent) => {
      if (inflight !== null) {
        inflight.reject(new Error(sanitizeBoundaryError(e.error ?? e.message ?? "worker error")));
        inflight = null;
        currentJobId = null;
      }
    });
    return worker;
  };

  return {
    prove(req, onProgress) {
      if (terminated) return Promise.reject(new Error("terminated"));
      if (inflight !== null) {
        return Promise.reject(new Error("worker already busy"));
      }

      const w = ensureWorker();
      const jobId = ++jobIdCounter;
      currentJobId = jobId;

      return new Promise<ProvingResponse>((resolve, reject) => {
        inflight = {
          resolve: (r: ProvingResponse) => {
            if (r.ok && r.envelope) {
              r = {
                ok: true,
                envelope: {
                  electionId: r.envelope.electionId,
                  publicSchemaId: r.envelope.publicSchemaId,
                  publicSignals: [...r.envelope.publicSignals],
                  proofBytes: r.envelope.proofBytes,
                },
                publicSignalsHash: r.publicSignalsHash,
                proofHash: r.proofHash,
              };
            }
            resolve(r);
          },
          reject: (e: Error) => {
            reject(new Error(sanitizeBoundaryError(e)));
          },
          onProgress,
        };
        const jobMsg: JobRequest = { type: "job", jobId, payload: req };
        w.postMessage(jobMsg);
      });
    },

    cancel() {
      if (worker === null) return;
      // Terminate worker to stop any in-flight fullProve (WASM blocks event loop)
      worker.terminate();
      worker = null;
      if (inflight !== null) {
        const r: ProvingResponse = { ok: false, reason: "cancelled" };
        inflight.resolve(r);
        inflight = null;
        currentJobId = null;
      }
    },

    terminate() {
      if (worker !== null) {
        worker.terminate();
        worker = null;
      }
      terminated = true;
      if (inflight !== null) {
        inflight.reject(new Error("terminated"));
        inflight = null;
        currentJobId = null;
      }
    },
  };
}

/**
 * Inline prover client for tests — wraps any ProvingAdapter-compatible
 * object and dispatches directly (no worker).
 */
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
