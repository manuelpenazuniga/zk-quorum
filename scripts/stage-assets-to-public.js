#!/usr/bin/env node
// ZK-Quorum U-Pre — Stage assets to public directory for browser proving.
//
// Fail-closed pipeline:
//   1. Verify toolchain (Node 24, snarkjs 0.7.6, circom 2.2.3)
//   2. Clean-compile R0 circuit
//   3. Verify R1CS SHA-256 against committed manifest
//   4. Copy main.wasm, r0_final.zkey, r0_vk.json to public/upre-assets/
//   5. Write manifest with schema/version, hashes, sizes
//   6. Does NOT copy fixture files with secrets
//
// Output: apps/web/public/upre-assets/manifest.json + asset files
//
// Usage: node scripts/stage-assets-to-public.js
// Exit 0 if all assets staged and verified; non-zero on failure.

const { execFileSync, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_DIR = path.join(ROOT, "circuits", "artifacts", "manifests");
const SETUP_DIR = path.join(ROOT, "tmp", "setup");
const PUBLIC_DIR = path.join(ROOT, "apps", "web", "public", "upre-assets");
const BUILD_DIR = path.join(ROOT, "circuits", "build", "public-vote");

const SNARKJS = path.join(ROOT, "node_modules", ".bin", "snarkjs");

let passed = 0;
let failed = 0;

function ok(msg) { console.log(`  [OK] ${msg}`); passed++; }
function fail(msg) { console.error(`  [FAIL] ${msg}`); failed++; process.exitCode = 1; }

function sha256File(fp) {
  const buf = fs.readFileSync(fp);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function resolveCircom() {
  if (process.env.ZKQ_CIRCOM_BIN) {
    const c = path.resolve(ROOT, process.env.ZKQ_CIRCOM_BIN);
    if (!fs.existsSync(c)) { fail(`ZKQ_CIRCOM_BIN not found: ${c}`); process.exit(1); }
    return c;
  }
  const canonical = path.join(ROOT, ".bootstrap", "circom", "v2.2.3", "circom");
  if (fs.existsSync(canonical)) return canonical;
  const legacy = path.join(ROOT, ".bootstrap", "bin", "circom");
  if (fs.existsSync(legacy)) return legacy;
  fail("circom 2.2.3 not found. Set ZKQ_CIRCOM_BIN or run bootstrap.");
  process.exit(1);
}

console.log("ZK-Quorum U-Pre — Stage Assets to Public\n");

// ── 1. Toolchain checks ──

console.log("1. Toolchain checks");

const nodeMajor = parseInt(process.version.slice(1).split(".")[0], 10);
if (nodeMajor !== 24) {
  fail(`Node major version must be 24, found ${process.version}`);
} else {
  ok(`Node ${process.version}`);
}

let snarkjsVer;
try {
  snarkjsVer = require(path.join(ROOT, "node_modules", "snarkjs", "package.json")).version;
} catch {
  fail("snarkjs not found (run npm install)");
  process.exit(1);
}
if (snarkjsVer !== "0.7.6") {
  fail(`snarkjs 0.7.6 required, found ${snarkjsVer}`);
} else {
  ok(`snarkjs ${snarkjsVer}`);
}

const CIRCOM = resolveCircom();
let circomVer;
try {
  const out = execSync(`"${CIRCOM}" --version`, { encoding: "utf8", stdio: "pipe", cwd: ROOT });
  circomVer = out.trim().split(/\s+/).pop() || "";
} catch (e) {
  fail(`Cannot run circom: ${e.message.slice(0, 200)}`);
  process.exit(1);
}
if (circomVer !== "2.2.3") {
  fail(`circom 2.2.3 required, found ${circomVer}`);
} else {
  ok(`circom ${circomVer}`);
}

// Verify setup assets are present
const r0ManifestRaw = fs.readFileSync(path.join(MANIFEST_DIR, "public-vote-r0.json"), "utf8");
const r0Manifest = JSON.parse(r0ManifestRaw);
const zkeyPath = path.join(SETUP_DIR, "r0_final.zkey");
if (!fs.existsSync(zkeyPath)) {
  fail("r0_final.zkey not found in tmp/setup — run scripts/fetch-setup-assets.js first");
  process.exit(1);
}
ok("Setup assets present");

console.log("");

// ── 2. Clean-compile R0 ──

console.log("2. Clean-compile R0 circuit");
if (fs.existsSync(BUILD_DIR)) {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
}
fs.mkdirSync(BUILD_DIR, { recursive: true });

try {
  execSync(
    `"${CIRCOM}" --prime bls12381 --r1cs --sym --wasm --output "${BUILD_DIR}" "${path.join(ROOT, "circuits", "public-vote", "main.circom")}"`,
    { cwd: ROOT, stdio: "pipe", encoding: "utf8", timeout: 60000 },
  );
  ok("R0 circuit compiled");
} catch (e) {
  fail(`Compilation failed: ${(e.stderr || e.message || "").slice(0, 300)}`);
  process.exit(1);
}

// ── 3. Verify R1CS hash ──

console.log("\n3. Verify R1CS hash against manifest");
const expectedR1cs = r0Manifest.r1cs.sha256;
const actualR1cs = sha256File(path.join(BUILD_DIR, "main.r1cs"));
if (actualR1cs !== expectedR1cs) {
  fail(`R1CS SHA-256 mismatch — expected ${expectedR1cs}, got ${actualR1cs}`);
  process.exit(1);
}
ok("R1CS SHA-256 matches manifest");
console.log("");

// ── 4. Copy assets to public directory ──

console.log("4. Copy assets to public/upre-assets/");

// Clean and recreate
if (fs.existsSync(PUBLIC_DIR)) {
  fs.rmSync(PUBLIC_DIR, { recursive: true, force: true });
}
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

const assets = [
  {
    id: "main.wasm",
    kind: "wasm",
    src: path.join(BUILD_DIR, "main_js", "main.wasm"),
    dest: path.join(PUBLIC_DIR, "main.wasm"),
  },
  {
    id: "r0_final.zkey",
    kind: "zkey",
    src: zkeyPath,
    dest: path.join(PUBLIC_DIR, "r0_final.zkey"),
  },
  {
    id: "r0_vk.json",
    kind: "vk",
    src: path.join(MANIFEST_DIR, "r0_vk.json"),
    dest: path.join(PUBLIC_DIR, "r0_vk.json"),
  },
];

const manifestAssets = [];

for (const asset of assets) {
  if (!fs.existsSync(asset.src)) {
    fail(`Source not found: ${asset.src}`);
    continue;
  }
  fs.copyFileSync(asset.src, asset.dest);
  const sha = sha256File(asset.dest);
  const size = fs.statSync(asset.dest).size;
  manifestAssets.push({ id: asset.id, kind: asset.kind, sha256: sha, size });
  ok(`${asset.id}: ${size} bytes, SHA-256 ${sha.slice(0, 16)}...`);
}

// ── 5. Write manifest ──

console.log("\n5. Write manifest");

const manifest = {
  schema: "UPRE_BROWSER_MANIFEST_V1",
  gate: "U-PRE-BROWSER-R0",
  circuit: "PublicVoteR0",
  rung: 0,
  proof_system: "Groth16",
  curve: "bls12-381",
  r1cs_sha256: actualR1cs,
  assets: manifestAssets,
  timestamp: new Date().toISOString(),
};

const manifestPath = path.join(PUBLIC_DIR, "manifest.json");
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
ok(`Manifest written: ${manifestPath}`);

// ── Summary ──

console.log(`\n========================================`);
console.log(`Staging: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("STAGING FAILED");
  process.exit(1);
} else {
  console.log("All assets staged and verified.");
  console.log(`Public directory: ${PUBLIC_DIR}`);
}
