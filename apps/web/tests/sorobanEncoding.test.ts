import { describe, it, expect } from "vitest";
import {
  encodePublicSignals,
  encodeProof,
  isCanonicalDecimalFr,
  parseFr,
  PROOF_BYTE_LEN,
  PUBLIC_SIGNALS_BYTE_LEN,
  type ProofJson,
  type PublicJson,
} from "../src/adapters/sorobanEncoding.js";

// BLS12-381 Fr modulus
const FR_MODULUS = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

describe("Soroban public signals encoding (golden)", () => {
  it("produces exactly 196 bytes", () => {
    const signals: PublicJson = ["0", "1", "2", "3", "4", "5"];
    const encoded = encodePublicSignals(signals);
    expect(encoded.length).toBe(PUBLIC_SIGNALS_BYTE_LEN);
    expect(encoded.length).toBe(196);
  });

  it("starts with u32 BE length = 6", () => {
    const signals: PublicJson = ["0", "1", "2", "3", "4", "5"];
    const encoded = encodePublicSignals(signals);
    expect(encoded[0]).toBe(0x00);
    expect(encoded[1]).toBe(0x00);
    expect(encoded[2]).toBe(0x00);
    expect(encoded[3]).toBe(0x06);
  });

  it("serializes signal '0' as 32 zero bytes", () => {
    const signals: PublicJson = ["0", "0", "0", "0", "0", "0"];
    const encoded = encodePublicSignals(signals);
    for (let i = 4; i < 196; i++) {
      expect(encoded[i]).toBe(0);
    }
  });

  it("serializes Fr modulus - 1 correctly (boundary)", () => {
    const maxFr = (FR_MODULUS - 1n).toString();
    const signals: PublicJson = [maxFr, "0", "0", "0", "0", "0"];
    const encoded = encodePublicSignals(signals);
    expect(encoded.length).toBe(PUBLIC_SIGNALS_BYTE_LEN);
    let reconstructed = 0n;
    for (let i = 4; i < 36; i++) {
      reconstructed = (reconstructed << 8n) | BigInt(encoded[i]!);
    }
    expect(reconstructed).toBe(FR_MODULUS - 1n);
  });

  it("rejects signal >= Fr modulus", () => {
    const tooBig = FR_MODULUS.toString();
    const signals: PublicJson = [tooBig, "0", "0", "0", "0", "0"];
    expect(() => encodePublicSignals(signals)).toThrow(/>= modulus/);
  });

  it("rejects non-6-element arrays", () => {
    expect(() => encodePublicSignals(["0"])).toThrow(/exactly 6/);
    expect(() => encodePublicSignals(["0", "1", "2", "3", "4", "5", "6"])).toThrow(/exactly 6/);
  });

  it("rejects leading zeros", () => {
    expect(() => encodePublicSignals(["00", "1", "2", "3", "4", "5"])).toThrow(/leading zeros/);
  });

  it("rejects signs", () => {
    expect(() => encodePublicSignals(["+1", "0", "0", "0", "0", "0"])).toThrow(/sign/);
    expect(() => encodePublicSignals(["-1", "0", "0", "0", "0", "0"])).toThrow(/sign/);
  });

  it("rejects non-digit characters", () => {
    expect(() => encodePublicSignals(["1a", "0", "0", "0", "0", "0"])).toThrow(/non-digit/);
    expect(() => encodePublicSignals(["1 2", "0", "0", "0", "0", "0"])).toThrow(/non-digit/);
  });

  it("rejects empty string", () => {
    expect(() => encodePublicSignals(["", "0", "0", "0", "0", "0"])).toThrow(/empty/);
  });
});

describe("isCanonicalDecimalFr", () => {
  it("accepts '0'", () => expect(isCanonicalDecimalFr("0")).toBe(true));
  it("accepts normal decimal", () => expect(isCanonicalDecimalFr("1234567890")).toBe(true));
  it("rejects leading zero", () => expect(isCanonicalDecimalFr("0123")).toBe(false));
  it("rejects empty", () => expect(isCanonicalDecimalFr("")).toBe(false));
  it("rejects non-digit", () => expect(isCanonicalDecimalFr("0x1")).toBe(false));
  it("rejects sign", () => expect(isCanonicalDecimalFr("-1")).toBe(false));
  it("rejects spaces", () => expect(isCanonicalDecimalFr(" 1")).toBe(false));
  it("rejects Fr modulus value", () => expect(isCanonicalDecimalFr(FR_MODULUS.toString())).toBe(false));
  it("accepts Fr modulus - 1", () => expect(isCanonicalDecimalFr((FR_MODULUS - 1n).toString())).toBe(true));
  it("rejects non-strings", () => {
    expect(isCanonicalDecimalFr(123)).toBe(false);
    expect(isCanonicalDecimalFr(null)).toBe(false);
    expect(isCanonicalDecimalFr(undefined)).toBe(false);
  });
});

