import type { Bytes32Hex, ElectionId, NullifierHash, RootHash, VoteValue, OptionCount } from "./ids.js";
import { ZkqProtocolError } from "./errors.js";
import { ZKQ_PUBLIC_SCHEMA_R0, ZKQ_PUBLIC_SCHEMA_R1 } from "./version.js";
import { BLS12_381_FR_MODULUS } from "./scope.js";

/**
 * Canonical decimal wire format for Fr elements. Accepted forms are EXACTLY:
 *   - "0" (single zero digit), or
 *   - a non-empty sequence of ASCII decimal digits with NO leading zeros,
 *     i.e. the first digit is "1".."9" and the rest are "0".."9".
 *
 * Forms that are REJECTED:
 *   - the empty string, " ", "+0", "-0", "0x0", "00", "007", "0_0".
 *   - any non-ASCII character.
 *   - the literal "0" followed by anything other than end-of-string.
 *   - any "0x" / "0X" prefix — the public signal wire format is decimal.
 *
 * Every public signal slot in both R0 and R1 is a Circom Fr element and
 * therefore arrives over the wire in this canonical decimal form. The
 * relayer, the auditor, and the contract-side parsers all share this
 * rule: a public signal that is not a canonical decimal Fr string is
 * rejected before any domain check runs.
 */
export const CANONICAL_DECIMAL_ZERO = "0";
export const CANONICAL_DECIMAL_RE = /^(?:0|[1-9][0-9]*)$/;

export function isCanonicalDecimalWire(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_DECIMAL_RE.test(value);
}

export function parseCanonicalFrElement(value: unknown, label: string): bigint {
  if (!isCanonicalDecimalWire(value)) {
    throw new ZkqProtocolError(
      "INVALID_FIELD_ELEMENT",
      `${label} must be canonical decimal Fr (no leading zeros, no sign, no 0x prefix)`,
      { label, value: typeof value === "string" ? value : `<${typeof value}>` },
    );
  }
  const bi = BigInt(value);
  if (bi >= BLS12_381_FR_MODULUS) {
    throw new ZkqProtocolError(
      "INVALID_FIELD_ELEMENT",
      `${label} is not a canonical Fr element (must be in [0, r))`,
      { label, value },
    );
  }
  return bi;
}

/**
 * Convert a canonical decimal Fr element to the canonical 32-byte
 * lowercase `0x`+64 hex form used internally by ElectionMeta, events,
 * the on-chain contract, and the auditor. This is the ONLY allowed
 * conversion path; no other code may reconstruct a hex ID from a
 * decimal public signal.
 */
export function decimalFrToHex32(value: unknown, label: string): Bytes32Hex {
  const bi = parseCanonicalFrElement(value, label);
  const bytes = new Uint8Array(32);
  let v = bi;
  for (let i = 31; i >= 0; i -= 1) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  let hex = "0x";
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i]!;
    hex += ((b >> 4) & 0x0f).toString(16);
    hex += (b & 0x0f).toString(16);
  }
  return hex as Bytes32Hex;
}

/**
 * Bounded number parse for vote/optionCount. The input is still a
 * canonical decimal Fr element; the bound check is what lets us hand
 * back a JS `number`. `bits` is the field size limit (32 for the
 * R0 vote/optionCount slots).
 */
export function parseCanonicalFrNumber(value: unknown, label: string, bits: number): number {
  const bi = parseCanonicalFrElement(value, label);
  const max = (1n << BigInt(bits)) - 1n;
  if (bi > max) {
    throw new ZkqProtocolError(
      "INVALID_FIELD_ELEMENT",
      `${label} does not fit in u${bits}`,
      { label, value: typeof value === "string" ? value : `<${typeof value}>` },
    );
  }
  return Number(bi);
}

export type PublicSignalKind = "output" | "public-input";

export interface PublicSignalSlot {
  readonly name: string;
  readonly kind: PublicSignalKind;
  readonly description: string;
}

export interface PublicSchemaDefinition {
  readonly id: string;
  readonly rung: "R0" | "R1";
  readonly slots: ReadonlyArray<PublicSignalSlot>;
}

