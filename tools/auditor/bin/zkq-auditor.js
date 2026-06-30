#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { argv, env, exit } from "node:process";

if (env.ZK_AUDITOR_RUNNING_WITH_TSX === "true") {
  // Dynamically import the TS entrypoint (since tsx is imported)
  const cli = await import("../src/cli.ts");
  const exitCode = await cli.runCLI();
  exit(exitCode);
} else {
  const currentFilePath = fileURLToPath(import.meta.url);
  const nodeBinary = argv[0] ?? "node";
  const args = [
    "--import",
    "tsx",
    currentFilePath,
    ...argv.slice(2)
  ];

  const result = spawnSync(nodeBinary, args, {
    stdio: "inherit",
    env: {
      ...env,
      ZK_AUDITOR_RUNNING_WITH_TSX: "true"
    }
  });

  exit(result.status ?? 0);
}
