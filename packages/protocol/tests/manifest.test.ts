import { describe, it, expect } from "vitest";
import { ZKQ_PROTOCOL_VERSION, ZKQ_PROTOCOL_API_VERSION } from "../src/version.js";
import { MANIFEST_VERSION } from "../src/manifest.js";

describe("version constants", () => {
  it("uses pinned protocol version", () => {
    expect(ZKQ_PROTOCOL_VERSION).toBe("0.0.0");
    expect(ZKQ_PROTOCOL_API_VERSION).toBe("v1");
    expect(MANIFEST_VERSION).toBe("v1");
  });
});
