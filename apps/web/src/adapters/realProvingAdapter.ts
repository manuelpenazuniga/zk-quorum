/**
 * Real R0 proving adapter — only instantiated inside the Web Worker.
 *
 * Uses snarkjs 0.7.6 groth16.fullProve for BLS12-381, verifies the proof
 * with the committed VK, encodes to Soroban canonical bytes, and computes
 * SHA-256 over those bytes. Secrets (inputs) and raw witness NEVER leave
 * this module.
 *
 * Manifest is MANDATORY — the worker must verify all three assets
 * (wasm, zkey, vk) match the manifest's SHA-256 and size before
 * calling fullProve. There is no mock fallback in this adapter.
 */
import type { ProofEnvelope, Sha256Hex } from "@zk-quorum/protocol";
import type { ProvingRequest, ProvingResponse, ProvingProgress } from "./provingAdapter.js";
import { encodeProof, encodePublicSignals, type ProofJson, type PublicJson } from "./sorobanEncoding.js";
import { isCanonicalDecimalFr } from "./sorobanEncoding.js";

// ── Manifest types ──

export interface AssetManifest {
  readonly schema: "UPRE_BROWSER_MANIFEST_V1";
  readonly gate: "U-PRE-BROWSER-R0";
  readonly circuit: "PublicVoteR0";
  readonly rung: 0;
  readonly proof_system: "Groth16";
  readonly curve: "bls12-381";
  readonly r1cs_sha256: string;
  readonly timestamp: string;
  readonly assets: ReadonlyArray<{
    readonly id: string;
    readonly kind: "wasm" | "zkey" | "vk";
    readonly sha256: string;
    readonly size: number;
  }>;
}

const REQUIRED_ASSET_KINDS: ReadonlySet<string> = new Set(["wasm", "zkey", "vk"]);

// ── Strict request validation ──

const VALID_REQUEST_KEYS = new Set(["kind", "electionId", "publicSchemaId", "publicSignals", "inputs"]);

function validateRequest(req: ProvingRequest): void {
  // Exact key set
  const keys = Object.keys(req as Record<string, unknown>);
  for (const k of keys) {
    if (!VALID_REQUEST_KEYS.has(k)) {
      throw new Error(`invalid request: unknown key "${k}"`);
    }
  }
  if (req.kind !== "prove-r0") throw new Error("invalid request: kind must be prove-r0");
  if (req.publicSchemaId !== "PUBLIC_SCHEMA_V1_R0") throw new Error("invalid request: publicSchemaId must be PUBLIC_SCHEMA_V1_R0");
  if (typeof req.electionId !== "string" || !req.electionId.startsWith("0x")) throw new Error("invalid request: electionId must be 0x-prefixed hex");
  if (!Array.isArray(req.publicSignals) || req.publicSignals.length !== 6) throw new Error("invalid request: publicSignals must have exactly 6 elements");
  for (let i = 0; i < req.publicSignals.length; i++) {
    if (!isCanonicalDecimalFr(req.publicSignals[i])) {
      throw new Error(`invalid request: publicSignals[${i}] is not canonical decimal Fr`);
    }
  }
  if (typeof req.inputs !== "object" || req.inputs === null) throw new Error("invalid request: inputs must be a non-null object");
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
  for (const prefix of SANITIZED_PREFIXES) {
    if (msg.startsWith(prefix)) return msg;
  }
  return "prover error: internal";
}

// ── Real adapter ──

export class RealR0ProvingAdapter {
  private cancelled = false;
  private wasmUrl: string;
  private zkeyUrl: string;
  private vkUrl: string;
  private manifest: AssetManifest;
  private vkJson: object | null = null;

