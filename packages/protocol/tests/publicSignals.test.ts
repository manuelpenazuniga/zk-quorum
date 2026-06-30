import { describe, it, expect } from "vitest";
import {
  PUBLIC_SCHEMA_V1_R0,
  PUBLIC_SCHEMA_V1_R1,
  parsePublicSignals,
  signalsMatchElection,
  slotIndex,
  validateR0VoteRange,
  getPublicSchema,
  isCanonicalDecimalWire,
  parseCanonicalFrElement,
  parseCanonicalFrNumber,
  decimalFrToHex32,
  CANONICAL_DECIMAL_RE,
} from "../src/publicSignals.js";
import { BLS12_381_FR_MODULUS } from "../src/scope.js";
import { ZkqProtocolError } from "../src/errors.js";

const ELECTION_ID = ("0x" + "01".repeat(32)) as `0x${string}`;

// Literal decimal wire values. All values must be valid BLS12-381 Fr
// elements: 0 <= x < r. The literal 0xaa..aa / 0xbb..aa exceeds r and
// is therefore invalid as a public signal. We use small values like
// 10/11/12/13 that any future circuit fixture can match.
const NULLIFIER_DEC = "10";
const BALLOT_DEC = "11";
const STATE_DEC = "12";
const ASSOC_DEC = "13";
const SCOPE_DEC = "14";
const VOTE_DEC = "3";
const OPTION_COUNT_DEC = "5";

const ELECTION = {
  electionId: ELECTION_ID,
  schemaId: "PUBLIC_SCHEMA_V1_R0",
  optionCount: 5,
  stateRoot: decimalFrToHex32(STATE_DEC, "stateRoot"),
  associationRoot: decimalFrToHex32(ASSOC_DEC, "associationRoot"),
  electionScope: decimalFrToHex32(SCOPE_DEC, "electionScope"),
} as const;

const R0_SIGNALS = [
  NULLIFIER_DEC,
  VOTE_DEC,
  OPTION_COUNT_DEC,
  STATE_DEC,
  ASSOC_DEC,
  SCOPE_DEC,
];

const R1_SIGNALS = [
  NULLIFIER_DEC,
  BALLOT_DEC,
  OPTION_COUNT_DEC,
  STATE_DEC,
  ASSOC_DEC,
  SCOPE_DEC,
];

describe("publicSignals schemas", () => {
  it("R0 schema has 6 slots with expected names", () => {
    expect(PUBLIC_SCHEMA_V1_R0.slots.map((s) => s.name)).toEqual([
      "nullifierHash",
      "vote",
      "optionCount",
      "stateRoot",
      "associationRoot",
      "electionScope",
    ]);
  });

  it("R1 schema has 6 slots with expected names", () => {
    expect(PUBLIC_SCHEMA_V1_R1.slots.map((s) => s.name)).toEqual([
      "nullifierHash",
      "ballotCommitment",
      "optionCount",
      "stateRoot",
      "associationRoot",
      "electionScope",
    ]);
  });

  it("slotIndex resolves names", () => {
    expect(slotIndex(PUBLIC_SCHEMA_V1_R0, "vote")).toBe(1);
    expect(slotIndex(PUBLIC_SCHEMA_V1_R0, "electionScope")).toBe(5);
  });

  it("getPublicSchema throws on unknown id", () => {
    expect(() => getPublicSchema("PUBLIC_SCHEMA_V1_R9")).toThrow(ZkqProtocolError);
  });
});

