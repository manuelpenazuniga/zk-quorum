/**
 * Production request validation for the relayer. Mocks import from this
 * file; production code MUST NOT import any symbol from
 * `adapters/mockAdapters.ts`.
 *
 * Audit U0 frozen wire format:
 *   - Cast:  action="cast", publicSignals is EXACTLY six canonical
 *            decimal Fr strings, parsePublicSignals is invoked here so
 *            a malformed shape is rejected before any adapter runs.
 *   - Reveal: action="reveal", vote is a JS integer in [0, 15], salt
 *             is 32-byte hex (lower- or upper-case) and the numeric
 *             value of the salt satisfies 0 < salt < Fr.
 */
import type { CastRequest, RevealRequest } from "@zk-quorum/protocol";
import {
  BLS12_381_FR_MODULUS,
  parsePublicSignals,
  PUBLIC_SCHEMA_V1_R0,
  PUBLIC_SCHEMA_V1_R1,
  ZkqProtocolError,
} from "@zk-quorum/protocol";

const HEX32_RE = /^0x[0-9a-fA-F]{64}$/;
const REVEAL_VOTE_MIN = 0;
const REVEAL_VOTE_MAX = 15;
const CAST_SIGNAL_COUNT = 6;

const CAST_KEYS: ReadonlySet<string> = new Set([
  "action",
  "electionId",
  "publicSchemaId",
  "publicSignals",
  "proofBytes",
  "idempotencyKey",
  "clientTag",
]);

const REVEAL_KEYS: ReadonlySet<string> = new Set([
  "action",
  "electionId",
  "ballotCommitment",
  "vote",
  "salt",
  "idempotencyKey",
  "clientTag",
]);

function checkAllowlist(r: Record<string, unknown>, allow: ReadonlySet<string>, label: string): void {
  for (const k of Object.keys(r)) {
    if (!allow.has(k)) {
      throw new ZkqProtocolError(
        "INVALID_SIGNAL_KIND",
        `${label} contains unknown key '${k}'`,
        { key: k, allowlist: Array.from(allow) },
      );
    }
  }
}

function requireString(r: Record<string, unknown>, key: string): string {
  const v = r[key];
  if (typeof v !== "string") {
    throw new ZkqProtocolError("MISSING_PUBLIC_SIGNAL", `${key} must be a string`, { key });
  }
  return v;
}

function requireExactAction(r: Record<string, unknown>, expected: "cast" | "reveal"): void {
  const a = r.action;
  if (a !== expected) {
    throw new ZkqProtocolError(
      "INVALID_SIGNAL_KIND",
      `action discriminator must be exactly "${expected}"`,
      { action: a, expected },
    );
  }
}

export interface ValidateCastOptions {
  /** Hard upper bound on proofBytes size (in bytes). The schema requires
   *  exactly 6 signals; this is the only max-style check on cast inputs. */
  readonly maxProofBytes: number;
}

