import { readFile } from "node:fs/promises";
import { ZkqProtocolError, canonicalJson } from "@zk-quorum/protocol";
import { AUDIT_BUNDLE_SCHEMA, type AuditBundleV1, type ProofArchiveEntry } from "./bundle.js";

/**
 * Integrator finding: every event's electionId MUST match the bundle's
 * electionId, and the proof archive must be bounded so a malicious bundle
 * cannot DoS the auditor.
 */
export const MAX_AUDIT_EVENTS = 50_000;
export const MAX_AUDIT_PROOF_ENTRIES = 50_000;
export const MAX_AUDIT_PROOF_PAYLOAD_BYTES = 32 * 1024;
export const MAX_AUDIT_STRING_LEN = 1024;
export const MAX_AUDIT_OBJECT_KEYS = 256;

const HEX32_RE = /^0x[0-9a-fA-F]{64}$/;
const CONTRACT_ID_RE = /^C[1-9A-HJ-NP-Za-km-z]{55}$/;
const TX_HASH_RE = /^[0-9a-fA-F]{64}$/;

function isHex32(value: unknown): value is `0x${string}` {
  return typeof value === "string" && HEX32_RE.test(value);
}

function checkBoundedString(value: string, label: string): void {
  if (value.length > MAX_AUDIT_STRING_LEN) {
    throw new ZkqProtocolError("BUNDLE_INVALID", `${label} exceeds ${MAX_AUDIT_STRING_LEN} chars`, { length: value.length });
  }
}

function checkBoundedKeys(obj: Record<string, unknown>, label: string): void {
  if (Object.keys(obj).length > MAX_AUDIT_OBJECT_KEYS) {
    throw new ZkqProtocolError("BUNDLE_INVALID", `${label} exceeds ${MAX_AUDIT_OBJECT_KEYS} keys`);
  }
}

function validateProofArchiveEntry(raw: unknown): ProofArchiveEntry {
  if (raw === null || typeof raw !== "object") {
    throw new ZkqProtocolError("ARCHIVE_MALFORMED", "proof archive entry must be an object");
  }
  const e = raw as Record<string, unknown>;
  if (typeof e.txHash !== "string" || !TX_HASH_RE.test(e.txHash)) {
    throw new ZkqProtocolError("ARCHIVE_MALFORMED", "proof archive txHash must be 32-byte hex without 0x", { txHash: e.txHash });
  }
  if (typeof e.proofHash !== "string" || !isHex32(e.proofHash)) {
    throw new ZkqProtocolError("ARCHIVE_MALFORMED", "proof archive proofHash must be 32-byte 0x hex");
  }
  if (typeof e.publicSignalsHash !== "string" || !isHex32(e.publicSignalsHash)) {
    throw new ZkqProtocolError("ARCHIVE_MALFORMED", "proof archive publicSignalsHash must be 32-byte 0x hex");
  }
  if (typeof e.payloadHex !== "string" || e.payloadHex.length === 0) {
    throw new ZkqProtocolError("ARCHIVE_MALFORMED", "proof archive payloadHex must be a non-empty hex string");
  }
  if (e.payloadHex.length / 2 > MAX_AUDIT_PROOF_PAYLOAD_BYTES) {
    throw new ZkqProtocolError("PAYLOAD_TOO_LARGE", `proof archive payload exceeds ${MAX_AUDIT_PROOF_PAYLOAD_BYTES} bytes`, { length: e.payloadHex.length / 2 });
  }
  return raw as ProofArchiveEntry;
}

function validateEvent(raw: unknown, bundleElectionId: `0x${string}`): { name: string; electionId: string } & Record<string, unknown> {
  if (raw === null || typeof raw !== "object") {
    throw new ZkqProtocolError("EVENT_SCHEMA_MISMATCH", "event must be an object");
  }
  const e = raw as Record<string, unknown>;
  if (typeof e.name !== "string") {
    throw new ZkqProtocolError("EVENT_SCHEMA_MISMATCH", "event.name required");
  }
  if (e.name !== "VoteCastV1" && e.name !== "VoteCommittedV1" && e.name !== "VoteRevealedV1") {
    throw new ZkqProtocolError("EVENT_SCHEMA_MISMATCH", `unknown event name: ${e.name}`);
  }
  if (typeof e.schema !== "string" || e.schema !== "v1") {
    throw new ZkqProtocolError("EVENT_SCHEMA_MISMATCH", "event.schema must be 'v1'");
  }
  if (typeof e.electionId !== "string" || !isHex32(e.electionId)) {
    throw new ZkqProtocolError("EVENT_SCHEMA_MISMATCH", "event.electionId must be 32-byte 0x hex");
  }
  if (e.electionId !== bundleElectionId) {
    throw new ZkqProtocolError("ELECTION_ID_MISMATCH", "event.electionId does not match bundle.electionId", { event: e.electionId, bundle: bundleElectionId });
  }
  if (typeof e.payload !== "object" || e.payload === null) {
    throw new ZkqProtocolError("EVENT_SCHEMA_MISMATCH", "event.payload must be an object");
  }
  checkBoundedKeys(e, "event");
  return e as { name: string; electionId: string } & Record<string, unknown>;
}