describe("parsePublicSignals R0", () => {
  it("parses well-formed R0 signals into hex IDs and bounded numbers", () => {
    const parsed = parsePublicSignals(PUBLIC_SCHEMA_V1_R0, R0_SIGNALS);
    expect(parsed.vote).toBe(3);
    expect(parsed.optionCount).toBe(5);
    expect(parsed.nullifierHash).toBe(decimalFrToHex32(NULLIFIER_DEC, "nullifierHash"));
    expect(parsed.stateRoot).toBe(decimalFrToHex32(STATE_DEC, "stateRoot"));
    expect(parsed.associationRoot).toBe(decimalFrToHex32(ASSOC_DEC, "associationRoot"));
    expect(parsed.electionScope).toBe(decimalFrToHex32(SCOPE_DEC, "electionScope"));
  });

  it("rejects wrong signal count", () => {
    expect(() => parsePublicSignals(PUBLIC_SCHEMA_V1_R0, [...R0_SIGNALS, "extra"])).toThrow(ZkqProtocolError);
  });

  it("rejects non-decimal signal", () => {
    expect(() => parsePublicSignals(PUBLIC_SCHEMA_V1_R0, ["notahex", ...R0_SIGNALS.slice(1)])).toThrow(ZkqProtocolError);
  });

  it("rejects 0x-prefixed public signal (audit: wire format is decimal)", () => {
    const hex = "0x" + "aa".repeat(32);
    expect(() => parsePublicSignals(PUBLIC_SCHEMA_V1_R0, [hex, ...R0_SIGNALS.slice(1)])).toThrow(/INVALID_FIELD_ELEMENT/);
  });

  it("rejects leading-zero public signal (canonical decimal disallows '00', '007')", () => {
    expect(() => parsePublicSignals(PUBLIC_SCHEMA_V1_R0, ["00", ...R0_SIGNALS.slice(1)])).toThrow(/INVALID_FIELD_ELEMENT/);
    expect(() => parsePublicSignals(PUBLIC_SCHEMA_V1_R0, ["007", ...R0_SIGNALS.slice(1)])).toThrow(/INVALID_FIELD_ELEMENT/);
  });

  it("rejects a public signal equal to or above the BLS12-381 Fr modulus", () => {
    const r = BLS12_381_FR_MODULUS;
    const rDec = r.toString();
    const above = (r + 1n).toString();
    expect(() => parsePublicSignals(PUBLIC_SCHEMA_V1_R0, [rDec, ...R0_SIGNALS.slice(1)])).toThrow(/INVALID_FIELD_ELEMENT/);
    expect(() => parsePublicSignals(PUBLIC_SCHEMA_V1_R0, [above, ...R0_SIGNALS.slice(1)])).toThrow(/INVALID_FIELD_ELEMENT/);
  });

  it("rejects over-long option count (audit: bounded number parse)", () => {
    const big = (1n << 33n).toString();
    expect(() => parsePublicSignals(PUBLIC_SCHEMA_V1_R0, [R0_SIGNALS[0]!, R0_SIGNALS[1]!, big, ...R0_SIGNALS.slice(3)])).toThrow(ZkqProtocolError);
  });

  it("rejects a non-string slot (number, object, null)", () => {
    expect(() => parsePublicSignals(PUBLIC_SCHEMA_V1_R0, [1 as unknown as string, ...R0_SIGNALS.slice(1)])).toThrow(/INVALID_FIELD_ELEMENT/);
    expect(() => parsePublicSignals(PUBLIC_SCHEMA_V1_R0, [null as unknown as string, ...R0_SIGNALS.slice(1)])).toThrow(/INVALID_FIELD_ELEMENT/);
    expect(() => parsePublicSignals(PUBLIC_SCHEMA_V1_R0, [{} as unknown as string, ...R0_SIGNALS.slice(1)])).toThrow(/INVALID_FIELD_ELEMENT/);
  });
});

describe("signalsMatchElection", () => {
  it("accepts matching election", () => {
    const parsed = parsePublicSignals(PUBLIC_SCHEMA_V1_R0, R0_SIGNALS);
    expect(() => signalsMatchElection(parsed, ELECTION)).not.toThrow();
  });

  it("rejects mismatched schemaId", () => {
    const parsed = parsePublicSignals(PUBLIC_SCHEMA_V1_R0, R0_SIGNALS);
    expect(() => signalsMatchElection(parsed, { ...ELECTION, schemaId: "PUBLIC_SCHEMA_V1_R1" })).toThrow(ZkqProtocolError);
  });

  it("rejects mismatched electionScope", () => {
    const parsed = parsePublicSignals(PUBLIC_SCHEMA_V1_R0, R0_SIGNALS);
    expect(() => signalsMatchElection(parsed, { ...ELECTION, electionScope: ("0x" + "99".repeat(32)) as `0x${string}` })).toThrow(ZkqProtocolError);
  });

  it("accepts election meta in uppercase hex (case-insensitive hex32 comparison)", () => {
    const parsed = parsePublicSignals(PUBLIC_SCHEMA_V1_R0, R0_SIGNALS);
    // Frozen U0 wire format: Bytes32Hex keeps the "0x" prefix lowercase
    // and the case-insensitive comparison applies ONLY to the 64 hex
    // digits. Apply uppercase to the digits only, leaving the prefix
    // untouched, so the internal case-insensitive matcher still lines up
    // with the lowercase wire we parsed.
    const digitsUpper = (h: `0x${string}`): `0x${string}` => ("0x" + h.slice(2).toUpperCase()) as `0x${string}`;
    const upper = {
      ...ELECTION,
      stateRoot: digitsUpper(ELECTION.stateRoot),
      associationRoot: digitsUpper(ELECTION.associationRoot),
      electionScope: digitsUpper(ELECTION.electionScope),
    };
    expect(parsed.stateRoot).toBe(ELECTION.stateRoot);
    expect(upper.stateRoot.startsWith("0x")).toBe(true);
    expect(upper.stateRoot).not.toBe(ELECTION.stateRoot);
    expect(upper.stateRoot.toLowerCase()).toBe(parsed.stateRoot);
    expect(() => signalsMatchElection(parsed, upper)).not.toThrow();
  });
});

