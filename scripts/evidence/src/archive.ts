import { createHash } from "node:crypto";
import type { Sha256Hex } from "@zk-quorum/protocol";

export interface ArchiveFile {
  readonly path: string;
  readonly content: Uint8Array;
  readonly contentType: string;
}

export interface ArchiveManifest {
  readonly archiveHash: Sha256Hex;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly entries: ReadonlyArray<{ readonly path: string; readonly sha256: Sha256Hex; readonly sizeBytes: number; readonly contentType: string }>;
}

export interface ProofArchiveEntry {
  readonly proofHash: Sha256Hex;
  readonly publicSignalsHash: Sha256Hex;
  readonly payloadHex: string;
  readonly txHash: string;
}

export function hashBytes(b: Uint8Array): Sha256Hex {
  return ("0x" + createHash("sha256").update(b).digest("hex")) as Sha256Hex;
}

export function archiveFiles(files: ReadonlyArray<ArchiveFile>): ArchiveManifest {
  const entries = files.map((f) => ({
    path: f.path,
    sha256: hashBytes(f.content),
    sizeBytes: f.content.length,
    contentType: f.contentType,
  }));
  const h = createHash("sha256");
  for (const e of entries) {
    h.update(e.path);
    h.update("\0");
    h.update(e.sha256);
    h.update("\0");
    h.update(String(e.sizeBytes));
    h.update("\0");
    h.update(e.contentType);
    h.update("\n");
  }
  const totalBytes = entries.reduce((a, e) => a + e.sizeBytes, 0);
  return {
    archiveHash: ("0x" + h.digest("hex")) as Sha256Hex,
    fileCount: entries.length,
    totalBytes,
    entries,
  };
}

export function proofArchiveEntryFromHex(proofHash: Sha256Hex, publicSignalsHash: Sha256Hex, payloadHex: string, txHash: string): ProofArchiveEntry {
  return { proofHash, publicSignalsHash, payloadHex, txHash };
}

export function sha256OfString(s: string): Sha256Hex {
  return hashBytes(new TextEncoder().encode(s));
}
