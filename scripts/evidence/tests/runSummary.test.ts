import { describe, it, expect } from "vitest";
import { buildRunSummary, summaryToMarkdown } from "../src/runSummary.js";

describe("runSummary", () => {
  it("builds a summary object", () => {
    const s = buildRunSummary({
      runId: "r1",
      toolVersions: { node: "24.2.0" },
      counts: { proofs: 5 },
      buckets: { 0: 1, 1: 2, 2: 2 },
      errors: [],
      rootHashes: { state: "0x00" },
      wasmHash: "0x" + "00".repeat(32),
      vkR0Hash: "0x" + "11".repeat(32),
      vkR1Hash: "0x" + "22".repeat(32),
      contractId: "C...",
      txHashes: ["tx-1"],
      extras: { foo: true },
    });
    expect(s.runId).toBe("r1");
  });

  it("markdown includes all sections", () => {
    const s = buildRunSummary({
      runId: "r1",
      toolVersions: { node: "24.2.0" },
      counts: { proofs: 1 },
      buckets: { 0: 1 },
      errors: ["nope"],
      rootHashes: { state: "0x" + "aa".repeat(32) },
      wasmHash: "0x" + "00".repeat(32),
      vkR0Hash: "0x" + "11".repeat(32),
      vkR1Hash: "0x" + "22".repeat(32),
      contractId: "C...",
      txHashes: ["tx-1", "tx-2"],
      extras: {},
    });
    const md = summaryToMarkdown(s);
    expect(md).toContain("# Run summary — r1");
    expect(md).toContain("## Tool versions");
    expect(md).toContain("## Counts");
    expect(md).toContain("## Bucket histogram");
    expect(md).toContain("## Errors");
    expect(md).toContain("- nope");
  });
});
