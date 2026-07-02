import { describe, it, expect } from "vitest";
import {
  encodePublicSignals,
  encodeProof,
  isCanonicalDecimalFr,
  PROOF_BYTE_LEN,
  PUBLIC_SIGNALS_BYTE_LEN,
  type ProofJson,
  type PublicJson,
} from "../src/adapters/sorobanEncoding.js";

// BLS12-381 Fr modulus — used by the encoder to validate
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
    // Bytes 0-3: u32 BE = 6 → [0x00, 0x00, 0x00, 0x06]
    expect(encoded[0]).toBe(0x00);
    expect(encoded[1]).toBe(0x00);
    expect(encoded[2]).toBe(0x00);
    expect(encoded[3]).toBe(0x06);
  });

  it("serializes signal '0' as 32 zero bytes", () => {
    const signals: PublicJson = ["0", "0", "0", "0", "0", "0"];
    const encoded = encodePublicSignals(signals);
    // First signal starts at offset 4
    for (let i = 4; i < 196; i++) {
      expect(encoded[i]).toBe(0);
    }
  });

  it("serializes a known non-zero Fr correctly", () => {
    // Fr value 1234567890 → 32-byte BE
    const signals: PublicJson = ["1234567890", "0", "0", "0", "0", "0"];
    const encoded = encodePublicSignals(signals);
    // Offset 4..36: 32-byte BE of 1234567890
    // 1234567890 = 0x499602D2 → BE: 00...00499602D2
    expect(encoded[4 + 31]).toBe(0xD2);
    expect(encoded[4 + 30]).toBe(0x02);
    expect(encoded[4 + 29]).toBe(0x96);
    expect(encoded[4 + 28]).toBe(0x49);
    // First 28 bytes should be zero
    for (let i = 4; i < 4 + 28; i++) {
      expect(encoded[i]).toBe(0);
    }
  });

  it("serializes Fr modulus - 1 correctly (boundary)", () => {
    const maxFr = (FR_MODULUS - 1n).toString();
    const signals: PublicJson = [maxFr, "0", "0", "0", "0", "0"];
    const encoded = encodePublicSignals(signals);
    expect(encoded.length).toBe(PUBLIC_SIGNALS_BYTE_LEN);
    // Reconstruct the value from bytes 4..36
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
    const signals: PublicJson = ["00", "1", "2", "3", "4", "5"];
    expect(() => encodePublicSignals(signals)).toThrow(/leading zeros/);
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

  it("layout: first 96 bytes = A (Fq x + Fq y)", () => {
    const proof = makeValidProof();
    const encoded = encodeProof(proof);
    // A: 48 bytes x, 48 bytes y
    const a = encoded.slice(0, 96);
    expect(a.length).toBe(96);
    // B: next 192 bytes
    const b = encoded.slice(96, 288);
    expect(b.length).toBe(192);
    // C: last 96 bytes
    const c = encoded.slice(288, 384);
    expect(c.length).toBe(96);
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
    // BLS12-381 Fq modulus in decimal (77 digits, ~4.0e75)
    const fqModulusStr = "4002409555221667393417789825735904156556882819939007885332058136124031650490837864442687629129015664037894272559787";
    // The Fq modulus itself should be rejected (>= check)
    const proof = { ...makeValidProof(), pi_a: [fqModulusStr, "456", "1"] as [string, string, string] };
    expect(() => encodeProof(proof)).toThrow(/>= modulus/);
  });
});
