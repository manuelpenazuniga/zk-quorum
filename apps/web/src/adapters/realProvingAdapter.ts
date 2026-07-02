/**
 * Real R0 proving adapter — only instantiated inside the Web Worker.
 *
 * Uses snarkjs 0.7.6 groth16.fullProve for BLS12-381, verifies the proof
 * with the committed VK, encodes to Soroban canonical bytes, and computes
 * SHA-256 over those bytes. Secrets (inputs) and raw witness NEVER leave
 * this module.
 *
 * The adapter must be constructed with asset URLs and the verification key.
 * Before proving, it validates asset hashes against the served manifest.
 */
import type { ProofEnvelope, Sha256Hex } from "@zk-quorum/protocol";
import type { ProvingRequest, ProvingResponse, ProvingProgress } from "./provingAdapter.js";
import { encodeProof, encodePublicSignals, type ProofJson, type PublicJson } from "./sorobanEncoding.js";

// ── Manifest types ──

export interface AssetManifest {
  readonly schema: "UPRE_BROWSER_MANIFEST_V1";
  readonly gate: string;
  readonly circuit: string;
  readonly rung: 0;
  readonly proof_system: "Groth16";
  readonly curve: "bls12-381";
  readonly r1cs_sha256: string;
  readonly assets: ReadonlyArray<{
    readonly id: string;
    readonly kind: "wasm" | "zkey" | "vk";
    readonly sha256: string;
    readonly size: number;
  }>;
}

// ── Error allowlist — never include secrets, inputs, witness, or raw stack ──

const SANITIZED_PREFIXES: ReadonlyArray<string> = [
  "prover error: ",
  "manifest error: ",
  "encoding error: ",
  "verify error: ",
  "cancelled",
  "invalid request: ",
];

function sanitizeError(e: unknown): string {
  if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
  const msg = e instanceof Error ? e.message : String(e ?? "unknown");
  // If the message already starts with a known safe prefix, return as-is
  for (const prefix of SANITIZED_PREFIXES) {
    if (msg.startsWith(prefix)) return msg;
  }
  // Otherwise, return a generic message
  return "prover error: internal";
}

// ── Real adapter ──

export class RealR0ProvingAdapter {
  private cancelled = false;
  private wasmUrl: string;
  private zkeyUrl: string;
  private vkJson: object;
  private manifest: AssetManifest | null;

  constructor(wasmUrl: string, zkeyUrl: string, vkJson: object, manifest: AssetManifest | null = null) {
    this.wasmUrl = wasmUrl;
    this.zkeyUrl = zkeyUrl;
    this.vkJson = vkJson;
    this.manifest = manifest;
  }

  public cancel(): void {
    this.cancelled = true;
  }

  public async prove(req: ProvingRequest, onProgress: (p: ProvingProgress) => void): Promise<ProvingResponse> {
    try {
      return await this._prove(req, onProgress);
    } catch (e: unknown) {
      const reason = sanitizeError(e);
      return { ok: false, reason };
    }
  }

