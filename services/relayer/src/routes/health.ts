import type { RedactingLogger } from "../services/logRedaction.js";
import type { RelayerConfig } from "../config.js";
import { isMethod, writeError, type HttpRequestLike, type HttpResponseLike } from "../middleware/http.js";

export function createHealthRoute(config: RelayerConfig, logger: RedactingLogger) {
  return async function healthRoute(req: HttpRequestLike, res: HttpResponseLike): Promise<void> {
    if (!isMethod(req, "GET")) {
      writeError(res, 405, "method_not_allowed", "use GET");
      return;
    }
    res.setHeader("cache-control", "no-store");
    res.statusCode = 200;
    res.end(JSON.stringify({
      status: "ok",
      service: "zk-quorum-relayer",
      version: "0.0.0",
      submitter: config.submitterAccount,
      bodyLimitBytes: config.bodyLimitBytes,
      ratePerMinute: config.ratePerMinute,
      rateWindowMs: config.rateWindowMs,
      queueConcurrency: config.queueConcurrency,
    }));
    logger.info("health.check");
  };
}