export function validateCastRequestShape(req: unknown, options: ValidateCastOptions): asserts req is CastRequest {
  if (req === null || typeof req !== "object") {
    throw new ZkqProtocolError("MISSING_PUBLIC_SIGNAL", "body must be a JSON object");
  }
  const r = req as Record<string, unknown>;
  checkAllowlist(r, CAST_KEYS, "cast request");
  requireExactAction(r, "cast");

  const electionId = requireString(r, "electionId");
  if (!HEX32_RE.test(electionId)) {
    throw new ZkqProtocolError("MISSING_PUBLIC_SIGNAL", "electionId must be 32-byte hex");
  }

  const publicSchemaId = requireString(r, "publicSchemaId");
  const schema = publicSchemaId === PUBLIC_SCHEMA_V1_R0.id
    ? PUBLIC_SCHEMA_V1_R0
    : publicSchemaId === PUBLIC_SCHEMA_V1_R1.id
      ? PUBLIC_SCHEMA_V1_R1
      : (() => { throw new ZkqProtocolError("INVALID_SCHEMA_VERSION", `publicSchemaId not supported: ${publicSchemaId}`, { publicSchemaId }); })();

  if (!Array.isArray(r.publicSignals)) {
    throw new ZkqProtocolError("INVALID_SIGNAL_COUNT", "publicSignals must be an array");
  }
  if (r.publicSignals.length !== CAST_SIGNAL_COUNT) {
    throw new ZkqProtocolError(
      "INVALID_SIGNAL_COUNT",
      `cast requires exactly ${CAST_SIGNAL_COUNT} canonical decimal Fr signals (got ${r.publicSignals.length})`,
      { expected: CAST_SIGNAL_COUNT, actual: r.publicSignals.length },
    );
  }
  // Frozen U0: parse immediately. canonical-decimal + [0,r) + slot order
  // are all enforced here. A max-only acceptance is not allowed.
  parsePublicSignals(schema, r.publicSignals as ReadonlyArray<string>);

  const proofBytes = requireString(r, "proofBytes");
  if (!/^0x[0-9a-fA-F]*$/.test(proofBytes) || (proofBytes.length - 2) % 2 !== 0) {
    throw new ZkqProtocolError("INVALID_HEX", "proofBytes must be 0x hex with even length");
  }
  const proofBytesLen = (proofBytes.length - 2) / 2;
  if (proofBytesLen > options.maxProofBytes) {
    throw new ZkqProtocolError(
      "PAYLOAD_TOO_LARGE",
      `proofBytes exceeds limit ${options.maxProofBytes}`,
      { length: proofBytesLen },
    );
  }

  const idempotencyKey = requireString(r, "idempotencyKey");
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw new ZkqProtocolError("RELAYER_IDEMPOTENT_REPLAY", "idempotencyKey length must be in [8, 128]");
  }

  const clientTag = requireString(r, "clientTag");
  if (clientTag.length < 1 || clientTag.length > 64) {
    throw new ZkqProtocolError("MISSING_PUBLIC_SIGNAL", "clientTag length must be in [1, 64]");
  }
}

export interface ValidateRevealOptions {
  /** Reserved for future use; reveal body has no max-style limit beyond
   *  the vote range and salt Fr check. */
  readonly _reserved?: never;
}

export function validateRevealRequestShape(req: unknown, _options: ValidateRevealOptions = {}): asserts req is RevealRequest {
  if (req === null || typeof req !== "object") {
    throw new ZkqProtocolError("MISSING_PUBLIC_SIGNAL", "body must be a JSON object");
  }
  const r = req as Record<string, unknown>;
  checkAllowlist(r, REVEAL_KEYS, "reveal request");
  requireExactAction(r, "reveal");

  const electionId = requireString(r, "electionId");
  if (!HEX32_RE.test(electionId)) {
    throw new ZkqProtocolError("MISSING_PUBLIC_SIGNAL", "electionId must be 32-byte hex");
  }

  const ballotCommitment = requireString(r, "ballotCommitment");
  if (!HEX32_RE.test(ballotCommitment)) {
    throw new ZkqProtocolError("MISSING_PUBLIC_SIGNAL", "ballotCommitment must be 32-byte hex");
  }

  if (typeof r.vote !== "number" || !Number.isInteger(r.vote) || r.vote < REVEAL_VOTE_MIN || r.vote > REVEAL_VOTE_MAX) {
    throw new ZkqProtocolError(
      "INVALID_VOTE_RANGE",
      `vote must be an integer in [${REVEAL_VOTE_MIN}, ${REVEAL_VOTE_MAX}]`,
      { vote: r.vote },
    );
  }

  const salt = requireString(r, "salt");
  if (!HEX32_RE.test(salt)) {
    throw new ZkqProtocolError("R1_NON_ZERO_SALT", "salt must be 32-byte hex (0x + 64 chars, lower- or upper-case)");
  }
  // Salt numeric value must satisfy 0 < salt < Fr. We accept the hex in
  // either case; the comparison is case-insensitive via BigInt directly.
  const saltBi = BigInt(salt);
  if (saltBi <= 0n) {
    throw new ZkqProtocolError("R1_NON_ZERO_SALT", "salt must be strictly positive");
  }
  if (saltBi >= BLS12_381_FR_MODULUS) {
    throw new ZkqProtocolError(
      "INVALID_FIELD_ELEMENT",
      "salt numeric value must be strictly less than the BLS12-381 Fr modulus",
      { saltLength: salt.length },
    );
  }

  const idempotencyKey = requireString(r, "idempotencyKey");
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw new ZkqProtocolError("RELAYER_IDEMPOTENT_REPLAY", "idempotencyKey length must be in [8, 128]");
  }

  const clientTag = requireString(r, "clientTag");
  if (clientTag.length < 1 || clientTag.length > 64) {
    throw new ZkqProtocolError("MISSING_PUBLIC_SIGNAL", "clientTag length must be in [1, 64]");
  }
}
