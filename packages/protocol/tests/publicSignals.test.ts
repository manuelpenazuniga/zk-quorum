import { describe, it, expect } from "vitest";
import {
  PUBLIC_SCHEMA_V1_R0,
  PUBLIC_SCHEMA_V1_R1,
  parsePublicSignals,
  signalsMatchElection,
  slotIndex,
  validateR0VoteRange,
  getPublicSchema,
} from "../src/publicSignals.js";
import { ZkqProtocolError } from "../src/errors.js";

const ELECTION = {
  electionId: ("0x" + "01".repeat(32)) as `0x${string}`,
  schemaId: "PUBLIC_SCHEMA_V1_R0",
  optionCount: 5,
  stateRoot: ("0x" + "02".repeat(32)) as `0x${string}`,
  associationRoot: ("0x" + "03".repeat(32)) as `0x${string}`,
  electionScope: ("0x" + "04".repeat(32)) as `0x${string}`,
} as const;

const R0_SIGNALS = [
  "0x" + "aa".repeat(32),
  "3",
  "5",
  ELECTION.stateRoot,
  ELECTION.associationRoot,
  ELECTION.electionScope,
];

const R1_SIGNALS = [
  "0x" + "aa".repeat(32),
  "0x" + "bb".repeat(32),
  "5",
  ELECTION.stateRoot,
  ELECTION.associationRoot,
  ELECTION.electionScope,
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
  it("parses well-formed R0 signals", () => {
    const parsed = parsePublicSignals(PUBLIC_SCHEMA_V1_R0, R0_SIGNALS);
    expect(parsed.vote).toBe(3);
    expect(parsed.optionCount).toBe(5);
    expect(parsed.nullifierHash).toBe(R0_SIGNALS[0]);
    expect(parsed.electionScope).toBe(ELECTION.electionScope);
  });

  it("rejects wrong signal count", () => {
    expect(() => parsePublicSignals(PUBLIC_SCHEMA_V1_R0, [...R0_SIGNALS, "extra"])).toThrow(ZkqProtocolError);
  });

  it("rejects non-hex signal", () => {
    expect(() => parsePublicSignals(PUBLIC_SCHEMA_V1_R0, ["notahex", ...R0_SIGNALS.slice(1)])).toThrow(ZkqProtocolError);
  });

  it("rejects over-long option count", () => {
    const big = (1n << 33n).toString();
    expect(() => parsePublicSignals(PUBLIC_SCHEMA_V1_R0, [R0_SIGNALS[0]!, R0_SIGNALS[1]!, big, ...R0_SIGNALS.slice(3)])).toThrow(ZkqProtocolError);
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
    expect(parsed.ballotCommitment).toBe("0x" + "bb".repeat(32));
  });
});