export const PUBLIC_SCHEMA_V1_R0: PublicSchemaDefinition = Object.freeze({
  id: ZKQ_PUBLIC_SCHEMA_R0,
  rung: "R0",
  slots: Object.freeze([
    Object.freeze({ name: "nullifierHash", kind: "output", description: "Poseidon255(nullifierSecret, electionScope)" }),
    Object.freeze({ name: "vote", kind: "public-input", description: "R0 public vote in [0, optionCount)" }),
    Object.freeze({ name: "optionCount", kind: "public-input", description: "Number of options in this election" }),
    Object.freeze({ name: "stateRoot", kind: "public-input", description: "Merkle root of credential commitments" }),
    Object.freeze({ name: "associationRoot", kind: "public-input", description: "Merkle root of eligible labels (ASP)" }),
    Object.freeze({ name: "electionScope", kind: "public-input", description: "Domain-separated election scope" }),
  ]),
});

export const PUBLIC_SCHEMA_V1_R1: PublicSchemaDefinition = Object.freeze({
  id: ZKQ_PUBLIC_SCHEMA_R1,
  rung: "R1",
  slots: Object.freeze([
    Object.freeze({ name: "nullifierHash", kind: "output", description: "Poseidon255(nullifierSecret, electionScope)" }),
    Object.freeze({ name: "ballotCommitment", kind: "output", description: "Poseidon255(Poseidon255(vote, salt), electionScope)" }),
    Object.freeze({ name: "optionCount", kind: "public-input", description: "Number of options in this election" }),
    Object.freeze({ name: "stateRoot", kind: "public-input", description: "Merkle root of credential commitments" }),
    Object.freeze({ name: "associationRoot", kind: "public-input", description: "Merkle root of eligible labels (ASP)" }),
    Object.freeze({ name: "electionScope", kind: "public-input", description: "Domain-separated election scope" }),
  ]),
});

export const PUBLIC_SCHEMAS: Readonly<Record<string, PublicSchemaDefinition>> = Object.freeze({
  [ZKQ_PUBLIC_SCHEMA_R0]: PUBLIC_SCHEMA_V1_R0,
  [ZKQ_PUBLIC_SCHEMA_R1]: PUBLIC_SCHEMA_V1_R1,
});

export function getPublicSchema(id: string): PublicSchemaDefinition {
  const def = PUBLIC_SCHEMAS[id];
  if (def === undefined) {
    throw new ZkqProtocolError("INVALID_SCHEMA_VERSION", `unknown public schema id: ${id}`, { id });
  }
  return def;
}

export function slotIndex(schema: PublicSchemaDefinition, name: string): number {
  const idx = schema.slots.findIndex((s) => s.name === name);
  if (idx < 0) {
    throw new ZkqProtocolError("INVALID_SCHEMA_VERSION", `slot '${name}' not in schema ${schema.id}`, {
      schemaId: schema.id,
      slot: name,
    });
  }
  return idx;
}

export type FieldElement = string;

export type PublicSignals = ReadonlyArray<FieldElement>;

export interface ParsedPublicSignals {
  readonly schemaId: string;
  readonly signals: PublicSignals;
  readonly nullifierHash: NullifierHash;
  readonly ballotCommitment: Bytes32Hex | null;
  readonly vote: VoteValue | null;
  readonly optionCount: OptionCount;
  readonly stateRoot: RootHash;
  readonly associationRoot: RootHash;
  readonly electionScope: Bytes32Hex;
}

