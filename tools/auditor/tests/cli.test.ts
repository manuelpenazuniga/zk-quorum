import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
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
    const binPath = resolve("bin/zkq-auditor.js");
    const out = execFileSync(process.execPath, [binPath, "--help"], {
      encoding: "utf8",
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(out).toContain("Usage: zkq-auditor");
    expect(out).toContain("--bundle");
  });

  it("package.json bin points to a file that actually exists", () => {
    const pkgContent = readFileSync(resolve("package.json"), "utf8");
    const pkg = JSON.parse(pkgContent);
    expect(pkg.bin).toBeDefined();
    for (const binPath of Object.values(pkg.bin)) {
      const resolved = resolve(binPath as string);
      expect(existsSync(resolved)).toBe(true);
    }
  });

  it("smoke test of the real bin executes directly without npx and prints usage", () => {
    const pkgContent = readFileSync(resolve("package.json"), "utf8");
    const pkg = JSON.parse(pkgContent);
    const binPath = resolve(pkg.bin["zkq-auditor"]);

    // Test direct shebang execution since we did chmod +x
    const outDirect = execFileSync(binPath, ["--help"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(outDirect).toContain("Usage: zkq-auditor");
    expect(outDirect).toContain("--bundle");

    // Also test execution via node process.execPath (Node 24)
    const outNode = execFileSync(process.execPath, [binPath, "--help"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(outNode).toContain("Usage: zkq-auditor");
    expect(outNode).toContain("--bundle");
  });

  it("propagates non-zero exit code on invalid arguments/command", () => {
    const pkgContent = readFileSync(resolve("package.json"), "utf8");
    const pkg = JSON.parse(pkgContent);
    const binPath = resolve(pkg.bin["zkq-auditor"]);

    try {
      execFileSync(process.execPath, [binPath, "invalid-cmd"], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      throw new Error("Expected command to fail");
    } catch (e: any) {
      expect(e.status).toBe(2);
    }
  });

  it("propagates non-zero exit code on missing bundle option", () => {
    const pkgContent = readFileSync(resolve("package.json"), "utf8");
    const pkg = JSON.parse(pkgContent);
    const binPath = resolve(pkg.bin["zkq-auditor"]);

    try {
      execFileSync(process.execPath, [binPath, "verify"], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      throw new Error("Expected command to fail");
    } catch (e: any) {
      expect(e.status).toBe(2);
    }
  });
});
