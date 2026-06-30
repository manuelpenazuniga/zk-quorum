import { describe, it, expect } from "vitest";
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
