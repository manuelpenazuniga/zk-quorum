import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "../src/cli.js";
import { ZkqProtocolError } from "@zk-quorum/protocol";

describe("auditor CLI parseArgs", () => {
  it("parses help", () => {
    const args = parseArgs(["--help"]);
    expect(args.command).toBe("help");
  });

  it("parses verify with defaults", () => {
    const args = parseArgs(["verify", "--bundle", "/tmp/bundle.json"]);
    expect(args.command).toBe("verify");
    expect(args.bundle).toBe("/tmp/bundle.json");
    expect(args.r0Options).toBe(5);
    expect(args.r1Options).toBe(5);
  });

  it("rejects --verifier static-accept (production CLI does not expose it)", () => {
    expect(() =>
      parseArgs([
        "verify",
        "--bundle",
        "/tmp/bundle.json",
        "--verifier",
        "static-accept:0xabab:0xcdcd",
      ])
    ).toThrow(ZkqProtocolError);
  });

  it("rejects --verifier noop (no verifier flag is supported)", () => {
    expect(() => parseArgs(["verify", "--bundle", "/tmp/bundle.json", "--verifier", "noop"])).toThrow(
      ZkqProtocolError,
    );
  });

  it("rejects unknown command", () => {
    expect(() => parseArgs(["unknown", "--bundle", "/tmp/bundle.json"])).toThrow(ZkqProtocolError);
  });
});

describe("auditor CLI entrypoint guard", () => {
  it("importing cli.ts as a module does not run main or call process.exit", async () => {
    // The module has already been imported at the top of this file. If the
    // suffix-based guard had matched the vitest runner path, main() would
    // have run and exited the process before we reached here.
    expect(parseArgs).toBeInstanceOf(Function);
  });

  it("real CLI execution prints usage and exits 0 for --help", () => {
    const cliPath = resolve("src/cli.ts");
    const out = execFileSync("npx", ["tsx", cliPath, "--help"], {
      encoding: "utf8",
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(out).toContain("Usage: zkq-auditor");
    expect(out).toContain("--bundle");
  });
});