describe("validateR0VoteRange", () => {
  it("accepts vote in range", () => {
    expect(() => validateR0VoteRange(0, 1)).not.toThrow();
    expect(() => validateR0VoteRange(4, 5)).not.toThrow();
  });

  it("rejects vote == optionCount", () => {
    expect(() => validateR0VoteRange(5, 5)).toThrow(ZkqProtocolError);
  });

  it("rejects zero options", () => {
    expect(() => validateR0VoteRange(0, 0)).toThrow(ZkqProtocolError);
  });

  it("rejects negative vote", () => {
    expect(() => validateR0VoteRange(-1, 5)).toThrow(ZkqProtocolError);
  });
});

describe("R1 schema", () => {
  it("parses well-formed R1 signals with ballotCommitment instead of vote", () => {
    const parsed = parsePublicSignals(PUBLIC_SCHEMA_V1_R1, R1_SIGNALS);
    expect(parsed.vote).toBeNull();
    expect(parsed.ballotCommitment).toBe(decimalFrToHex32(BALLOT_DEC, "ballotCommitment"));
  });
});

describe("canonical decimal wire format (audit U0 wire format)", () => {
  it("CANONICAL_DECIMAL_RE accepts '0' and non-leading-zero decimals", () => {
    expect(CANONICAL_DECIMAL_RE.test("0")).toBe(true);
    expect(CANONICAL_DECIMAL_RE.test("1")).toBe(true);
    expect(CANONICAL_DECIMAL_RE.test("12345")).toBe(true);
  });

  it("CANONICAL_DECIMAL_RE rejects leading-zero, sign, hex, blank, non-string", () => {
    for (const bad of ["00", "01", "007", "+0", "-0", " 0", "0 ", "0x0", "0X0", "1e3", "1_000", "", " ", "a"]) {
      expect(CANONICAL_DECIMAL_RE.test(bad)).toBe(false);
    }
  });

  it("isCanonicalDecimalWire is a type guard for the wire format", () => {
    expect(isCanonicalDecimalWire("0")).toBe(true);
    expect(isCanonicalDecimalWire("12345")).toBe(true);
    expect(isCanonicalDecimalWire(12345)).toBe(false);
    expect(isCanonicalDecimalWire("0x00")).toBe(false);
  });

  it("parseCanonicalFrElement returns the bigint and rejects anything else", () => {
    expect(parseCanonicalFrElement("0", "x")).toBe(0n);
    expect(parseCanonicalFrElement("123", "x")).toBe(123n);
    expect(() => parseCanonicalFrElement("-1", "x")).toThrow(ZkqProtocolError);
    expect(() => parseCanonicalFrElement("0x00", "x")).toThrow(ZkqProtocolError);
    expect(() => parseCanonicalFrElement("00", "x")).toThrow(ZkqProtocolError);
  });

  it("parseCanonicalFrElement enforces [0, r) using the BLS12-381 Fr prime", () => {
    const r = BLS12_381_FR_MODULUS;
    expect(() => parseCanonicalFrElement(r.toString(), "x")).toThrow(/INVALID_FIELD_ELEMENT/);
    expect(() => parseCanonicalFrElement((r - 1n).toString(), "x")).not.toThrow();
  });

  it("parseCanonicalFrNumber returns a bounded JS number", () => {
    expect(parseCanonicalFrNumber("0", "vote", 32)).toBe(0);
    expect(parseCanonicalFrNumber("4294967295", "vote", 32)).toBe(0xffffffff);
    expect(() => parseCanonicalFrNumber("4294967296", "vote", 32)).toThrow(/u32/);
  });

  it("decimalFrToHex32 produces lowercase 0x + 64 hex for canonical Fr values", () => {
    expect(decimalFrToHex32("0", "x")).toBe("0x" + "0".repeat(64));
    expect(decimalFrToHex32("1", "x")).toBe("0x" + "0".repeat(63) + "1");
    // Internal representation is canonical lowercase hex; any value that
    // equals the small literal "10" round-trips to 0x...0a.
    expect(decimalFrToHex32("10", "x")).toBe("0x" + "0".repeat(63) + "a");
    // 0x0a * 32 is well below the modulus and round-trips.
    const n = BigInt("0x" + "0a".repeat(32));
    expect(decimalFrToHex32(n.toString(), "x")).toBe("0x" + "0a".repeat(32));
  });

  it("decimalFrToHex32 refuses a value at or above r", () => {
    const r = BLS12_381_FR_MODULUS;
    expect(() => decimalFrToHex32(r.toString(), "x")).toThrow();
  });
});
