import { argv, exit, stderr, stdout } from "node:process";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { loadAndReplay, NoopVerifierAdapter, type AuditSummary } from "./index_lib.js";
import { ZkqProtocolError, isZkqProtocolError } from "@zk-quorum/protocol";

interface ParsedArgs {
  readonly command: "verify" | "replay" | "tally" | "r1" | "help";
  readonly bundle?: string;
  readonly r0Options: number;
  readonly r1Options: number;
  readonly expectedTally: string | null;
  readonly json: boolean;
}

function usage(): string {
  return [
    "Usage: zkq-auditor <command> [options]",
    "",
    "Commands:",
    "  verify  Verify hashes, dedup, schema, R1 commit/reveal integrity",
    "  replay  Re-run reconstruction and compare against expected tally",
    "  tally   Reconstruct tally counts from the local bundle",
    "  r1      Audit R1 commit/reveal/non-reveal counts",
    "  help    Print this message",
    "",
    "Options:",
    "  --bundle <path>        Path to AUDIT_BUNDLE_V1 (JSON)",
    "  --r0-options <n>       Number of options for R0 tally (default 5)",
    "  --r1-options <n>       Number of options for R1 tally (default 5)",
    "  --expected-tally <csv> Comma-separated expected R0 counts (replay only)",
    "  --json                 Emit machine-readable JSON on stdout",
    "",
    "Exit code: 0 on ok, 1 on any finding, 2 on usage error.",
  ].join("\n");
}

export function parseArgs(args: string[]): ParsedArgs {
  const cmd = args[0];
  if (cmd === undefined || cmd === "help" || cmd === "-h" || cmd === "--help") {
    return { command: "help", r0Options: 5, r1Options: 5, expectedTally: null, json: false };
  }
  if (cmd !== "verify" && cmd !== "replay" && cmd !== "tally" && cmd !== "r1") {
    throw new ZkqProtocolError("ADAPTER_NOT_CONFIGURED", `unknown command: ${cmd}`);
  }
  let bundle: string | undefined;
  let r0Options = 5;
  let r1Options = 5;
  let expectedTally: string | null = null;
  let json = false;
  for (let i = 1; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === "--bundle") {
      bundle = args[++i];
    } else if (a === "--r0-options") {
      r0Options = Number.parseInt(args[++i] ?? "5", 10);
    } else if (a === "--r1-options") {
      r1Options = Number.parseInt(args[++i] ?? "5", 10);
    } else if (a === "--expected-tally") {
      expectedTally = args[++i] ?? null;
    } else if (a === "--json") {
      json = true;
    } else if (a === "--verifier") {
      // Frozen U0: the production CLI does not expose a static-accept
      // verifier. A real Groth16 adapter must be wired here; until then
      // the default NoopVerifierAdapter refuses every proof.
      throw new ZkqProtocolError("ADAPTER_NOT_CONFIGURED", "--verifier is not supported; wire a real Groth16 adapter");
    }
  }
  if (bundle === undefined) {
    throw new ZkqProtocolError("BUNDLE_INVALID", "--bundle is required");
  }
  return { command: cmd, bundle, r0Options, r1Options, expectedTally, json };
}

function parseExpectedTally(csv: string | null): bigint[] | null {
  if (csv === null) return null;
  return csv.split(",").map((s) => BigInt(s.trim()));
}

async function main(): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv.slice(2));
  } catch (e) {
    stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    stderr.write(usage() + "\n");
    return 2;
  }
  if (args.command === "help") {
    stdout.write(usage() + "\n");
    return 0;
  }

  const bundlePath = args.bundle!;
  let summary: AuditSummary;
  try {
    const { summary: s } = await loadAndReplay(bundlePath, {
      verifier: new NoopVerifierAdapter(),
      r0Options: args.r0Options,
      r1Options: args.r1Options,
      expectedTally: parseExpectedTally(args.expectedTally),
      exitOnFailure: false,
    });
    summary = s;
  } catch (e) {
    if (isZkqProtocolError(e)) {
      stderr.write(`[${e.code}] ${e.message}\n`);
      return 2;
    }
    stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
  if (args.json) {
    stdout.write(JSON.stringify(summary, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
  } else {
    const r0Total = summary.totals.r0.tally.toString();
    const r1Total = summary.totals.r1.tally.toString();
    stdout.write(`electionId     : ${summary.electionId}\n`);
    stdout.write(`verifier       : noop (configured=${summary.verifierConfigured})\n`);
    stdout.write(`R0 commits     : ${summary.totals.r0.commits} (tally=${r0Total})\n`);
    stdout.write(`R1 commits     : ${summary.totals.r1.commits}\n`);
    stdout.write(`R1 reveals     : ${summary.totals.r1.reveals}\n`);
    stdout.write(`R1 non-reveals : ${summary.totals.r1.nonReveals}\n`);
    stdout.write(`R1 tally       : ${r1Total}\n`);
    stdout.write(`dup nullifiers : ${summary.duplicateNullifiers.length}\n`);
    stdout.write(`r1 double rev. : ${summary.r1DoubleReveals.length}\n`);
    stdout.write(`r1 reveal/comm : ${summary.r1RevealsWithoutCommit.length}\n`);
    stdout.write(`r1 no bucket   : ${summary.r1RevealsMissingBucket.length}\n`);
    stdout.write(`hash mismatch  : ${summary.mismatchedHashes.length}\n`);
  }
  if (!summary.ok || summary.errors.length > 0) {
    return 1;
  }
  return 0;
}

// Only auto-run when this file is the process entry point. Tests import
// parseArgs without triggering side effects. Use exact file-URL comparison
// (not a suffix check) so importing cli.ts as a module never runs main().
const entryArg = argv[1];
if (entryArg !== undefined) {
  const entryUrl = pathToFileURL(resolve(entryArg));
  const thisUrl = pathToFileURL(resolve(fileURLToPath(import.meta.url)));
  if (entryUrl.href === thisUrl.href) {
    main().then(
      (code) => exit(code),
      (e) => {
        stderr.write(`fatal: ${e instanceof Error ? e.message : String(e)}\n`);
        exit(2);
      },
    );
  }
}
