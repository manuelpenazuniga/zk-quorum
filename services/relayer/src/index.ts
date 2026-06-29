import { listen } from "./app.js";
import { createDefaultDeps } from "./app.js";
import { loadRelayerConfig } from "./config.js";

const config = loadRelayerConfig();
const deps = createDefaultDeps(config);
const server = listen(deps);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    deps.logger.info("relayer.shutdown", { signal: sig });
    server.close(() => process.exit(0));
  });
}
