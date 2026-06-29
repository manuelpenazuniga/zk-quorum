# Evidence integration — exact TODOs for `wt/contract` and `wt/crypto`

The evidence package is intentionally minimal: it hashes and archives
files, it does not know about circuits, contracts, or relays. Production
wiring lives in the load harness and the CI audit job.

## 1. Load harness bridge

The load harness (planned for `scripts/load/`, not in this scaffold)
produces per-vote events, proof bytes, public signals, and tx hashes.
After each run it calls:

```ts
import { writeArchive, buildRunSummary, summaryToMarkdown } from "@zk-quorum/evidence";
import { canonicalJson } from "@zk-quorum/auditor";
import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync(`evidence/${runId}`, { recursive: true });
writeFileSync(`evidence/${runId}/bundle.json`, canonicalJson(bundle));
writeFileSync(`evidence/${runId}/summary.md`, summaryToMarkdown(summary));
const out = writeArchive({
  outDir: "evidence",
  runId,
  files: [
    { path: "bundle.json", content: canonicalJson(bundle), contentType: "application/json" },
    { path: "summary.md", content: summaryToMarkdown(summary), contentType: "text/markdown" },
  ],
});
console.log(`archive hash: ${out.manifest.archiveHash}`);
```

The bundle JSON matches `AUDIT_BUNDLE_V1` from `tools/auditor`. The
summary Markdown matches the format expected by `docs/evidence/load.md`.

## 2. CI evidence job

The CI job (planned for `.github/workflows/evidence.yml`, not in this
scaffold) downloads the archive, calls `zkq-auditor replay`, and
appends the result to `summary.md`. It then re-archives and uploads
the artefact as a GitHub release asset.

## 3. Hashes

The auditor already produces a SHA-256 manifest hash. The evidence
package re-hashes the files independently and compares; mismatch is a
finding.
