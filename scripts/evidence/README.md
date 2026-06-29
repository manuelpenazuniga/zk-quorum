# `@zk-quorum/evidence`

Helpers for assembling the load/run evidence required by plan §18 and
Gate A0/S0. This package does **no** network and **no** secret I/O.

## What it does

- `archiveFiles` — produces a content-addressed manifest of a list of
  files, with per-file SHA-256 and a deterministic overall hash.
- `writeArchive` / `verifyArchive` — write/verify a directory on disk.
- `summaryToMarkdown` — render a `RunSummary` as a Markdown report.

## Scripts

```bash
npm ci
npm test
npm run build
```

## Integration TODOs

See `EVIDENCE_INTEGRATION.md`.
