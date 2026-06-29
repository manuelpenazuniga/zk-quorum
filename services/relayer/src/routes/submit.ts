import type { CastRequest, RevealRequest, Sha256Hex } from "@zk-quorum/protocol";
import { isZkqProtocolError, ZkqProtocolError } from "@zk-quorum/protocol";
import type { RedactingLogger } from "../services/logRedaction.js";
import type { IdempotencyStore } from "../services/idempotency.js";
import type { RelayQueue } from "../services/relayQueue.js";
import type { RateLimiter } from "../services/rateLimit.js";
import type { OffchainVerifier, Simulator, Submitter } from "../adapters/types.js";
import { executeCast, executeReveal } from "../adapters/pipeline.js";
import { validateCastRequestShape, validateRevealRequestShape } from "../adapters/mockAdapters.js";
import { readBody, writeError, writeJson } from "../middleware/http.js";
import type { HttpRequestLike, HttpResponseLike } from "../middleware/http.js";

export interface SubmitRouteDeps {
  readonly verifier: OffchainVerifier;
  readonly simulator: Simulator;
  readonly submitter: Submitter;
  readonly queue: RelayQueue<unknown>;
  readonly idempotency: IdempotencyStore;
  readonly rateLimiter: RateLimiter;
  readonly logger: RedactingLogger;
  readonly bodyLimitBytes: number;
  readonly now?: () => number;
}

function rateLimitKey(req: CastRequest | RevealRequest, _fallbackIp: string): string {
  return `idem:${req.idempotencyKey}`;
}

function writeProtocolError(res: HttpResponseLike, err: unknown, fallbackStatus = 400): void {
  if (isZkqProtocolError(err)) {
    const status = err.code === "RELAYER_PAYLOAD_TOO_LARGE" ? 413
      : err.code === "RELAYER_RATE_LIMITED" ? 429
      : err.code === "RELAYER_IDEMPOTENT_REPLAY" ? 409
      : err.code === "ADAPTER_NOT_CONFIGURED" ? 503
      : err.code === "VOTER_AUTH_FORBIDDEN" ? 403
      : err.code === "NULLIFIER_DUPLICATE" ? 409
      : fallbackStatus;
    writeError(res, status, err.code, err.message, err.detail);
    return;
  }
  writeError(res, 500, "internal_error", err instanceof Error ? err.message : "unknown");
}

export function createSubmitRoute(deps: SubmitRouteDeps) {
  const now = deps.now ?? Date.now;

  return async function submitRoute(req: HttpRequestLike, res: HttpResponseLike, fallbackIp: string): Promise<void> {
    if (req.method.toUpperCase() !== "POST") {
      writeError(res, 405, "method_not_allowed", "use POST");
      return;
    }
    const body = await readBody(req, deps.bodyLimitBytes);
    if (!body.ok) {
      writeError(res, 413, "RELAYER_PAYLOAD_TOO_LARGE", body.reason ?? "body error");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.body.toString("utf8"));
    } catch (e) {
      writeError(res, 400, "invalid_json", e instanceof Error ? e.message : "bad json");
      return;
    }

    let kind: "cast" | "reveal";
    let castReq: CastRequest | null = null;
    let revealReq: RevealRequest | null = null;
    if (parsed !== null && typeof parsed === "object" && (parsed as Record<string, unknown>).action === "reveal") {
      kind = "reveal";
      try {
        validateRevealRequestShape(parsed);
        revealReq = parsed as RevealRequest;
      } catch (e) {
        writeProtocolError(res, e);
        return;
      }
    } else {
      kind = "cast";
      try {
        validateCastRequestShape(parsed);
        castReq = parsed as CastRequest;
      } catch (e) {
        writeProtocolError(res, e);
        return;
      }
    }

    const req2 = (castReq ?? revealReq)!;
    const key = rateLimitKey(req2, fallbackIp);
    const decision = deps.rateLimiter.check(key, now());
    if (!decision.allowed) {
      res.setHeader("retry-after", Math.ceil(decision.resetMs / 1000).toString());
      writeError(res, 429, "RELAYER_RATE_LIMITED", "too many requests for this idempotencyKey", { resetMs: decision.resetMs });
      return;
    }

    const idem = deps.idempotency.begin(req2.idempotencyKey, now());
    if (idem.kind === "in-flight") {
      writeError(res, 409, "RELAYER_IDEMPOTENT_REPLAY", "request already in-flight", { key: req2.idempotencyKey });
      return;
    }
    if (idem.kind === "replay") {
      writeJson(res, 200, { ...(idem.result as object), replay: true });
      return;
    }

    const accountKey = deps.submitter.id;
    try {
      const result = await deps.queue.submit({
        id: accountKey,
        run: async () => {
          if (kind === "cast" && castReq) {
            return executeCast({
              envelope: {
                electionId: castReq.electionId,
                publicSchemaId: castReq.publicSchemaId,
                publicSignals: castReq.publicSignals,
                proofBytes: castReq.proofBytes,
              },
              verifier: deps.verifier,
              simulator: deps.simulator,
              submitter: deps.submitter,
            });
          }
          if (kind === "reveal" && revealReq) {
            return executeReveal({
              electionId: revealReq.electionId,
              ballotCommitment: revealReq.ballotCommitment,
              vote: revealReq.vote,
              salt: revealReq.salt,
              submitter: deps.submitter,
              simulator: deps.simulator,
            });
          }
          throw new ZkqProtocolError("MISSING_PUBLIC_SIGNAL", "no request body");
        },
      });
      deps.idempotency.complete(req2.idempotencyKey, result, now());
      deps.logger.info("relayer.submit.success", {
        kind,
        electionId: req2.electionId,
        clientTag: req2.clientTag,
        txHash: (result as { txHash?: string | null }).txHash ?? null,
        status: (result as { status?: string }).status ?? null,
      });
      writeJson(res, 200, result);
    } catch (e) {
      deps.idempotency.fail(req2.idempotencyKey, now());
      deps.logger.error("relayer.submit.error", {
        kind,
        electionId: req2.electionId,
        clientTag: req2.clientTag,
        error: e instanceof Error ? e.message : String(e),
      });
      writeProtocolError(res, e);
    }
  };
}

export type SubmitHandler = (req: HttpRequestLike, res: HttpResponseLike, fallbackIp: string) => Promise<void>;

export const _internal: { sha256HexPlaceholder: Sha256Hex } = {
  sha256HexPlaceholder: ("0x" + "00".repeat(32)) as Sha256Hex,
};
