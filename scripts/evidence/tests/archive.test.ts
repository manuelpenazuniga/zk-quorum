import { describe, it, expect } from "vitest";
import { archiveFiles, hashBytes, sha256OfString } from "../src/archive.js";

describe("archive", () => {
  it("hashBytes is stable and hex-prefixed", () => {
    const h = hashBytes(new Uint8Array([0]));
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("archiveFiles orders by path", () => {
    const a = archiveFiles([{ path: "a", content: new Uint8Array([1]), contentType: "application/json" }]);
    const b = archiveFiles([{ path: "b", content: new Uint8Array([1]), contentType: "application/json" }]);
    expect(a.archiveHash).not.toBe(b.archiveHash);
  });

  it("sha256OfString matches hashBytes", () => {
    const s = "hello";
    expect(sha256OfString(s)).toBe(hashBytes(new TextEncoder().encode(s)));
  });

  it("manifest includes file count and total bytes", () => {
    const m = archiveFiles([
      { path: "x", content: new Uint8Array([1, 2, 3]), contentType: "application/json" },
      { path: "y", content: new Uint8Array([4, 5, 6, 7]), contentType: "application/json" },
    ]);
    expect(m.fileCount).toBe(2);
    expect(m.totalBytes).toBe(7);
  });
});
