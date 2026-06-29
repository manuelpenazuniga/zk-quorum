import type { Bytes32Hex, ElectionId, NullifierHash, RootHash, VoteValue, OptionCount } from "./ids.js";
import { isHex32 } from "./ids.js";
import { ZkqProtocolError } from "./errors.js";
import { ZKQ_PUBLIC_SCHEMA_R0, ZKQ_PUBLIC_SCHEMA_R1 } from "./version.js";

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

function requireHex32(value: FieldElement, label: string): Bytes32Hex {
  if (!isHex32(value)) {
    throw new ZkqProtocolError("MISSING_PUBLIC_SIGNAL", `expected 32-byte hex for ${label}`, {
      label,
      value,
    });
  }
  return value;
}

function requireFieldElementInt(value: FieldElement, label: string, bits: number): number {
  if (!/^[0-9]+$/.test(value)) {
    throw new ZkqProtocolError("INVALID_FIELD_ELEMENT", `${label} must be a non-negative integer string`, {
      label,
      value,
    });
  }
  const bi = BigInt(value);
  const max = (1n << BigInt(bits)) - 1n;
  if (bi > max) {
    throw new ZkqProtocolError("INVALID_FIELD_ELEMENT", `${label} does not fit in u${bits}`, { label, value });
  }
  return Number(bi);
}

export function parsePublicSignals(schema: PublicSchemaDefinition, signals: PublicSignals): ParsedPublicSignals {
  if (signals.length !== schema.slots.length) {
    throw new ZkqProtocolError("INVALID_SIGNAL_COUNT", `expected ${schema.slots.length} signals for ${schema.id}`, {
      expected: schema.slots.length,
      actual: signals.length,
    });
  }
  const nullifierHash = requireHex32(signals[slotIndex(schema, "nullifierHash")]!, "nullifierHash");
  const optionCount = requireFieldElementInt(signals[slotIndex(schema, "optionCount")]!, "optionCount", 32);
  const stateRoot = requireHex32(signals[slotIndex(schema, "stateRoot")]!, "stateRoot");
  const associationRoot = requireHex32(signals[slotIndex(schema, "associationRoot")]!, "associationRoot");
  const electionScope = requireHex32(signals[slotIndex(schema, "electionScope")]!, "electionScope");

  let vote: VoteValue | null = null;
  let ballotCommitment: Bytes32Hex | null = null;
  if (schema.rung === "R0") {
    vote = requireFieldElementInt(signals[slotIndex(schema, "vote")]!, "vote", 32);
  } else {
    ballotCommitment = requireHex32(signals[slotIndex(schema, "ballotCommitment")]!, "ballotCommitment");
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
  if (parsed.stateRoot !== election.stateRoot) {
    throw new ZkqProtocolError("ELECTRON_SCOPE_MISMATCH", "stateRoot does not match election", {
      parsed: parsed.stateRoot,
      election: election.stateRoot,
    });
  }
  if (parsed.associationRoot !== election.associationRoot) {
    throw new ZkqProtocolError("ELECTRON_SCOPE_MISMATCH", "associationRoot does not match election", {
      parsed: parsed.associationRoot,
      election: election.associationRoot,
    });
  }
  if (parsed.electionScope !== election.electionScope) {
    throw new ZkqProtocolError("ELECTRON_SCOPE_MISMATCH", "electionScope does not match election", {
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
