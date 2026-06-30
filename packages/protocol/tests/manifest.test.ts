import { describe, it, expect } from "vitest";
import { ZKQ_PROTOCOL_VERSION, ZKQ_PROTOCOL_API_VERSION } from "../src/version.js";
import { MANIFEST_VERSION } from "../src/manifest.js";
import type { CastResponse, CastResponseAccepted, CastResponseDuplicate, CastResponseRejected } from "../src/manifest.js";

function isAccepted(r: CastResponse): r is CastResponseAccepted {
  return r.status === "accepted";
}

function isDuplicate(r: CastResponse): r is CastResponseDuplicate {
  return r.status === "duplicate";
}

function isRejected(r: CastResponse): r is CastResponseRejected {
  return r.status === "rejected";
}

describe("version constants", () => {
  it("uses pinned protocol version", () => {
    expect(ZKQ_PROTOCOL_VERSION).toBe("0.0.0");
    expect(ZKQ_PROTOCOL_API_VERSION).toBe("v1");
    expect(MANIFEST_VERSION).toBe("v1");
  });
});

const TX1 = ("0x" + "aa".repeat(32)) as `0x${string}`;

describe("CastResponse discriminated union", () => {
  it("accepted has txHash/nullifierHash/proofHash/publicSignalsHash non-null and rejectReason null", () => {
    const r: CastResponse = {
      status: "accepted",
      txHash: TX1,
      nullifierHash: "0x" + "11".repeat(32) as `0x${string}`,
      proofHash: "0x" + "22".repeat(32) as `0x${string}`,
      publicSignalsHash: "0x" + "33".repeat(32) as `0x${string}`,
      rejectReason: null,
    };
    expect(isAccepted(r)).toBe(true);
    if (isAccepted(r)) {
      expect(r.txHash).toBe(TX1);
      expect(r.nullifierHash).toMatch(/^0x/);
      expect(r.proofHash).toMatch(/^0x/);
      expect(r.publicSignalsHash).toMatch(/^0x/);
      expect(r.rejectReason).toBeNull();
    }
  });

  it("duplicate has txHash/nullifierHash/proofHash/publicSignalsHash non-null and rejectReason null", () => {
    const r: CastResponse = {
      status: "duplicate",
      txHash: TX1,
      nullifierHash: "0x" + "11".repeat(32) as `0x${string}`,
      proofHash: "0x" + "22".repeat(32) as `0x${string}`,
      publicSignalsHash: "0x" + "33".repeat(32) as `0x${string}`,
      rejectReason: null,
    };
    expect(isDuplicate(r)).toBe(true);
    if (isDuplicate(r)) {
      expect(r.txHash).toBe(TX1);
      expect(r.nullifierHash).toMatch(/^0x/);
      expect(r.proofHash).toMatch(/^0x/);
      expect(r.publicSignalsHash).toMatch(/^0x/);
      expect(r.rejectReason).toBeNull();
    }
  });

  it("rejected has txHash/nullifierHash/proofHash/publicSignalsHash null and rejectReason non-null", () => {
    const r: CastResponse = {
      status: "rejected",
      txHash: null,
      nullifierHash: null,
      proofHash: null,
      publicSignalsHash: null,
      rejectReason: "bad proof",
    };
    expect(isRejected(r)).toBe(true);
    if (isRejected(r)) {
      expect(r.txHash).toBeNull();
      expect(r.nullifierHash).toBeNull();
      expect(r.proofHash).toBeNull();
      expect(r.publicSignalsHash).toBeNull();
      expect(r.rejectReason).toBe("bad proof");
    }
  });
});
