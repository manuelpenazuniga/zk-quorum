import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ZkqProtocolError } from "@zk-quorum/protocol";
import type { Sha256Hex } from "@zk-quorum/protocol";
import { archiveFiles, hashBytes, type ArchiveFile, type ArchiveManifest } from "./archive.js";

export interface WriteArchiveArgs {
  readonly outDir: string;
  readonly runId: string;
  readonly files: ReadonlyArray<{ readonly path: string; readonly content: string; readonly contentType: string }>;
}

export interface WrittenArchive {
  readonly outDir: string;
  readonly manifest: ArchiveManifest;
  readonly manifestPath: string;
}

export function writeArchive(args: WriteArchiveArgs): WrittenArchive {
  if (!/^[a-zA-Z0-9_-]+$/.test(args.runId)) {
    throw new ZkqProtocolError("BUNDLE_INVALID", "runId must be alphanumeric / dash / underscore");
  }
  const outDir = resolve(args.outDir, args.runId);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const files: ArchiveFile[] = args.files.map((f) => ({
    path: f.path,
    content: new TextEncoder().encode(f.content),
    contentType: f.contentType,
  }));
  const manifest = archiveFiles(files);
  for (const f of files) {
    writeFileSync(join(outDir, f.path), f.content);
  }
  const manifestJson = JSON.stringify(manifest, (_k, v) => v, 2);
  const manifestPath = join(outDir, "MANIFEST.json");
  writeFileSync(manifestPath, manifestJson);
  return { outDir, manifest, manifestPath };
}

export function verifyArchive(outDir: string): { ok: boolean; manifest: ArchiveManifest | null; reason: string | null } {
  const manifestPath = join(outDir, "MANIFEST.json");
  if (!existsSync(manifestPath)) {
    return { ok: false, manifest: null, reason: `missing ${manifestPath}` };
  }
  const manifest = JSON.parse(require("node:fs").readFileSync(manifestPath, "utf8")) as ArchiveManifest;
  for (const e of manifest.entries) {
    const p = join(outDir, e.path);
    if (!existsSync(p)) {
      return { ok: false, manifest, reason: `missing file ${p}` };
    }
    const bytes = new Uint8Array(require("node:fs").readFileSync(p));
    if (hashBytes(bytes) !== (e.sha256 as Sha256Hex)) {
      return { ok: false, manifest, reason: `hash mismatch for ${p}` };
    }
  }
  return { ok: true, manifest, reason: null };
}
