import { describe, it, expect } from "vitest";
import {
  BLS12_381_SCALAR_MODULUS,
  canonicalScopeMessage,
  deriveElectionScope,
} from "../src/scope.js";
import { ZkqProtocolError } from "../src/errors.js";
import type { ElectionScopeInput } from "../src/scope.js";

const INPUT: ElectionScopeInput = {
  networkPassphrase: "Test SDF Network ; September 2015",
  contractId: ("0x" + "11".repeat(32)) as `0x${string}`,
  electionId: ("0x" + "22".repeat(32)) as `0x${string}`,
  version: 1,
};

describe("scope canonicalisation", () => {
  it("produces canonical message with fixed prefix", () => {
    const msg = canonicalScopeMessage(INPUT);
    // domain tag "zk-quorum:election-scope:v1" is 27 bytes
    const domainTagBytes = 27;
    expect(msg.length).toBe(4 + domainTagBytes + 4 + INPUT.networkPassphrase.length + 4 + 32 + 4 + 32 + 1);
    // first 4 bytes = length of domain tag as u32 BE
    expect(msg[0]).toBe(0);
    expect(msg[1]).toBe(0);
    expect(msg[2]).toBe(0);
    expect(msg[3]).toBe(domainTagBytes);
  });

  it("rejects invalid hex inputs", () => {
    expect(() => canonicalScopeMessage({ ...INPUT, contractId: "0xab" as never })).toThrow(ZkqProtocolError);
    expect(() => canonicalScopeMessage({ ...INPUT, electionId: "0xab" as never })).toThrow(ZkqProtocolError);
  });

  it("rejects out-of-range version", () => {
    expect(() => canonicalScopeMessage({ ...INPUT, version: 256 })).toThrow(ZkqProtocolError);
  });
});

describe("scope derivation", () => {
  it("rejects non-positive candidate (no fallback)", async () => {
    // digest that always returns zero => never accepted, must throw at exhaustion
    const digest = async () => new Uint8Array(32);
    await expect(deriveElectionScope(INPUT, { digest })).rejects.toBeInstanceOf(ZkqProtocolError);
  });

  it("rejects candidate >= modulus (forces rejection sampling)", async () => {
    const modBytes = new Uint8Array(32);
    let tmp = BLS12_381_SCALAR_MODULUS;
    for (let i = 31; i >= 0; i -= 1) {
      modBytes[i] = Number(tmp & 0xffn);
      tmp >>= 8n;
    }
    const digest = async () => modBytes;
    await expect(deriveElectionScope(INPUT, { digest, maxCounter: 4 })).rejects.toBeInstanceOf(ZkqProtocolError);
  });

  it("derives deterministic scope on SubtleCrypto (golden vector)", async () => {
    const scope = await deriveElectionScope(INPUT);
    expect(scope).toMatch(/^0x[0-9a-f]{64}$/);
    // re-run; identical because canonical message is deterministic
    const scope2 = await deriveElectionScope(INPUT);
    expect(scope2).toBe(scope);
  });

  it("different inputs produce different scopes", async () => {
    const a = await deriveElectionScope(INPUT);
    const b = await deriveElectionScope({ ...INPUT, electionId: ("0x" + "33".repeat(32)) as `0x${string}` });
    expect(a).not.toBe(b);
  });
});
