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
#   7. Build circom2soroban converter (Rust)
#   8. circom2soroban: convert VK / proof / public → canonical Soroban bytes
#   9. Build verifier-first (WASM)
#  10. Run Soroban Env e2e tests (real proof → cast → duplicate → tally → obs)
#  11. Evidence bundle + standalone replay
#
# Outputs: tmp/e0/
#
# Usage: bash scripts/run-e0-local.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
E0_DIR="${PROJECT_DIR}/tmp/e0"
EVIDENCE_DIR="${E0_DIR}/evidence"

cd "$PROJECT_DIR"

# ── Start clean ──
rm -rf "$E0_DIR"
mkdir -p "$E0_DIR" "$EVIDENCE_DIR"

# ── Helpers ──
ok()   { printf '  [OK] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*" >&2; exit 1; }
info() { printf '==> %s\n' "$*"; }

sha256_file() {
    node -e "
const fs = require('fs');
const crypto = require('crypto');
const buf = fs.readFileSync(process.argv[1]);
console.log(crypto.createHash('sha256').update(buf).digest('hex'));
" "$1"
}

# ─── 1. Toolchain checks ─────────────────────────────────────────────────

info "Step 1/11: Toolchain checks"

# Node 24 exactly
NODE_MAJOR=$(node --version | sed 's/^v//' | cut -d. -f1)
if [ "$NODE_MAJOR" != "24" ]; then
    fail "Node major version must be exactly 24, found $(node --version)"
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

if ! rustup target list --installed 2>/dev/null | grep -q 'wasm32v1-none'; then
    fail "target wasm32v1-none not installed"
fi
ok "Target wasm32v1-none"
echo ""

# ─── 2. Fetch setup assets ───────────────────────────────────────────────

info "Step 2/11: Fetch setup assets"
node scripts/fetch-setup-assets.js
ok "Setup assets verified"
echo ""

# ─── 3. Compile circuits from clean ──────────────────────────────────────

info "Step 3/11: Compile R0 circuit from clean"
rm -rf circuits/build/public-vote
mkdir -p circuits/build/public-vote
${CIRCOM} --prime bls12381 --r1cs --sym --wasm \
    --output circuits/build/public-vote \
    circuits/public-vote/main.circom

R1CS_EXPECTED=$(node -p "require('./circuits/artifacts/manifests/public-vote-r0.json').r1cs.sha256")
R1CS_ACTUAL=$(sha256_file circuits/build/public-vote/main.r1cs)
if [ "$R1CS_ACTUAL" != "$R1CS_EXPECTED" ]; then
    fail "R1CS SHA mismatch"
fi
ok "R1CS compiled and verified"
echo ""

# ─── 4. Build witness ────────────────────────────────────────────────────

info "Step 4/11: Build witness from r0-vote-0.json"
${SNARKJS} wtns calculate circuits/build/public-vote/main_js/main.wasm \
    circuits/artifacts/fixtures/r0-vote-0.json "${E0_DIR}/r0.wtns"
ok "Witness generated"
echo ""

# ─── 5. Generate Groth16 proof ───────────────────────────────────────────

info "Step 5/11: Generate Groth16 proof"
${SNARKJS} groth16 prove tmp/setup/r0_final.zkey "${E0_DIR}/r0.wtns" \
    "${E0_DIR}/proof.json" "${E0_DIR}/public.json"
ok "Proof generated"
echo ""

# ─── 6. snarkjs verify ───────────────────────────────────────────────────

info "Step 6/11: snarkjs groth16 verify"
VK_JSON="circuits/artifacts/manifests/r0_vk.json"
${SNARKJS} groth16 verify "$VK_JSON" "${E0_DIR}/public.json" "${E0_DIR}/proof.json"
ok "snarkjs verifies proof"
echo ""

# ─── 7. Build circom2soroban converter ────────────────────────────────────

info "Step 7/11: Build circom2soroban converter (Rust)"
cargo build --manifest-path tools/circom2soroban/Cargo.toml --release
ok "circom2soroban built"
echo ""

# ─── 8. Convert to Soroban canonical bytes ────────────────────────────────

info "Step 8/11: Convert to Soroban canonical bytes"
cargo run --manifest-path tools/circom2soroban/Cargo.toml --release -- \
    all "$VK_JSON" "${E0_DIR}/proof.json" "${E0_DIR}/public.json" "$E0_DIR"
VK_BIN="${E0_DIR}/vk.bin"
PROOF_BIN="${E0_DIR}/proof.bin"
PUBLIC_BIN="${E0_DIR}/public.bin"
ok "Converted to canonical bytes"
echo ""

# ─── 9. Build verifier-first ─────────────────────────────────────────────

info "Step 9/11: Build verifier-first (WASM)"
bash scripts/build-verifier-first.sh
ok "Verifier-first build complete"
echo ""

# ─── 10. Run Soroban Env e2e tests ───────────────────────────────────────

info "Step 10/11: Run Soroban Env e2e tests"
cargo test \
    --manifest-path contracts/zk-quorum/Cargo.toml \
    --release \
    -- e2e \
    2>&1 | tail -20
E2E_EXIT=${PIPESTATUS[0]}
if [ "$E2E_EXIT" -ne 0 ]; then
    fail "E2E tests failed"
fi
ok "E2E tests passed"
echo ""

# ─── 11. Evidence bundle + replay ────────────────────────────────────────

info "Step 11/11: Evidence bundle and standalone replay"

# Copy artifacts into evidence
cp "${E0_DIR}/proof.json" "$EVIDENCE_DIR/proof.json"
cp "${E0_DIR}/public.json" "$EVIDENCE_DIR/public.json"
cp "$VK_BIN" "$EVIDENCE_DIR/vk.bin"
cp "$PROOF_BIN" "$EVIDENCE_DIR/proof.bin"
cp "$PUBLIC_BIN" "$EVIDENCE_DIR/public.bin"

# Compute hashes
VK_SHA=$(sha256_file "$VK_BIN")
PROOF_SHA=$(sha256_file "$PROOF_BIN")
PUBLIC_SHA=$(sha256_file "$PUBLIC_BIN")

# Write manifest
node -e "
const fs = require('fs');
const pub = JSON.parse(fs.readFileSync('${E0_DIR}/public.json','utf8'));
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
    artifacts: ['proof.json','public.json','vk.bin','proof.bin','public.bin','contract-observation.json'],
    timestamp: new Date().toISOString()
};
fs.writeFileSync('${EVIDENCE_DIR}/manifest.json', JSON.stringify(m, null, 2));
"
ok "Evidence manifest written"

# Standalone replay
info "Running standalone replay"
node scripts/replay-e0.js "$EVIDENCE_DIR"
REPLAY_EXIT=$?
if [ "$REPLAY_EXIT" -ne 0 ]; then
    fail "Standalone replay failed"
fi
ok "Standalone replay passed"

echo ""
echo "============================================"
echo "E0-LOCAL-R0: ALL GATES PASS"
echo "============================================"
echo ""
echo "Evidence: $EVIDENCE_DIR"
echo "VK SHA-256:       $VK_SHA"
echo "Proof SHA-256:    $PROOF_SHA"
echo "Public SHA-256:   $PUBLIC_SHA"
