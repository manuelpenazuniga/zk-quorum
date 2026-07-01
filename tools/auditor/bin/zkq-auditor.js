#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { argv, exit, stderr } from "node:process";

const nodeBinary = argv[0] ?? "node";
const runCliPath = fileURLToPath(new URL("./run-cli.js", import.meta.url));

const args = [
  "--import",
  "tsx",
  runCliPath,
  ...argv.slice(2)
];

const result = spawnSync(nodeBinary, args, {
  stdio: "inherit"
});

if (result.error) {
  stderr.write(`Spawn error: ${result.error.message}\n`);
  exit(255);
}

if (result.signal !== null) {
  stderr.write(`Spawn terminated by signal: ${result.signal}\n`);
  exit(255);
}

if (result.status === null) {
  stderr.write(`Spawn exit status is null\n`);
  exit(255);
}

exit(result.status);
