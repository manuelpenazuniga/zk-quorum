import { loadRelayerConfig, type RelayerConfig } from "./config.js";
import { createTokenBucketRateLimiter } from "./services/rateLimit.js";
import { createInMemoryIdempotencyStore } from "./services/idempotency.js";
import { createPerAccountRelayQueue } from "./services/relayQueue.js";
import { createRedactingLogger } from "./services/logRedaction.js";
import { createEphemeralClientKeyer } from "./services/ephemeralClientKey.js";
import { MockOffchainVerifier, MockSimulator, MockSubmitter } from "./adapters/mockAdapters.js";
import type { RelayerDeps } from "./app.js";

/**
 * Test/dev-only factory: every adapter is the mock and the ephemeral
 * keyer is a deterministic SHA-256 over the raw address. Exposed
 * through `index_lib.ts` for unit tests and dev tools. Production code
 * MUST NOT import this symbol: `app.ts` (imported by `index.ts`) does
 * NOT re-export it, so production code that uses `createDefaultDeps`
 * cannot accidentally wire mocks in.
 */
export function createTestDeps(config: Partial<RelayerConfig> = {}): RelayerDeps {
  const full: RelayerConfig = { ...loadRelayerConfig(), ...config };
  return {
    config: full,
    verifier: new MockOffchainVerifier(),
    simulator: new MockSimulator(),
    submitter: new MockSubmitter({ account: full.submitterAccount }),
    rateLimiter: createTokenBucketRateLimiter({ limit: full.ratePerMinute, windowMs: full.rateWindowMs }),
    idempotency: createInMemoryIdempotencyStore({ ttlMs: full.idempotencyTtlMs }),
    queue: createPerAccountRelayQueue<unknown>({ concurrency: full.queueConcurrency }),
    logger: createRedactingLogger({ enabled: false }),
    clientKeyer: createEphemeralClientKeyer({ rotationMs: full.clientKeyRotationMs }),
  };
}
