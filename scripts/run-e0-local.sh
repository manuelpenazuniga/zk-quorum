#!/usr/bin/env bash
# ZK-Quorum E0 — R0 end-to-end local proof pipeline.
#
# Sequence:
#   1. Toolchain version checks
#   2. Fetch setup assets (zkey, ptau)
#   3. Compile circuits from clean
#   4. Build witness from r0-vote-0 fixture
#   5. Generate Groth16 proof
#   6. snarkjs verify
#   7. circom2soroban: convert VK / proof / public → canonical Soroban bytes
#   8. Build verifier-first (WASM)
#   9. Run Soroban Env e2e tests (real proof → cast → duplicate → tally)
#  10. Evidence bundle + replay
#
# Can use ZKQ_CIRCOM_BIN to point to a circom binary; falls back to canonical
# bootstrap path (.bootstrap/circom/v2.2.3/circom).
#
# Outputs: tmp/e0/
# Replay:  tmp/e0/evidence/
#
# Usage: bash scripts/run-e0-local.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
E0_DIR="${PROJECT_DIR}/tmp/e0"
EVIDENCE_DIR="${E0_DIR}/evidence"

cd "$PROJECT_DIR"

# ── Helpers ──
ok()   { printf '  [OK] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*" >&2; exit 1; }
info() { printf '==> %s\n' "$*"; }

# ── SHA-256 helper (Node.js, portable across macOS/Linux) ──
sha256_file() {
    node -e "
const fs = require('fs');
const crypto = require('crypto');
const buf = fs.readFileSync(process.argv[1]);
console.log(crypto.createHash('sha256').update(buf).digest('hex'));
" "$1"
}

# ─── 1. Toolchain checks ─────────────────────────────────────────────────

info "Step 1/10: Toolchain checks"

# Node
NODE_ACTUAL=$(node --version | sed 's/^v//' | cut -d. -f1)
REQUIRED_NODE=24
if [ "$NODE_ACTUAL" -lt "$REQUIRED_NODE" ]; then
    fail "Node >= ${REQUIRED_NODE} required, found $(node --version)"
fi
ok "Node $(node --version)"

# Circom
resolve_circom() {
    local candidate="${ZKQ_CIRCOM_BIN:-}"
    if [ -n "${candidate}" ]; then
        if [ ! -x "${candidate}" ]; then
            fail "ZKQ_CIRCOM_BIN=${candidate} is not executable"
        fi
        echo "${candidate}"
        return
    fi
    candidate=".bootstrap/circom/v2.2.3/circom"
    if [ -x "${candidate}" ]; then echo "${candidate}"; return; fi
    candidate=".bootstrap/bin/circom"
    if [ -x "${candidate}" ]; then echo "${candidate}"; return; fi
    fail "circom 2.2.3 not found. Set ZKQ_CIRCOM_BIN or run bootstrap."
}
CIRCOM=$(resolve_circom)
CIRCOM_VER=$(${CIRCOM} --version 2>&1 | awk 'NR==1{print $3}')
if [ "$CIRCOM_VER" != "2.2.3" ]; then
    fail "circom 2.2.3 required, found ${CIRCOM_VER}"
fi
ok "circom ${CIRCOM_VER}"

# snarkjs
SNARKJS="node_modules/.bin/snarkjs"
if [ ! -x "${SNARKJS}" ]; then
    fail "snarkjs not installed (run npm install)"
fi
SNARKJS_VER=$(node -p "require('./node_modules/snarkjs/package.json').version")
if [ "$SNARKJS_VER" != "0.7.6" ]; then
    fail "snarkjs 0.7.6 required, found ${SNARKJS_VER}"
fi
ok "snarkjs ${SNARKJS_VER}"

# Rust
RUST_ACTUAL=$(rustc --version | sed 's/rustc \([0-9]*\.[0-9]*\).*/\1/')
if [ "$RUST_ACTUAL" != "1.96" ]; then
    fail "rustc 1.96 required, found ${RUST_ACTUAL}"
fi
ok "Rust ${RUST_ACTUAL}"

# wasm target
if ! rustup target list --installed 2>/dev/null | grep -q 'wasm32v1-none'; then
    fail "target wasm32v1-none not installed"
fi
ok "Target wasm32v1-none"

echo ""

# ─── 2. Fetch setup assets ───────────────────────────────────────────────

info "Step 2/10: Fetch setup assets"
node scripts/fetch-setup-assets.js
ok "Setup assets verified"
echo ""

# ─── 3. Compile circuits from clean ──────────────────────────────────────

info "Step 3/10: Compile R0 circuit from clean"
rm -rf circuits/build/public-vote
mkdir -p circuits/build/public-vote
${CIRCOM} --prime bls12381 --r1cs --sym --wasm \
    --output circuits/build/public-vote \
    circuits/public-vote/main.circom

# Verify R1CS hash against manifest
R1CS_FILE="circuits/build/public-vote/main.r1cs"
R1CS_EXPECTED=$(node -p "require('./circuits/artifacts/manifests/public-vote-r0.json').r1cs.sha256")
R1CS_ACTUAL=$(sha256_file "$R1CS_FILE")
if [ "$R1CS_ACTUAL" != "$R1CS_EXPECTED" ]; then
    fail "R1CS SHA mismatch: got ${R1CS_ACTUAL}"
fi
ok "R1CS compiled and SHA-256 matches manifest"
echo ""

# ─── 4. Build witness ────────────────────────────────────────────────────

info "Step 4/10: Build witness from r0-vote-0.json"
mkdir -p "$E0_DIR"
WASM_FILE="circuits/build/public-vote/main_js/main.wasm"
INPUT_FILE="circuits/artifacts/fixtures/r0-vote-0.json"
WITNESS_FILE="${E0_DIR}/r0.wtns"

# The fixture has both public and private inputs; snarkjs will use all of them
# to compute the witness. Output signals (nullifierHash) are computed.
${SNARKJS} wtns calculate "$WASM_FILE" "$INPUT_FILE" "$WITNESS_FILE"
ok "Witness generated"
echo ""

# ─── 5. Generate Groth16 proof ───────────────────────────────────────────

info "Step 5/10: Generate Groth16 proof"
ZKEY_FILE="tmp/setup/r0_final.zkey"
PROOF_JSON="${E0_DIR}/proof.json"
PUBLIC_JSON="${E0_DIR}/public.json"

${SNARKJS} groth16 prove "$ZKEY_FILE" "$WITNESS_FILE" "$PROOF_JSON" "$PUBLIC_JSON"
ok "Proof generated"
echo ""

# ─── 6. snarkjs verify ───────────────────────────────────────────────────

info "Step 6/10: snarkjs groth16 verify"
VK_JSON="circuits/artifacts/manifests/r0_vk.json"
${SNARKJS} groth16 verify "$VK_JSON" "$PUBLIC_JSON" "$PROOF_JSON"
ok "snarkjs verifies proof"
echo ""

# ─── 7. circom2soroban: convert to Soroban canonical bytes ────────────────

info "Step 7/10: Convert to Soroban canonical bytes"
C2S="tools/circom2soroban/cli.js"
node "$C2S" all "$VK_JSON" "$PROOF_JSON" "$PUBLIC_JSON" "$E0_DIR"
VK_BIN="${E0_DIR}/vk.bin"
PROOF_BIN="${E0_DIR}/proof.bin"
PUBLIC_BIN="${E0_DIR}/public.bin"
ok "Converted VK (${VK_BIN}) proof (${PROOF_BIN}) public (${PUBLIC_BIN})"
echo ""

# ─── 8. Build verifier-first ─────────────────────────────────────────────

info "Step 8/10: Build verifier-first (WASM)"
bash scripts/build-verifier-first.sh
ok "Verifier-first build complete"
echo ""

# ─── 9. Run Soroban Env e2e tests ────────────────────────────────────────

info "Step 9/10: Run Soroban Env e2e tests (real proof integration)"

cargo test \
    --manifest-path contracts/zk-quorum/Cargo.toml \
    --release \
    -- e2e \
    2>&1 | tail -20

# Check exit code
E2E_EXIT=${PIPESTATUS[0]}
if [ "$E2E_EXIT" -ne 0 ]; then
    fail "E2E tests failed"
fi
ok "E2E tests passed"
echo ""

# ─── 10. Evidence bundle + replay ────────────────────────────────────────

info "Step 10/10: Evidence bundle and replay"

mkdir -p "$EVIDENCE_DIR"

# Copy artifacts
cp "$PROOF_JSON" "$EVIDENCE_DIR/proof.json"
cp "$PUBLIC_JSON" "$EVIDENCE_DIR/public.json"
cp "$VK_BIN" "$EVIDENCE_DIR/vk.bin"
cp "$PROOF_BIN" "$EVIDENCE_DIR/proof.bin"
cp "$PUBLIC_BIN" "$EVIDENCE_DIR/public.bin"

# Compute hashes
VK_SHA=$(sha256_file "$VK_BIN")
PROOF_SHA=$(sha256_file "$PROOF_BIN")
PUBLIC_SHA=$(sha256_file "$PUBLIC_BIN")

# Extract public signal values for the summary
PUBLIC_VALUES=$(node -p "JSON.stringify(require('${PUBLIC_JSON}'))")

# Write manifest
MANIFEST="${EVIDENCE_DIR}/manifest.json"
node -e "
const fs = require('fs');
const manifest = {
    gate: 'E0-LOCAL-R0',
    circuit: 'PublicVoteR0',
    schema: 'PUBLIC_SCHEMA_V1_R0',
    depth: 10,
    max_options: 16,
    vk_sha256: '${VK_SHA}',
    proof_sha256: '${PROOF_SHA}',
    public_sha256: '${PUBLIC_SHA}',
    public_signals: JSON.parse('${PUBLIC_VALUES//\'/\'\\\'\'}'),
    artifacts: ['proof.json','public.json','vk.bin','proof.bin','public.bin'],
    timestamp: new Date().toISOString()
};
fs.writeFileSync('${MANIFEST}', JSON.stringify(manifest, null, 2));
" 2>/dev/null || true
# Write manifest with node script
node -e "
const fs = require('fs');
const pub = JSON.parse(fs.readFileSync('${PUBLIC_JSON}','utf8'));
const m = {
    gate: 'E0-LOCAL-R0',
    circuit: 'PublicVoteR0',
    schema: 'PUBLIC_SCHEMA_V1_R0',
    depth: 10,
    max_options: 16,
    vk_sha256: '${VK_SHA}',
    proof_sha256: '${PROOF_SHA}',
    public_sha256: '${PUBLIC_SHA}',
    public_signals: pub,
    artifacts: ['proof.json','public.json','vk.bin','proof.bin','public.bin'],
    timestamp: new Date().toISOString()
};
fs.writeFileSync('${MANIFEST}', JSON.stringify(m, null, 2));
"
ok "Evidence manifest written to ${MANIFEST}"

# ── Replay: second snarkjs verify + hash comparison ──
info "Replay verification"
${SNARKJS} groth16 verify "$VK_JSON" "${EVIDENCE_DIR}/public.json" "${EVIDENCE_DIR}/proof.json"
ok "Replay: snarkjs verify passes"

REPLAY_VK_SHA=$(sha256_file "${EVIDENCE_DIR}/vk.bin")
REPLAY_PROOF_SHA=$(sha256_file "${EVIDENCE_DIR}/proof.bin")
REPLAY_PUBLIC_SHA=$(sha256_file "${EVIDENCE_DIR}/public.bin")

if [ "$REPLAY_VK_SHA" != "$VK_SHA" ]; then fail "Replay VK hash mismatch"; fi
if [ "$REPLAY_PROOF_SHA" != "$PROOF_SHA" ]; then fail "Replay proof hash mismatch"; fi
if [ "$REPLAY_PUBLIC_SHA" != "$PUBLIC_SHA" ]; then fail "Replay public hash mismatch"; fi
ok "Replay: all hashes match"

echo ""
echo "============================================"
echo "E0-LOCAL-R0: PASS"
echo "============================================"
echo ""
echo "Summary:"
echo "  VK SHA-256:       ${VK_SHA}"
echo "  Proof SHA-256:    ${PROOF_SHA}"
echo "  Public SHA-256:   ${PUBLIC_SHA}"
echo "  Evidence:         ${EVIDENCE_DIR}"
echo ""
echo "Public signals:"
cat "$PUBLIC_JSON"