describe("Soroban proof encoding (golden)", () => {
  function makeValidProof(): ProofJson {
    return {
      protocol: "groth16",
      curve: "bls12381",
      pi_a: ["123", "456", "1"],
      pi_b: [["111", "222"], ["333", "444"], ["1", "0"]],
      pi_c: ["789", "101112", "1"],
    };
  }

  it("produces exactly 384 bytes", () => {
    const proof = makeValidProof();
    const encoded = encodeProof(proof);
    expect(encoded.length).toBe(PROOF_BYTE_LEN);
    expect(encoded.length).toBe(384);
  });

  it("layout: A(96) | B(192) | C(96)", () => {
    const proof = makeValidProof();
    const encoded = encodeProof(proof);
    expect(encoded.slice(0, 96).length).toBe(96);
    expect(encoded.slice(96, 288).length).toBe(192);
    expect(encoded.slice(288, 384).length).toBe(96);
  });

  it("G2 on-wire: g2[0][1]||g2[0][0]||g2[1][1]||g2[1][0] (xxd verified)", () => {
    // Real E0 evidence: snarkjs pi_b[0]=["03b879…","065ed6…"]
    // → proof.bin offset 96 starts "065ed6…" (g2[0][1] first)
    // Use distinct values to verify the ordering
    const proof: ProofJson = {
      protocol: "groth16",
      curve: "bls12381",
      pi_a: ["0", "0", "1"],
      pi_b: [
        ["100", "200"], // g2[0][0]=100, g2[0][1]=200
        ["300", "400"], // g2[1][0]=300, g2[1][1]=400
        ["1", "0"],
      ],
      pi_c: ["0", "0", "1"],
    };
    const encoded = encodeProof(proof);
    // B starts at offset 96
    const b = encoded.slice(96, 288);

    // offset 0: g2[0][1] = 200 (snarkjs index 1 first, c1 in arkworks)
    let val = 0n;
    for (let i = 0; i < 48; i++) val = (val << 8n) | BigInt(b[i]!);
    expect(val).toBe(200n);

    // offset 48: g2[0][0] = 100 (snarkjs index 0 second, c0 in arkworks)
    val = 0n;
    for (let i = 48; i < 96; i++) val = (val << 8n) | BigInt(b[i]!);
    expect(val).toBe(100n);

    // offset 96: g2[1][1] = 400
    val = 0n;
    for (let i = 96; i < 144; i++) val = (val << 8n) | BigInt(b[i]!);
    expect(val).toBe(400n);

    // offset 144: g2[1][0] = 300
    val = 0n;
    for (let i = 144; i < 192; i++) val = (val << 8n) | BigInt(b[i]!);
    expect(val).toBe(300n);
  });

  it("rejects wrong protocol", () => {
    const proof = { ...makeValidProof(), protocol: "plonk" };
    expect(() => encodeProof(proof)).toThrow(/unsupported protocol/);
  });

  it("rejects wrong curve", () => {
    const proof = { ...makeValidProof(), curve: "bn128" };
    expect(() => encodeProof(proof)).toThrow(/unsupported curve/);
  });

  it("rejects G1 flag != '1'", () => {
    const proof = { ...makeValidProof(), pi_a: ["123", "456", "0"] as [string, string, string] };
    expect(() => encodeProof(proof)).toThrow(/flag/);
  });

  it("rejects G2 flag != ['1','0']", () => {
    const proof = {
      ...makeValidProof(),
      pi_b: [["111", "222"], ["333", "444"], ["0", "0"]] as [[string, string], [string, string], [string, string]],
    };
    expect(() => encodeProof(proof)).toThrow(/flag/);
  });

  it("rejects Fq coordinate >= modulus", () => {
    // BLS12-381 Fq modulus decimal (77 digits)
    const fqModStr = "4002409555221667393417789825735904156556882819939007885332058136124031650490837864442687629129015664037894272559787";
    const proof = { ...makeValidProof(), pi_a: [fqModStr, "456", "1"] as [string, string, string] };
    expect(() => encodeProof(proof)).toThrow(/>= modulus/);
  });

  it("cross-language golden: encodePublicSignals with known nullifierHash", () => {
    // The nullifierHash for fixture r0-vote-0.json is precomputed
    const NH = "15309246400844181668452549791295656752795519099905502581510248520065524481077";
    const signals: PublicJson = [NH, "0", "5",
      "20660557021851646197600388443100395731422898485530646641308945670627648046745",
      "15158607067770416787260666106207400886047671983031147357404418838572728018630",
      "1234567890123456789012345678901234567890123456789012345678901234"];
    // Should not throw
    const encoded = encodePublicSignals(signals);
    expect(encoded.length).toBe(PUBLIC_SIGNALS_BYTE_LEN);
    // Verify the nullifierHash bytes (offset 4..36)
    const nhBigInt = BigInt(NH);
    let reconstructed = 0n;
    for (let i = 4; i < 36; i++) {
      reconstructed = (reconstructed << 8n) | BigInt(encoded[i]!);
    }
    expect(reconstructed).toBe(nhBigInt);
    // Verify signal[1]=0 (vote) at offset 36..68
    for (let i = 36; i < 68; i++) expect(encoded[i]).toBe(0);
  });
});

describe("parseFr (exported for cross-module use)", () => {
  it("parses valid Fr", () => {
    expect(parseFr("0")).toBe(0n);
    expect(parseFr("123456")).toBe(123456n);
  });
  it("rejects Fr >= modulus", () => {
    expect(() => parseFr(FR_MODULUS.toString())).toThrow(/>= modulus/);
  });
});