export function parsePublicSignals(schema: PublicSchemaDefinition, signals: PublicSignals): ParsedPublicSignals {
  if (signals.length !== schema.slots.length) {
    throw new ZkqProtocolError("INVALID_SIGNAL_COUNT", `expected ${schema.slots.length} signals for ${schema.id}`, {
      expected: schema.slots.length,
      actual: signals.length,
    });
  }
  // All six slots are Circom Fr elements on the wire (canonical decimal,
  // no 0x prefix, no leading zeros, value in [0, r)). Internal types stay
  // hex so ElectionMeta, events, and the contract can compare directly.
  const nullifierHash = decimalFrToHex32(signals[slotIndex(schema, "nullifierHash")]!, "nullifierHash");
  const optionCount = parseCanonicalFrNumber(signals[slotIndex(schema, "optionCount")]!, "optionCount", 32);
  const stateRoot = decimalFrToHex32(signals[slotIndex(schema, "stateRoot")]!, "stateRoot");
  const associationRoot = decimalFrToHex32(signals[slotIndex(schema, "associationRoot")]!, "associationRoot");
  const electionScope = decimalFrToHex32(signals[slotIndex(schema, "electionScope")]!, "electionScope");

  let vote: VoteValue | null = null;
  let ballotCommitment: Bytes32Hex | null = null;
  if (schema.rung === "R0") {
    vote = parseCanonicalFrNumber(signals[slotIndex(schema, "vote")]!, "vote", 32);
  } else {
    ballotCommitment = decimalFrToHex32(signals[slotIndex(schema, "ballotCommitment")]!, "ballotCommitment");
  }

  return {
    schemaId: schema.id,
    signals,
    nullifierHash,
    ballotCommitment,
    vote,
    optionCount,
    stateRoot,
    associationRoot,
    electionScope,
  };
}

export interface ElectionMeta {
  readonly electionId: ElectionId;
  readonly schemaId: string;
  readonly optionCount: OptionCount;
  readonly stateRoot: RootHash;
  readonly associationRoot: RootHash;
  readonly electionScope: Bytes32Hex;
}

/**
 * Internal hex representation is always lowercase 0x + 64 hex chars.
 * Compare by normalizing both sides so that callers can pass either case
 * from off-chain sources (events, manifests, contracts) without breaking
 * the match. This is the only place equality is defined for these fields.
 */
function sameHex32(a: Bytes32Hex, b: Bytes32Hex): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    let ca = a.charCodeAt(i);
    let cb = b.charCodeAt(i);
    if (ca >= 0x41 && ca <= 0x46) ca += 0x20;
    if (cb >= 0x41 && cb <= 0x46) cb += 0x20;
    if (ca !== cb) return false;
  }
  return true;
}

export function signalsMatchElection(parsed: ParsedPublicSignals, election: ElectionMeta): void {
  if (parsed.schemaId !== election.schemaId) {
    throw new ZkqProtocolError("INVALID_SCHEMA_VERSION", "schema id does not match election", {
      parsed: parsed.schemaId,
      election: election.schemaId,
    });
  }
  if (parsed.optionCount !== election.optionCount) {
    throw new ZkqProtocolError("INVALID_OPTION_COUNT", "optionCount does not match election", {
      parsed: parsed.optionCount,
      election: election.optionCount,
    });
  }
  if (!sameHex32(parsed.stateRoot, election.stateRoot)) {
    throw new ZkqProtocolError("STATE_ROOT_MISMATCH", "stateRoot does not match election", {
      parsed: parsed.stateRoot,
      election: election.stateRoot,
    });
  }
  if (!sameHex32(parsed.associationRoot, election.associationRoot)) {
    throw new ZkqProtocolError("ASSOCIATION_ROOT_MISMATCH", "associationRoot does not match election", {
      parsed: parsed.associationRoot,
      election: election.associationRoot,
    });
  }
  if (!sameHex32(parsed.electionScope, election.electionScope)) {
    throw new ZkqProtocolError("ELECTION_SCOPE_MISMATCH", "electionScope does not match election", {
      parsed: parsed.electionScope,
      election: election.electionScope,
    });
  }
}

export function validateR0VoteRange(vote: VoteValue, optionCount: OptionCount): void {
  if (!Number.isInteger(vote) || vote < 0) {
    throw new ZkqProtocolError("INVALID_VOTE_RANGE", "vote must be a non-negative integer", { vote });
  }
  if (!Number.isInteger(optionCount) || optionCount < 1) {
    throw new ZkqProtocolError("INVALID_OPTION_COUNT", "optionCount must be a positive integer", { optionCount });
  }
  if (vote >= optionCount) {
    throw new ZkqProtocolError("INVALID_VOTE_RANGE", "vote must be < optionCount", { vote, optionCount });
  }
}
