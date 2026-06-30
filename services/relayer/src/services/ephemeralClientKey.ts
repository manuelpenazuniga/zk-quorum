import { createHash } from "node:crypto";
import { ZkqProtocolError } from "@zk-quorum/protocol";

/**
 * Audit H1: derive a privacy-preserving, ephemeral per-window rate-limit key
 * from the client address WITHOUT ever logging the raw IP. The key is the
 * SHA-256 of `(salt || address)`, where `salt` rotates every `rotationMs`.
 *
 * Properties:
 *  - Two clients sharing an address share the bucket (correct: same
 *    network egress usually does mean the same actor).
 *  - The same client produces a different bucket after each rotation, so
 *    the relayer never persists a long-term identifier.
 *  - The raw address is NEVER exposed to the redacting logger. Only the
 *    opaque 32-byte hex key is.
 *  - The salt is generated with `crypto.randomBytes` (or `getRandomValues`
 *    in the browser) and discarded at rotation.
 */
export interface EphemeralKeyOptions {
  readonly rotationMs: number;
  readonly now?: () => number;
  readonly randomBytes?: (n: number) => Uint8Array;
}

export interface EphemeralKeyer {
  /** Returns the current window key, generating a new salt if needed. */
  keyFor(rawAddress: string): string;
  /** Force a rotation (used in tests). */
  rotate(): void;
  /** Returns the current salt as hex; NEVER include the address. */
  currentSaltHex(): string;
}

export function createEphemeralClientKeyer(options: EphemeralKeyOptions): EphemeralKeyer {
  if (!Number.isInteger(options.rotationMs) || options.rotationMs < 1000) {
    throw new ZkqProtocolError("INVALID_FIELD_ELEMENT", "rotationMs must be >= 1000", { rotationMs: options.rotationMs });
  }
  const now = options.now ?? Date.now;
  const random = options.randomBytes ?? defaultRandom;

  let salt = random(32);
  let saltExpiresAt = now() + options.rotationMs;

  const rotate = (): void => {
    salt = random(32);
    saltExpiresAt = now() + options.rotationMs;
  };

  const keyFor = (rawAddress: string): string => {
    if (typeof rawAddress !== "string") {
      throw new ZkqProtocolError("INVALID_HEX", "rawAddress must be a string");
    }
    if (now() >= saltExpiresAt) rotate();
    const h = createHash("sha256");
    h.update(salt);
    h.update("\0");
    h.update(rawAddress);
    return h.digest("hex");
  };

  return {
    keyFor,
    rotate,
    currentSaltHex: () => Buffer.from(salt).toString("hex"),
  };
}

function defaultRandom(n: number): Uint8Array {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.getRandomValues === "function") {
    const out = new Uint8Array(n);
    globalThis.crypto.getRandomValues(out);
    return out;
  }
  throw new Error("no CSPRNG available for ephemeral key salt");
}
