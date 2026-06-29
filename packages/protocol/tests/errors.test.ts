import { describe, it, expect } from "vitest";
import { ZkqProtocolError, isZkqProtocolError } from "../src/errors.js";

describe("errors", () => {
  it("carries code, detail and JSON shape", () => {
    const err = new ZkqProtocolError("INVALID_HEX", "boom", { foo: 1 });
    expect(err.code).toBe("INVALID_HEX");
    expect(err.detail).toEqual({ foo: 1 });
    const json = err.toJSON();
    expect(json.name).toBe("ZkqProtocolError");
    expect(json.code).toBe("INVALID_HEX");
    expect(json.detail).toEqual({ foo: 1 });
  });

  it("isZkqProtocolError discriminates", () => {
    expect(isZkqProtocolError(new ZkqProtocolError("INVALID_HEX", "x"))).toBe(true);
    expect(isZkqProtocolError(new Error("plain"))).toBe(false);
    expect(isZkqProtocolError("string")).toBe(false);
  });
});
