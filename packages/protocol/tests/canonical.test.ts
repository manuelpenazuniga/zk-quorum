import { describe, it, expect } from "vitest";
import { canonicalJson, isCanonicalJson } from "../src/canonical.js";
import { ZkqProtocolError } from "../src/errors.js";

describe("canonicalJson (audit M4)", () => {
  it("sorts object keys recursively", () => {
    const a = canonicalJson({ b: 1, a: { d: 2, c: 3 } });
    expect(a).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("preserves array order", () => {
    const a = canonicalJson({ arr: [3, 1, 2] });
    expect(a).toBe('{"arr":[3,1,2]}');
  });

  it("drops undefined and functions", () => {
    const a = canonicalJson({ a: 1, b: undefined, c: () => 42 } as Record<string, unknown>);
    expect(a).toBe('{"a":1}');
  });

  it("encodes bigint with explicit tag", () => {
    const a = canonicalJson({ n: 5n });
    expect(a).toBe('{"n":"__bigint__:5"}');
  });

  it("rejects Map/Set", () => {
    expect(() => canonicalJson(new Map([["a", 1]]))).toThrow(ZkqProtocolError);
    expect(() => canonicalJson(new Set([1, 2]))).toThrow(ZkqProtocolError);
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalJson({ x: NaN })).toThrow(ZkqProtocolError);
    expect(() => canonicalJson({ x: Infinity })).toThrow(ZkqProtocolError);
  });

  it("is order-independent across key orderings", () => {
    const a = canonicalJson({ a: 1, b: 2, c: 3 });
    const b = canonicalJson({ c: 3, b: 2, a: 1 });
    const c = canonicalJson({ a: 1, c: 3, b: 2 });
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it("isCanonicalJson accepts canonical form and rejects non-canonical", () => {
    expect(isCanonicalJson('{"a":1,"b":2}')).toBe(true);
    expect(isCanonicalJson('{"b":2,"a":1}')).toBe(false);
    expect(isCanonicalJson("not json")).toBe(false);
  });

  it("rejects nested Map in input", () => {
    expect(() => canonicalJson({ inner: new Map([["k", "v"]]) })).toThrow(ZkqProtocolError);
  });
});
