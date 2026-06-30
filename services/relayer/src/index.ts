import { listen, createDefaultDeps } from "./app.js";
import { Groth16SnarkjsVerifier, StellarSubmitter, SorobanSimulator } from "./adapters/snarkjsAdapter.js";
import { loadRelayerConfig } from "./config.js";

const config = loadRelayerConfig();
const deps = createDefaultDeps(config);

// Frozen U0: fail closed. The default factory wires the unconfigured
// snarkjs adapter; boot must abort unless the operator REPLACED the
// default factory with a real wired one. Production code MUST NOT
// import from `adapters/mockAdapters.ts` — this entry point only
// references the unconfigured production adapters, never the mocks.
function die(reason: string): never {
  process.stderr.write(`[relayer] refusing to start: ${reason}\n`);
  process.stderr.write(
    "[relayer] pass real R0/R1 VKs, a funded submitter secret, and a Soroban " +
    "horizon URL through services/relayer/src/adapters/snarkjsAdapter.ts, then " +
    "replace createDefaultDeps with a wired factory.\n",
  );
  process.exit(78);
}

if (deps.verifier instanceof Groth16SnarkjsVerifier) {
  die("default verifier is the unconfigured Groth16SnarkjsVerifier (no VKs loaded)");
}
if (deps.simulator instanceof SorobanSimulator) {
  die("default simulator is the unconfigured SorobanSimulator (no horizon URL loaded)");
}
if (deps.submitter instanceof StellarSubmitter) {
  die("default submitter is the unconfigured StellarSubmitter (no submitter secret loaded)");
}

const server = listen(deps);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    deps.logger.info("relayer.shutdown", { signal: sig });
    server.close(() => process.exit(0));
  });
}
