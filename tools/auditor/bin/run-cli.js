import { runCLI } from "../src/cli.ts";
import { exit, stderr } from "node:process";

try {
  const exitCode = await runCLI();
  exit(exitCode);
} catch (error) {
  stderr.write(`Unhandled exception: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  exit(2);
}