export function validateBundle(input: unknown): AuditBundleV1 {
  if (input === null || typeof input !== "object") {
    throw new ZkqProtocolError("BUNDLE_INVALID", "bundle must be a JSON object");
  }
  const b = input as Record<string, unknown>;
  if (b.schema !== AUDIT_BUNDLE_SCHEMA) {
    throw new ZkqProtocolError("BUNDLE_INVALID", `bundle schema must be ${AUDIT_BUNDLE_SCHEMA}`, { got: b.schema });
  }
  if (typeof b.electionId !== "string" || !isHex32(b.electionId)) {
    throw new ZkqProtocolError("BUNDLE_INVALID", "electionId must be 32-byte hex");
  }
  if (typeof b.manifestHash !== "string" || !isHex32(b.manifestHash)) {
    throw new ZkqProtocolError("BUNDLE_INVALID", "manifestHash must be 32-byte hex");
  }
  if (typeof b.contractId !== "string" || !CONTRACT_ID_RE.test(b.contractId)) {
    throw new ZkqProtocolError("BUNDLE_INVALID", "contractId must match Stellar C… format");
  }
  checkBoundedString(b.contractId, "contractId");
  if (typeof b.wasmHash !== "string" || !isHex32(b.wasmHash)) {
    throw new ZkqProtocolError("BUNDLE_INVALID", "wasmHash must be 32-byte hex");
  }
  if (typeof b.vkR0Hash !== "string" || !isHex32(b.vkR0Hash)) {
    throw new ZkqProtocolError("BUNDLE_INVALID", "vkR0Hash must be 32-byte hex");
  }
  if (typeof b.vkR1Hash !== "string" || !isHex32(b.vkR1Hash)) {
    throw new ZkqProtocolError("BUNDLE_INVALID", "vkR1Hash must be 32-byte hex");
  }
  if (typeof b.networkPassphrase !== "string") {
    throw new ZkqProtocolError("BUNDLE_INVALID", "networkPassphrase required");
  }
  checkBoundedString(b.networkPassphrase, "networkPassphrase");
  if (!Array.isArray(b.events)) {
    throw new ZkqProtocolError("BUNDLE_INVALID", "events must be an array");
  }
  if (b.events.length > MAX_AUDIT_EVENTS) {
    throw new ZkqProtocolError("PAYLOAD_TOO_LARGE", `events exceeds limit ${MAX_AUDIT_EVENTS}`, { length: b.events.length });
  }
  for (const ev of b.events) {
    validateEvent(ev, b.electionId as `0x${string}`);
  }
  if (!Array.isArray(b.proofArchive)) {
    throw new ZkqProtocolError("BUNDLE_INVALID", "proofArchive must be an array");
  }
  if (b.proofArchive.length > MAX_AUDIT_PROOF_ENTRIES) {
    throw new ZkqProtocolError("PAYLOAD_TOO_LARGE", `proofArchive exceeds limit ${MAX_AUDIT_PROOF_ENTRIES}`, { length: b.proofArchive.length });
  }
  for (const e of b.proofArchive) {
    validateProofArchiveEntry(e);
  }
  if (b.tallies === null || typeof b.tallies !== "object") {
    throw new ZkqProtocolError("BUNDLE_INVALID", "tallies must be an object");
  }
  const t = b.tallies as Record<string, unknown>;
  if (t.R0 === undefined || typeof t.R0 !== "object") {
    throw new ZkqProtocolError("BUNDLE_INVALID", "tallies.R0 must be an object");
  }
  if (t.R1 === undefined || typeof t.R1 !== "object") {
    throw new ZkqProtocolError("BUNDLE_INVALID", "tallies.R1 must be an object");
  }
  return input as AuditBundleV1;
}

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

export function canonicalBundle(bundle: AuditBundleV1): string {
  return canonicalJson(bundle);
}
