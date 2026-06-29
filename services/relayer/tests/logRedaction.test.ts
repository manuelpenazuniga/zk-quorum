import { describe, it, expect } from "vitest";
import { DEFAULT_REDACTION_RULES, redactObject, createRedactingLogger } from "../src/services/logRedaction.js";

describe("log redaction", () => {
  it("redacts well-known secret fields", () => {
    const out = redactObject({
      nullifierSecret: "0xabc",
      trapdoor: "0xdef",
      seed: "should-not-appear",
      vote: 3,
      publicSignals: ["1", "2"],
    });
    expect(out).toEqual({
      nullifierSecret: "[redacted]",
      trapdoor: "[redacted]",
      seed: "[redacted]",
      vote: 3,
      publicSignals: ["1", "2"],
    });
  });

  it("redacts salt/secret-like hex fields", () => {
    const out = redactObject({
      salt: "0x" + "11".repeat(32),
      proofBytes: "0x" + "22".repeat(64),
      bearer: "abc",
      ip: "127.0.0.1",
    });
    expect(out.salt).toBe("[redacted]");
    expect(out.proofBytes).toBe("[redacted]");
    expect(out.bearer).toBe("[redacted]");
    expect(out.ip).toBe("[redacted]");
  });

  it("does not redact public nullifier hashes and addresses", () => {
    const out = redactObject({
      nullifierHash: "0x" + "aa".repeat(32),
      stateRoot: "0x" + "bb".repeat(32),
      publicKey: "0x" + "cc".repeat(64),
    });
    expect(out.nullifierHash).toBe("0x" + "aa".repeat(32));
    expect(out.stateRoot).toBe("0x" + "bb".repeat(32));
    expect(out.publicKey).toBe("0x" + "cc".repeat(64));
  });

  it("respects custom rules", () => {
    const out = redactObject({ token: "secret" }, [{ key: "token", replace: () => "***" }]);
    expect((out as { token: string }).token).toBe("***");
  });

  it("logger respects enabled flag and child bindings", () => {
    const lines: string[] = [];
    const log = createRedactingLogger({
      enabled: true,
      sink: (l) => lines.push(l),
    });
    const child = log.child({ account: "GABC" });
    child.info("submit", { nullifierSecret: "0xabc", ok: true });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.event).toBe("submit");
    expect(parsed.account).toBe("GABC");
    expect(parsed.nullifierSecret).toBe("[redacted]");
    expect(parsed.ok).toBe(true);
  });

  it("logger swallows when disabled", () => {
    const lines: string[] = [];
    const log = createRedactingLogger({ enabled: false, sink: (l) => lines.push(l) });
    log.info("x");
    expect(lines).toHaveLength(0);
  });

  it("default rules includes privacy fields", () => {
    expect(DEFAULT_REDACTION_RULES.length).toBeGreaterThan(0);
  });
});