  private async _prove(req: ProvingRequest, onProgress: (p: ProvingProgress) => void): Promise<ProvingResponse> {
    // Validate request
    if (req.kind !== "prove-r0") {
      throw new Error("invalid request: only prove-r0 supported");
    }
    if (req.publicSchemaId !== "PUBLIC_SCHEMA_V1_R0") {
      throw new Error("invalid request: unsupported schema");
    }
    if (this.cancelled) throw new Error("cancelled");

    // Validate manifest if present
    if (this.manifest) {
      this.validateManifest(this.manifest);
    }

    // Dynamically import snarkjs (only works in worker context)
    const snarkjs = await import("snarkjs");
    const { groth16 } = snarkjs;

    if (this.cancelled) throw new Error("cancelled");

    onProgress({ stage: "witness", fraction: 0.1 });

    // Verify zkey hash against manifest before proving
    if (this.manifest) {
      await this.verifyAssetHash(this.zkeyUrl, "zkey", this.manifest);
    }

    // Run fullProve
    const result = await groth16.fullProve(
      req.inputs as Record<string, unknown>,
      this.wasmUrl,
      this.zkeyUrl,
    );

    if (this.cancelled) throw new Error("cancelled");

    onProgress({ stage: "prove", fraction: 0.8 });

    const proof = result.proof as ProofJson;
    const publicSignals = result.publicSignals as PublicJson;

    // Must have exactly 6 signals
    if (!Array.isArray(publicSignals) || publicSignals.length !== 6) {
      throw new Error(`prover error: expected 6 public signals, got ${Array.isArray(publicSignals) ? publicSignals.length : "non-array"}`);
    }

    // Verify proof with committed VK
    const verifyOk = await groth16.verify(this.vkJson, publicSignals, proof);
    if (!verifyOk) {
      throw new Error("verify error: snarkjs verification failed");
    }

    // If the request includes expected public signals, compare indices 1-5
    // (skip index 0 = nullifierHash, which is output-only and cannot be
    // precomputed by the caller). The comparison is strict string equality
    // of canonical decimal Fr values.
    if (req.publicSignals.length === publicSignals.length) {
      for (let i = 1; i < publicSignals.length; i++) {
        if (String(publicSignals[i]) !== String(req.publicSignals[i])) {
          throw new Error(`prover error: public signal mismatch at index ${i} — expected ${req.publicSignals[i]}, got ${publicSignals[i]}`);
        }
      }
    }

    onProgress({ stage: "done", fraction: 1.0 });

    // Encode to Soroban canonical bytes
    const proofBytes = encodeProof(proof);
    const publicBytes = encodePublicSignals(publicSignals);

    // SHA-256 via SubtleCrypto
    const proofBuf = proofBytes.buffer.slice(proofBytes.byteOffset, proofBytes.byteOffset + proofBytes.byteLength) as ArrayBuffer;
    const publicBuf = publicBytes.buffer.slice(publicBytes.byteOffset, publicBytes.byteOffset + publicBytes.byteLength) as ArrayBuffer;
    const proofHashRaw = await crypto.subtle.digest("SHA-256", proofBuf);
    const publicHashRaw = await crypto.subtle.digest("SHA-256", publicBuf);

    const proofHash = bytesToHex(new Uint8Array(proofHashRaw)) as Sha256Hex;
    const publicSignalsHash = bytesToHex(new Uint8Array(publicHashRaw)) as Sha256Hex;

    // Convert proof bytes to hex for envelope
    const proofHex = bytesToHex(proofBytes) as `0x${string}`;

    const envelope: ProofEnvelope = {
      electionId: req.electionId,
      publicSchemaId: req.publicSchemaId,
      publicSignals: [...publicSignals],
      proofBytes: proofHex,
    };

    return {
      ok: true,
      envelope,
      publicSignalsHash,
      proofHash,
    };
  }

  private validateManifest(m: AssetManifest): void {
    if (m.schema !== "UPRE_BROWSER_MANIFEST_V1") {
      throw new Error(`manifest error: unknown schema ${m.schema}`);
    }
    if (m.gate !== "U-PRE-BROWSER-R0") {
      throw new Error(`manifest error: unknown gate ${m.gate}`);
    }
    if (m.circuit !== "PublicVoteR0") {
      throw new Error(`manifest error: unknown circuit ${m.circuit}`);
    }
    if (m.curve !== "bls12-381") {
      throw new Error(`manifest error: unknown curve ${m.curve}`);
    }
    if (m.proof_system !== "Groth16") {
      throw new Error(`manifest error: unknown proof system ${m.proof_system}`);
    }
    if (m.rung !== 0) {
      throw new Error(`manifest error: rung must be 0`);
    }
    if (!Array.isArray(m.assets) || m.assets.length === 0) {
      throw new Error("manifest error: missing assets");
    }
  }

  private async verifyAssetHash(url: string, kind: string, manifest: AssetManifest): Promise<void> {
    const asset = manifest.assets.find((a) => a.kind === kind);
    if (!asset) {
      throw new Error(`manifest error: no ${kind} asset in manifest`);
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`manifest error: cannot fetch ${kind} asset`);
    }
    const data = await response.arrayBuffer();
    const hashBytes = await crypto.subtle.digest("SHA-256", data);
    const actualHash = bytesToHexLower(new Uint8Array(hashBytes));
    if (actualHash !== asset.sha256) {
      throw new Error(`manifest error: ${kind} SHA-256 mismatch — expected ${asset.sha256}, got ${actualHash}`);
    }
    if (data.byteLength !== asset.size) {
      throw new Error(`manifest error: ${kind} size mismatch — expected ${asset.size}, got ${data.byteLength}`);
    }
  }
}

// ── Hex utilities ──

function bytesToHex(bytes: Uint8Array): string {
  let hex = "0x";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

function bytesToHexLower(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}
