import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { loadRelayerConfig, type RelayerConfig } from "./config.js";
import { createTokenBucketRateLimiter, type RateLimiter } from "./services/rateLimit.js";
import { createInMemoryIdempotencyStore, type IdempotencyStore } from "./services/idempotency.js";
import { createPerAccountRelayQueue, type RelayQueue } from "./services/relayQueue.js";
import { createRedactingLogger, type RedactingLogger } from "./services/logRedaction.js";
import { createEphemeralClientKeyer, type EphemeralKeyer } from "./services/ephemeralClientKey.js";
import { Groth16SnarkjsVerifier, StellarSubmitter, SorobanSimulator } from "./adapters/snarkjsAdapter.js";
import type { OffchainVerifier, Simulator, Submitter } from "./adapters/types.js";
import { createHealthRoute } from "./routes/health.js";
import { createSubmitRoute } from "./routes/submit.js";

export interface RelayerDeps {
  readonly config: RelayerConfig;
  readonly verifier: OffchainVerifier;
  readonly simulator: Simulator;
  readonly submitter: Submitter;
  readonly rateLimiter: RateLimiter;
  readonly idempotency: IdempotencyStore;
  readonly queue: RelayQueue<unknown>;
  readonly logger: RedactingLogger;
  readonly clientKeyer: EphemeralKeyer;
}

/**
 * Production factory: FAIL CLOSED (audit integrator finding).
 * Without explicit non-mock adapters, the relayer refuses to start. Mocks
 * exist in `adapters/mockAdapters.ts` and the separate `testDeps.ts`
 * factory; they are NEVER imported by this file. The relayer must never
 * reach `listen()` while a `Groth16SnarkjsVerifier` / `SorobanSimulator`
 * / `StellarSubmitter` (all unconfigured) is in scope: `index.ts` does
 * the `instanceof` check and aborts before binding the port.
 */
export function createDefaultDeps(config: RelayerConfig = loadRelayerConfig()): RelayerDeps {
  const verifier = new Groth16SnarkjsVerifier();
  const simulator = new SorobanSimulator();
  const submitter = new StellarSubmitter();
  return {
    config,
    verifier,
    simulator,
    submitter,
    rateLimiter: createTokenBucketRateLimiter({ limit: config.ratePerMinute, windowMs: config.rateWindowMs }),
    idempotency: createInMemoryIdempotencyStore({ ttlMs: config.idempotencyTtlMs }),
    queue: createPerAccountRelayQueue<unknown>({ concurrency: config.queueConcurrency }),
    logger: createRedactingLogger({ enabled: config.enableLogging }),
    clientKeyer: createEphemeralClientKeyer({ rotationMs: config.clientKeyRotationMs }),
  };
}

export interface RelayerApp {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  close(): Promise<void>;
}

export function createRelayerApp(deps: RelayerDeps): RelayerApp {
  const health = createHealthRoute(deps.config, deps.logger);
  const submit = createSubmitRoute({
    verifier: deps.verifier,
    simulator: deps.simulator,
    submitter: deps.submitter,
    queue: deps.queue,
    idempotency: deps.idempotency,
    rateLimiter: deps.rateLimiter,
    clientKeyer: deps.clientKeyer,
    logger: deps.logger,
    bodyLimitBytes: deps.config.bodyLimitBytes,
    maxProofBytes: deps.config.maxProofBytes,
  });

  return {
    async handle(req: IncomingMessage, res: ServerResponse) {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? deps.config.host}`);
      const rawAddress = (req.socket?.remoteAddress ?? "0.0.0.0").replace(/[^0-9a-fA-F:.]/g, "");
      const httpReq = req as unknown as Parameters<typeof health>[0];
      try {
        if (url.pathname === "/health" || url.pathname === "/healthz") {
          await health(httpReq, res);
          return;
        }
        if (url.pathname === "/submit") {
          await submit(httpReq, res, rawAddress);
          return;
        }
        res.statusCode = 404;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: { code: "not_found", message: `unknown path: ${url.pathname}` } }));
      } catch (e) {
        deps.logger.error("relayer.unhandled", { error: e instanceof Error ? e.message : String(e), path: url.pathname });
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: { code: "internal_error", message: e instanceof Error ? e.message : "unknown" } }));
        }
      }
    },
    async close() {
      await deps.queue.drain();
    },
  };
}

export function listen(deps: RelayerDeps): Server {
  const app = createRelayerApp(deps);
  const server = createServer((req, res) => {
    void app.handle(req, res);
  });
  server.listen(deps.config.port, deps.config.host, () => {
    deps.logger.info("relayer.listen", { host: deps.config.host, port: deps.config.port });
  });
  return server;
}