  constructor(wasmUrl: string, zkeyUrl: string, vkUrl: string, manifest: AssetManifest) {
    this.wasmUrl = wasmUrl;
    this.zkeyUrl = zkeyUrl;
    this.vkUrl = vkUrl;
    this.manifest = manifest;
    // Validate manifest structure immediately
    this.validateManifest(manifest);
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
    // Strict request validation
    validateRequest(req);

    if (this.cancelled) throw new Error("cancelled");

    // Verify manifest structure
    this.validateManifest(this.manifest);

    // Dynamically import snarkjs (only works in worker context)
    const snarkjs = await import("snarkjs");
    const { groth16 } = snarkjs;

    if (this.cancelled) throw new Error("cancelled");

    onProgress({ stage: "witness", fraction: 0.05 });

    // Verify ALL THREE assets (wasm, zkey, vk) hash+size against manifest.
    // VK is fetched as raw bytes, hashed, THEN parsed — ensuring the hash
    // matches what the staging script computed on the raw file.
    await this.verifyAssetHash(this.wasmUrl, "wasm", this.manifest);
    await this.verifyAssetHash(this.zkeyUrl, "zkey", this.manifest);
    await this.fetchAndVerifyVk();

    if (this.cancelled) throw new Error("cancelled");

    onProgress({ stage: "witness", fraction: 0.1 });

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

    // Verify proof with committed VK (fetched raw, hash-verified, then parsed)
    const verifyOk = await groth16.verify(this.vkJson!, publicSignals, proof);
    if (!verifyOk) {
      throw new Error("verify error: snarkjs verification failed");
    }

    // Compare ALL 6 public signals (including nullifierHash at index 0)
    // against the request's expected signals.
    if (req.publicSignals.length === 6) {
      for (let i = 0; i < 6; i++) {
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
    // 1. Reject unknown/missing top-level keys FIRST (before any value checks)
    const ALLOWED_TOP_KEYS = new Set([
      "schema", "gate", "circuit", "rung", "proof_system", "curve",
      "r1cs_sha256", "timestamp", "assets",
    ]);
    const raw = m as unknown as Record<string, unknown>;
    const keys = Object.keys(raw);
    for (const k of keys) {
      if (!ALLOWED_TOP_KEYS.has(k)) {
        throw new Error(`manifest error: unknown top-level key "${k}"`);
      }
    }
    for (const k of ALLOWED_TOP_KEYS) {
      if (!(k in raw)) {
        throw new Error(`manifest error: missing top-level key "${k}"`);
      }
    }

    // 2. Validate values
    if (m.schema !== "UPRE_BROWSER_MANIFEST_V1") throw new Error(`manifest error: unknown schema ${m.schema}`);
    if (m.gate !== "U-PRE-BROWSER-R0") throw new Error(`manifest error: unknown gate ${m.gate}`);
    if (m.circuit !== "PublicVoteR0") throw new Error(`manifest error: unknown circuit ${m.circuit}`);
    if (m.curve !== "bls12-381") throw new Error(`manifest error: unknown curve ${m.curve}`);
    if (m.proof_system !== "Groth16") throw new Error(`manifest error: unknown proof system ${m.proof_system}`);
    if (m.rung !== 0) throw new Error(`manifest error: rung must be 0`);
    if (m.r1cs_sha256 !== "455204650f4dae22fcfabf65eb20f52924f4029f69a4d3977317e42b176055a6") {
      throw new Error(`manifest error: r1cs_sha256 does not match committed manifest`);
    }
    if (typeof raw.timestamp !== "string") throw new Error("manifest error: timestamp must be string");
    if (!Array.isArray(raw.assets)) throw new Error("manifest error: assets must be array");

    // 3. Validate assets
    const assets = raw.assets as Array<Record<string, unknown>>;
    const kinds = new Set(assets.map((a) => a.kind as string));
    for (const k of REQUIRED_ASSET_KINDS) {
      if (!kinds.has(k)) throw new Error(`manifest error: missing required asset kind: ${k}`);
    }
    const expectedAssets = [
      { id: "main.wasm", kind: "wasm" },
      { id: "r0_final.zkey", kind: "zkey" },
      { id: "r0_vk.json", kind: "vk" },
    ];
    for (const expected of expectedAssets) {
      const asset = assets.find((a) => a.kind === expected.kind);
      if (!asset) throw new Error(`manifest error: missing asset kind ${expected.kind}`);
      if (asset.id !== expected.id) throw new Error(`manifest error: asset kind ${expected.kind} must have id "${expected.id}", got "${asset.id}"`);
      if (typeof asset.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(asset.sha256)) {
        throw new Error(`manifest error: ${expected.kind} SHA must be lowercase 64 hex`);
      }
      if (typeof asset.size !== "number" || asset.size <= 0 || !Number.isInteger(asset.size)) {
        throw new Error(`manifest error: ${expected.kind} size must be positive integer`);
      }
    }
    if (assets.length !== 3) throw new Error("manifest error: must have exactly 3 assets");
  }

  /** Fetch raw VK file, verify hash+size against manifest, THEN parse JSON. */
  private async fetchAndVerifyVk(): Promise<object> {
    if (this.vkJson !== null) return this.vkJson; // cached
    const asset = this.manifest.assets.find((a) => a.kind === "vk");
    if (!asset) throw new Error("manifest error: no vk asset in manifest");

    const response = await fetch(this.vkUrl);
    if (!response.ok) throw new Error(`manifest error: cannot fetch vk (HTTP ${response.status})`);
    const rawBytes = await response.arrayBuffer();

    // Verify hash+size of RAW bytes (matching staging script)
    const hashBytes = await crypto.subtle.digest("SHA-256", rawBytes);
    const actualHash = bytesToHexLower(new Uint8Array(hashBytes));
    if (actualHash !== asset.sha256) {
      throw new Error(`manifest error: vk SHA-256 mismatch — expected ${asset.sha256}, got ${actualHash}`);
    }
    if (rawBytes.byteLength !== asset.size) {
      throw new Error(`manifest error: vk size mismatch — expected ${asset.size}, got ${rawBytes.byteLength}`);
    }

    // Now parse JSON from raw bytes
    const text = new TextDecoder().decode(rawBytes);
    this.vkJson = JSON.parse(text) as object;
    return this.vkJson;
  }

  private async verifyAssetHash(url: string, kind: string, manifest: AssetManifest): Promise<void> {
    const asset = manifest.assets.find((a) => a.kind === kind);
    if (!asset) throw new Error(`manifest error: no ${kind} asset in manifest`);

    const response = await fetch(url);
    if (!response.ok) throw new Error(`manifest error: cannot fetch ${kind} asset (HTTP ${response.status})`);
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
