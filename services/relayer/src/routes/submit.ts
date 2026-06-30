import type { CastRequest, RevealRequest } from "@zk-quorum/protocol";
import { isZkqProtocolError, ZkqProtocolError } from "@zk-quorum/protocol";
import type { RedactingLogger } from "../services/logRedaction.js";
import type { IdempotencyStore } from "../services/idempotency.js";
import type { RelayQueue } from "../services/relayQueue.js";
import type { RateLimiter } from "../services/rateLimit.js";
import type { EphemeralKeyer } from "../services/ephemeralClientKey.js";
import type { OffchainVerifier, Simulator, Submitter } from "../adapters/types.js";
import { executeCast, executeReveal } from "../adapters/pipeline.js";
// Frozen U0: production route imports validators from the production
// request-validation module, NEVER from `adapters/mockAdapters.ts`.
import { validateCastRequestShape, validateRevealRequestShape } from "../services/requestValidation.js";
import { readBody, writeError, writeJson } from "../middleware/http.js";
import type { HttpRequestLike, HttpResponseLike } from "../middleware/http.js";

export interface SubmitRouteDeps {
  readonly verifier: OffchainVerifier;
  readonly simulator: Simulator;
  readonly submitter: Submitter;
  readonly queue: RelayQueue<unknown>;
  readonly idempotency: IdempotencyStore;
  readonly rateLimiter: RateLimiter;
  readonly clientKeyer: EphemeralKeyer;
  readonly logger: RedactingLogger;
  readonly bodyLimitBytes: number;
  readonly maxProofBytes: number;
  readonly now?: () => number;
}

function writeProtocolError(res: HttpResponseLike, err: unknown, fallbackStatus = 400): void {
  if (isZkqProtocolError(err)) {
    const status = err.code === "RELAYER_PAYLOAD_TOO_LARGE" || err.code === "PAYLOAD_TOO_LARGE" ? 413
      : err.code === "RELAYER_RATE_LIMITED" ? 429
      : err.code === "RELAYER_IDEMPOTENT_REPLAY" ? 409
      : err.code === "ADAPTER_NOT_CONFIGURED" ? 503
      : err.code === "VERIFIER_NOT_CONFIGURED" ? 503
      : err.code === "VOTER_AUTH_FORBIDDEN" ? 403
      : err.code === "NULLIFIER_DUPLICATE" ? 409
      : err.code === "ELECTION_SCOPE_MISMATCH" ? 422
      : err.code === "STATE_ROOT_MISMATCH" ? 422
      : err.code === "ASSOCIATION_ROOT_MISMATCH" ? 422
      : err.code === "INVALID_SCHEMA_VERSION" ? 422
      : err.code === "INVALID_SIGNAL_COUNT" ? 422
      : err.code === "INVALID_SIGNAL_KIND" ? 400
      : err.code === "INVALID_VOTE_RANGE" ? 422
      : err.code === "INVALID_OPTION_COUNT" ? 422
      : fallbackStatus;
    writeError(res, status, err.code, err.message, err.detail);
    return;
  }
  writeError(res, 500, "internal_error", err instanceof Error ? err.message : "unknown");
}

export function createSubmitRoute(deps: SubmitRouteDeps) {
  const now = deps.now ?? Date.now;

  return async function submitRoute(req: HttpRequestLike, res: HttpResponseLike, rawAddress: string): Promise<void> {
    if (req.method.toUpperCase() !== "POST") {
      writeError(res, 405, "method_not_allowed", "use POST");
      return;
    }
    const body = await readBody(req, deps.bodyLimitBytes);
    if (!body.ok) {
      // Frozen U0: 413 is observable. readBody has already dropped
      // buffered chunks and resumed the stream to drain; we set
      // Connection: close and write the 413. The server closes the
      // socket after writing the response — we MUST NOT destroy it
      // here, because the client must be able to read the 413.
      deps.logger.warn("relayer.body.tooLarge", {
        reason: body.reason ?? "body error",
        bodyLimitBytes: deps.bodyLimitBytes,
      });
      res.setHeader("connection", "close");
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
    // Audit U0: strict request validation. The `action` discriminator is
    // REQUIRED and must be exactly "cast" or "reveal". A missing or
    // unknown action is rejected before the body is inspected further.
    if (parsed === null || typeof parsed !== "object") {
      writeError(res, 400, "invalid_request", "body must be a JSON object");
      return;
    }
    const obj = parsed as Record<string, unknown>;
    const action = obj.action;
    if (action === "reveal") {
      kind = "reveal";
      try {
        validateRevealRequestShape(parsed);
        revealReq = parsed as RevealRequest;
      } catch (e) {
        writeProtocolError(res, e);
        return;
      }
    } else if (action === "cast") {
      kind = "cast";
      try {
        validateCastRequestShape(parsed, { maxProofBytes: deps.maxProofBytes });
        castReq = parsed as CastRequest;
      } catch (e) {
        writeProtocolError(res, e);
        return;
      }
    } else {
      writeError(res, 400, "invalid_request", `action discriminator is required and must be "cast" or "reveal" (got: ${String(action)})`);
      return;
    }

    const req2 = (castReq ?? revealReq)!;

    // Audit H1: rate-limit by privacy-preserving ephemeral per-window client
    // key, never by idempotencyKey. The raw address is hashed with a
    // rotating salt; only the opaque key is stored.
    const ephemeralKey = deps.clientKeyer.keyFor(rawAddress);
    const decision = deps.rateLimiter.check(ephemeralKey, now());
    if (!decision.allowed) {
      res.setHeader("retry-after", Math.ceil(decision.resetMs / 1000).toString());
      writeError(res, 429, "RELAYER_RATE_LIMITED", "too many requests for this client window", { resetMs: decision.resetMs });
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
      // Audit U0: never log clientTag. The redaction layer would still
      // scrub it, but the simpler invariant is to never emit it.
      deps.logger.info("relayer.submit.success", {
        kind,
        electionId: req2.electionId,
        txHash: (result as { txHash?: string | null }).txHash ?? null,
        status: (result as { status?: string }).status ?? null,
      });
      writeJson(res, 200, result);
    } catch (e) {
      // Audit H3: fail() deletes the entry so the caller can retry with the
      // same idempotency key.
      deps.idempotency.fail(req2.idempotencyKey, now());
      // Audit U0: no clientTag in error logs.
      deps.logger.error("relayer.submit.error", {
        kind,
        electionId: req2.electionId,
        error: e instanceof Error ? e.message : String(e),
      });
      writeProtocolError(res, e);
    }
  };
}

export type SubmitHandler = (req: HttpRequestLike, res: HttpResponseLike, fallbackIp: string) => Promise<void>;
