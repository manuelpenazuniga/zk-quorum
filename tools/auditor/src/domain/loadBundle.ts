import { readFile } from "node:fs/promises";
import { ZkqProtocolError } from "@zk-quorum/protocol";
import { AUDIT_BUNDLE_SCHEMA, type AuditBundleV1 } from "./bundle.js";

export async function loadBundleFromFile(path: string): Promise<AuditBundleV1> {
  const raw = await readFile(path, "utf8");
  return parseBundleJson(raw);
}

export function parseBundleJson(raw: string): AuditBundleV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new ZkqProtocolError("BUNDLE_INVALID", e instanceof Error ? e.message : "invalid JSON");
  }
  return validateBundle(parsed);
}

export function validateBundle(input: unknown): AuditBundleV1 {
  if (input === null || typeof input !== "object") {
    throw new ZkqProtocolError("BUNDLE_INVALID", "bundle must be a JSON object");
  }
  const b = input as Record<string, unknown>;
  if (b.schema !== AUDIT_BUNDLE_SCHEMA) {
    throw new ZkqProtocolError("BUNDLE_INVALID", `bundle schema must be ${AUDIT_BUNDLE_SCHEMA}`, { got: b.schema });
  }
  if (typeof b.electionId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(b.electionId)) {
    throw new ZkqProtocolError("BUNDLE_INVALID", "electionId must be 32-byte hex");
  }
  if (typeof b.manifestHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(b.manifestHash)) {
    throw new ZkqProtocolError("BUNDLE_INVALID", "manifestHash must be 32-byte hex");
  }
  if (typeof b.contractId !== "string") {
    throw new ZkqProtocolError("BUNDLE_INVALID", "contractId must be a string");
  }
  if (typeof b.wasmHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(b.wasmHash)) {
    throw new ZkqProtocolError("BUNDLE_INVALID", "wasmHash must be 32-byte hex");
  }
  if (typeof b.vkR0Hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(b.vkR0Hash)) {
    throw new ZkqProtocolError("BUNDLE_INVALID", "vkR0Hash must be 32-byte hex");
  }
  if (typeof b.vkR1Hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(b.vkR1Hash)) {
    throw new ZkqProtocolError("BUNDLE_INVALID", "vkR1Hash must be 32-byte hex");
  }
  if (typeof b.networkPassphrase !== "string") {
    throw new ZkqProtocolError("BUNDLE_INVALID", "networkPassphrase required");
  }
  if (!Array.isArray(b.events)) {
    throw new ZkqProtocolError("BUNDLE_INVALID", "events must be an array");
  }
  if (!Array.isArray(b.proofArchive)) {
    throw new ZkqProtocolError("BUNDLE_INVALID", "proofArchive must be an array");
  }
  if (b.tallies === null || typeof b.tallies !== "object") {
    throw new ZkqProtocolError("BUNDLE_INVALID", "tallies must be an object");
  }
  return input as AuditBundleV1;
}
