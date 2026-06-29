import { describe, it, expect } from "vitest";
import { writeArchive, verifyArchive } from "../src/collectBundle.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("collectBundle", () => {
  it("round-trips an archive", () => {
    const dir = mkdtempSync(join(tmpdir(), "zkq-evidence-"));
    const out = writeArchive({
      outDir: dir,
      runId: "run-1",
      files: [
        { path: "events.json", content: "[]", contentType: "application/json" },
        { path: "summary.md", content: "# run", contentType: "text/markdown" },
      ],
    });
    expect(out.manifest.fileCount).toBe(2);
    const ok = verifyArchive(out.outDir);
    expect(ok.ok).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects bad runId", () => {
    const dir = mkdtempSync(join(tmpdir(), "zkq-evidence-"));
    try {
      expect(() => writeArchive({ outDir: dir, runId: "../bad", files: [] })).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
