export interface RelayerConfig {
  readonly port: number;
  readonly host: string;
  readonly bodyLimitBytes: number;
  readonly ratePerMinute: number;
  readonly rateWindowMs: number;
  readonly queueConcurrency: number;
  readonly idempotencyTtlMs: number;
  readonly clientKeyRotationMs: number;
  readonly maxProofBytes: number;
  readonly enableLogging: boolean;
  readonly submitterAccount: string | null;
  readonly networkPassphrase: string;
  readonly defaultElectionId: string | null;
}

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_BODY_LIMIT = 64 * 1024;
const DEFAULT_RATE = 60;
const DEFAULT_WINDOW = 60_000;
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_IDEMPOTENCY_TTL = 10 * 60_000;
const DEFAULT_CLIENT_KEY_ROTATION_MS = 5 * 60_000;
const DEFAULT_MAX_PROOF_BYTES = 8 * 1024;

function envInt(name: string, fallback: number, env: NodeJS.ProcessEnv): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`env ${name}=${raw} is not a non-negative integer`);
  }
  return n;
}

function envStr(name: string, fallback: string | null, env: NodeJS.ProcessEnv): string | null {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw;
}

export function loadRelayerConfig(env: NodeJS.ProcessEnv = process.env): RelayerConfig {
  return {
    port: envInt("ZKQ_RELAYER_PORT", DEFAULT_PORT, env),
    host: envStr("ZKQ_RELAYER_HOST", DEFAULT_HOST, env) ?? DEFAULT_HOST,
    bodyLimitBytes: envInt("ZKQ_RELAYER_BODY_LIMIT", DEFAULT_BODY_LIMIT, env),
    ratePerMinute: envInt("ZKQ_RELAYER_RATE_PER_MINUTE", DEFAULT_RATE, env),
    rateWindowMs: envInt("ZKQ_RELAYER_RATE_WINDOW_MS", DEFAULT_WINDOW, env),
    queueConcurrency: envInt("ZKQ_RELAYER_QUEUE_CONCURRENCY", DEFAULT_CONCURRENCY, env),
    idempotencyTtlMs: envInt("ZKQ_RELAYER_IDEMPOTENCY_TTL_MS", DEFAULT_IDEMPOTENCY_TTL, env),
    clientKeyRotationMs: envInt("ZKQ_RELAYER_CLIENT_KEY_ROTATION_MS", DEFAULT_CLIENT_KEY_ROTATION_MS, env),
    maxProofBytes: envInt("ZKQ_RELAYER_MAX_PROOF_BYTES", DEFAULT_MAX_PROOF_BYTES, env),
    enableLogging: envStr("ZKQ_RELAYER_LOG", "1", env) !== "0",
    submitterAccount: envStr("ZKQ_RELAYER_SUBMITTER", null, env),
    networkPassphrase: envStr("ZKQ_RELAYER_NETWORK_PASSPHRASE", "Test SDF Network ; September 2015", env) ?? "Test SDF Network ; September 2015",
    defaultElectionId: envStr("ZKQ_RELAYER_DEFAULT_ELECTION", null, env),
  };
}
