import { describe, it, expect } from "vitest";
import { loadRelayerConfig } from "../src/config.js";

describe("config", () => {
  it("returns defaults when no env", () => {
    const c = loadRelayerConfig({});
    expect(c.port).toBe(8787);
    expect(c.host).toBe("127.0.0.1");
    expect(c.bodyLimitBytes).toBe(64 * 1024);
    expect(c.ratePerMinute).toBe(60);
    expect(c.queueConcurrency).toBe(1);
    expect(c.enableLogging).toBe(true);
  });

  it("reads env overrides", () => {
    const c = loadRelayerConfig({
      ZKQ_RELAYER_PORT: "9000",
      ZKQ_RELAYER_BODY_LIMIT: "1024",
      ZKQ_RELAYER_LOG: "0",
      ZKQ_RELAYER_SUBMITTER: "GABC",
    });
    expect(c.port).toBe(9000);
    expect(c.bodyLimitBytes).toBe(1024);
    expect(c.enableLogging).toBe(false);
    expect(c.submitterAccount).toBe("GABC");
  });

  it("rejects non-numeric env", () => {
    expect(() => loadRelayerConfig({ ZKQ_RELAYER_PORT: "abc" })).toThrow();
  });
});
