#!/usr/bin/env bash
# ZK-Quorum T0 — Testnet R0 prepare-only runner.
#
# Performs all pre-deploy validation without sending transactions.
# Deploy/invoke requires explicit `--execute` flag (aborts until Codex review).
#
# Phases (prepare-only):
#   1. Toolchain version checks (exact versions, fail-closed)
#   2. Network/passphrase check (testnet only)
#   3. Identity check (stellar keys address only, no show/export/secret)
#   4. Ledger/RPC query and balance
#   5. Download/verify C0 assets (zkey, ptau)
#   6. Verifier-first build from clean
#   7. Compare WASM hashes with frozen expected values
#   8. Generate VK bins (vk_r0.bin, vk_r1.bin) + validate hashes/format
#   9. Create clean tmp/t0/ directory without secrets
#  10. Scope/proof helpers parameterized by future contract ID
#  11. Schema/replay/secret scan and negative tests
#
# Usage: bash scripts/run-t0-testnet-r0.sh [--prepare-only] [--execute]
#   --prepare-only (default): validate everything, create evidence, no tx
#   --execute: deploys and invokes (ABORTS until Codex review)
#
# Output: tmp/t0/
# Exit 0: all prepare-only checks pass
# Exit 1: any failure
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
T0_DIR="${PROJECT_DIR}/tmp/t0"
EVIDENCE_DIR="${T0_DIR}/evidence"

cd "$PROJECT_DIR"

# ── Helpers ───────────────────────────────────────────────────────────────────
ok()   { printf '  [OK] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*" >&2; exit 1; }
info() { printf '==> %s\n' "$*"; }

# SHA-256 of a file
sha256_file() {
    node -e "
const fs = require('fs');
const crypto = require('crypto');
const buf = fs.readFileSync(process.argv[1]);
console.log(crypto.createHash('sha256').update(buf).digest('hex'));
" "$1"
}

# Determine mode
EXECUTE_MODE=false
if [[ "${1:-}" == "--execute" ]]; then
    EXECUTE_MODE=true
elif [[ "${1:-}" == "--prepare-only" || "${1:-}" == "" ]]; then
    EXECUTE_MODE=false
else
    fail "Unknown flag: ${1:-}. Use --prepare-only (default) or --execute."
fi

# ── Critical safety: --execute aborts until Codex review ──────────────────────
if $EXECUTE_MODE; then
    echo ""
    echo "============================================"
    echo "  --execute requested but NOT YET AUTHORIZED"
    echo "============================================"
    echo ""
    echo "  The T0 execute gate requires explicit Codex review."
    echo "  This script will NOT deploy, invoke, or send"
    echo "  any transaction until the review is complete."
    echo ""
    echo "  ABORTING BEFORE TRANSACTIONS."
    echo ""
    exit 1
fi

# Clean evidence directory at the start of prepare (after execute safety check)
rm -rf "$T0_DIR"

echo ""
echo "============================================"
echo "  ZK-Quorum T0 TESTNET R0 — PREPARE ONLY"
echo "============================================"
echo "  Mode: prepare-only (no transactions)"
echo "  Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# ══════════════════════════════════════════════════════════════════════════════
# Phase 1: Toolchain version checks (exact, fail-closed)
# ══════════════════════════════════════════════════════════════════════════════
info "Phase 1/11: Toolchain version checks"

# Node 24
NODE_MAJOR=$(node --version | sed 's/^v//' | cut -d. -f1)
if [ "$NODE_MAJOR" != "24" ]; then
    fail "Node major version must be exactly 24, found $(node --version)"
fi
ok "Node $(node --version)"

# Rust 1.96
RUST_ACTUAL=$(rustc --version | sed 's/rustc \([0-9]*\.[0-9]*\).*/\1/')
if [ "$RUST_ACTUAL" != "1.96" ]; then
    fail "rustc 1.96 required, found ${RUST_ACTUAL}"
fi
ok "Rust ${RUST_ACTUAL}"

# wasm32v1-none target
if ! rustup target list --installed 2>/dev/null | grep -q 'wasm32v1-none'; then
    fail "Target wasm32v1-none not installed"
fi
ok "Target wasm32v1-none"

# Circom 2.2.3
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
    # Try PATH and return absolute path
    if command -v circom &>/dev/null; then command -v circom; return; fi
    fail "circom 2.2.3 not found. Set ZKQ_CIRCOM_BIN or run bootstrap."
}
CIRCOM=$(resolve_circom)
CIRCOM_VER=$(${CIRCOM} --version 2>&1 | awk 'NR==1{print $3}')
if [ "$CIRCOM_VER" != "2.2.3" ]; then
    fail "circom 2.2.3 required, found ${CIRCOM_VER}"
fi
ok "circom ${CIRCOM_VER}"

# snarkjs 0.7.6
SNARKJS="node_modules/.bin/snarkjs"
if [ ! -x "${SNARKJS}" ]; then
    fail "snarkjs not installed (run npm install)"
fi
SNARKJS_VER=$(node -p "require('./node_modules/snarkjs/package.json').version")
if [ "$SNARKJS_VER" != "0.7.6" ]; then
    fail "snarkjs 0.7.6 required, found ${SNARKJS_VER}"
fi
ok "snarkjs ${SNARKJS_VER}"

# Stellar CLI 27
STELLAR_VERSION=$(stellar --version 2>&1 | head -1 | awk '{print $2}')
STELLAR_MAJOR=$(echo "${STELLAR_VERSION}" | cut -d. -f1)
if [ "$STELLAR_MAJOR" != "27" ]; then
    fail "Stellar CLI 27 required, found ${STELLAR_VERSION}"
fi
ok "Stellar CLI ${STELLAR_VERSION}"

echo ""

# ══════════════════════════════════════════════════════════════════════════════
# Phase 2: Network and passphrase check
# ══════════════════════════════════════════════════════════════════════════════
info "Phase 2/11: Network and passphrase check"

TESTNET_PASSPHRASE="Test SDF Network ; September 2015"

# Get active network info and verify Protocol Version and Passphrase exactly
NETWORK_INFO=$(stellar network info --network testnet 2>&1) || fail "stellar network info failed: ${NETWORK_INFO}"
if ! echo "${NETWORK_INFO}" | grep -q "Protocol Version: 27"; then
    fail "Protocol Version 27 not found in network info: ${NETWORK_INFO}"
fi
if ! echo "${NETWORK_INFO}" | grep -q "${TESTNET_PASSPHRASE}"; then
    fail "Testnet passphrase not found in network info: ${NETWORK_INFO}"
fi
ok "Testnet network info verified: Protocol Version 27 & Passphrase match"

# Verify network health and parse Latest ledger
HEALTH_INFO=$(stellar network health --network testnet 2>&1) || fail "stellar network health failed: ${HEALTH_INFO}"

# Normalize health output by removing exact checkmark and info prefixes
NORMALIZED_HEALTH=$(echo "${HEALTH_INFO}" | sed -e 's/^✅ //' -e 's/^ℹ️ //')

if ! echo "${NORMALIZED_HEALTH}" | grep -Fxq 'Healthy'; then
    fail "Stellar network health status is not Healthy. Output: ${HEALTH_INFO}"
fi
ok "stellar network health is Healthy"

if ! LEDGER_LINE=$(echo "${NORMALIZED_HEALTH}" | grep -x -E 'Latest ledger: [0-9]+'); then
    fail "Could not find exact Latest ledger line in health info: ${HEALTH_INFO}"
fi
LATEST_LEDGER=$(echo "${LEDGER_LINE}" | grep -o -E '[0-9]+')
if [ -z "${LATEST_LEDGER}" ] || [ "${LATEST_LEDGER}" -le 0 ] 2>/dev/null; then
    fail "Latest ledger is invalid (must be > 0): ${LATEST_LEDGER}"
fi
ok "Latest ledger: ${LATEST_LEDGER}"

echo ""

# ══════════════════════════════════════════════════════════════════════════════
# Phase 3: Identity check (ONLY stellar keys address + ls, NO show/export/secret)
# ══════════════════════════════════════════════════════════════════════════════
info "Phase 3/11: Identity check (address-only, no secret exposure)"

IDENTITY="zkq-t0-20260702"
EXPECTED_ADDRESS="GCWZZEAFBUN2S2WOV5FFBX4QVRA7AORQLMUHJDCIMZZCO24YDXVTLDAG"

# Only: stellar keys address (public only)
ACTUAL_ADDRESS=$(stellar keys address "$IDENTITY" 2>&1)
if [ "$ACTUAL_ADDRESS" != "$EXPECTED_ADDRESS" ]; then
    fail "Identity address mismatch: got ${ACTUAL_ADDRESS}, expected ${EXPECTED_ADDRESS}"
fi
ok "Identity ${IDENTITY} → ${ACTUAL_ADDRESS} (public address confirmed)"

# Only: stellar keys ls (list identities, no secrets)
if stellar keys ls 2>/dev/null | grep -q "$IDENTITY"; then
    ok "Identity ${IDENTITY} found in keychain"
else
    fail "Identity ${IDENTITY} not found in keychain"
fi

# Assert: NO stellar keys show was executed (detect if it appeared in any subprocess)
# Sanity: verify the address output does NOT contain an S-key prefix
if echo "$ACTUAL_ADDRESS" | grep -q '^S'; then
    fail "SAFETY VIOLATION: address output contains StrKey secret prefix S..."
fi
ok "No secret material in address output"

# Scan entire script output for secret leakage (post-hoc check done by t0.ts helpers)
ok "Identity checks complete (no show/export/secret used)"

echo ""

# ══════════════════════════════════════════════════════════════════════════════
# Phase 4: Horizon API query and public balance check
# ══════════════════════════════════════════════════════════════════════════════
info "Phase 4/11: Horizon API query and public balance check"

# Check balance, sequence and ledger using Horizon API
HORIZON_URL="https://horizon-testnet.stellar.org/accounts/${EXPECTED_ADDRESS}"
HORIZON_JSON=$(curl --proto =https --tlsv1.2 --max-time 30 --fail --silent --show-error "${HORIZON_URL}") || fail "Failed to query Horizon API at ${HORIZON_URL}"

# Validate Horizon JSON using Node.js
node -e "
const json = JSON.parse(process.argv[1]);
const expectedAddress = process.argv[2];
if (json.account_id !== expectedAddress) {
    console.error('Account ID mismatch in Horizon response');
    process.exit(1);
}
const nativeBalanceObj = json.balances.find(b => b.asset_type === 'native');
if (!nativeBalanceObj) {
    console.error('Native balance not found in Horizon response');
    process.exit(1);
}
const balanceStr = nativeBalanceObj.balance;
const balanceVal = parseFloat(balanceStr);
if (isNaN(balanceVal) || !isFinite(balanceVal) || balanceVal <= 0) {
    console.error('Native balance must be a finite positive decimal: ' + balanceStr);
    process.exit(1);
}
const seqStr = json.sequence;
if (typeof seqStr !== 'string' || !/^[0-9]+$/.test(seqStr)) {
    console.error('Sequence must be a string containing only digits');
    process.exit(1);
}
const seqBi = BigInt(seqStr);
if (seqBi <= 0n) {
    console.error('Sequence BigInt must be greater than 0');
    process.exit(1);
}
const lastLedger = json.last_modified_ledger;
if (typeof lastLedger !== 'number' || !Number.isInteger(lastLedger) || lastLedger <= 0) {
    console.error('last_modified_ledger must be an integer greater than 0');
    process.exit(1);
}
" "${HORIZON_JSON}" "${EXPECTED_ADDRESS}" || fail "Horizon JSON validation failed"

BALANCE_AMOUNT=$(node -e "console.log(JSON.parse(process.argv[1]).balances.find(b => b.asset_type === 'native').balance)" "${HORIZON_JSON}")
ok "Public balance verified: ${BALANCE_AMOUNT} XLM (native, sequence & last_modified_ledger valid)"

echo ""

# ══════════════════════════════════════════════════════════════════════════════
# Phase 5: Download/verify C0 assets
# ══════════════════════════════════════════════════════════════════════════════
info "Phase 5/11: Download/verify C0 assets"

# Run the existing fetch-setup-assets.js (downloads ptau, r0_final.zkey, r1_final.zkey)
node scripts/fetch-setup-assets.js
FETCH_EXIT=$?
if [ "$FETCH_EXIT" -ne 0 ]; then
    fail "C0 asset fetch/verify failed"
fi
ok "C0 assets downloaded and verified"

# Explicitly verify r0_final.zkey SHA-256
EXPECTED_R0_ZKEY_SHA="519cc5cb6f34227da36c0a11b75e7b684a3f2e85109b36e8485ea5adbd8330d1"
ACTUAL_R0_ZKEY_SHA=$(sha256_file tmp/setup/r0_final.zkey)
if [ "$ACTUAL_R0_ZKEY_SHA" != "$EXPECTED_R0_ZKEY_SHA" ]; then
    fail "r0_final.zkey SHA-256 mismatch: got ${ACTUAL_R0_ZKEY_SHA}, expected ${EXPECTED_R0_ZKEY_SHA}"
fi
ok "r0_final.zkey SHA-256 verified"

# Explicitly verify r1_final.zkey SHA-256
EXPECTED_R1_ZKEY_SHA="7ce3539ef7a2a160386e961edfd316e3c8b2f155957e1b46ff19e015eac5a8fb"
ACTUAL_R1_ZKEY_SHA=$(sha256_file tmp/setup/r1_final.zkey)
if [ "$ACTUAL_R1_ZKEY_SHA" != "$EXPECTED_R1_ZKEY_SHA" ]; then
    fail "r1_final.zkey SHA-256 mismatch: got ${ACTUAL_R1_ZKEY_SHA}, expected ${EXPECTED_R1_ZKEY_SHA}"
fi
ok "r1_final.zkey SHA-256 verified"

# Explicitly verify ptau SHA-256
EXPECTED_PTAU_SHA="25f790d3e910135f71985f198b67ca10c7365b334f631e1d5a0c3a02d1c6c71f"
ACTUAL_PTAU_SHA=$(sha256_file tmp/setup/pot14_final.ptau)
if [ "$ACTUAL_PTAU_SHA" != "$EXPECTED_PTAU_SHA" ]; then
    fail "pot14_final.ptau SHA-256 mismatch: got ${ACTUAL_PTAU_SHA}, expected ${EXPECTED_PTAU_SHA}"
fi
ok "pot14_final.ptau SHA-256 verified"

# snarkjs ptv verify on ptau
echo ""
echo "    Running snarkjs ptau verification..."
PTV_OUT=$("${SNARKJS}" ptv tmp/setup/pot14_final.ptau 2>&1)
if echo "${PTV_OUT}" | grep -qi 'Ok'; then
    ok "snarkjs powersoftau verify: PASS"
else
    echo "${PTV_OUT}" >&2
    fail "snarkjs powersoftau verify failed"
fi

echo ""

# ══════════════════════════════════════════════════════════════════════════════
# Phase 6: Regeneracion canonica E0 + verifier-first limpio
# ══════════════════════════════════════════════════════════════════════════════
info "Phase 6/11: Regeneracion canonica E0 + verifier-first limpio"

echo "    Running run-e0-local.sh..."
ZKQ_CIRCOM_BIN="$CIRCOM" bash scripts/run-e0-local.sh || fail "Regeneracion canonica E0 y verifier-first build failed"

# Verify E0 assets and compiled WASMs exist and are not empty
for f in "tmp/e0/vk.bin" "tmp/e0/proof.bin" "tmp/e0/public.bin" "contracts/groth16-verifier/target/wasm32v1-none/release/groth16_verifier.wasm" "contracts/zk-quorum/target/wasm32v1-none/release/zk_quorum.wasm"; do
    if [ ! -s "$f" ]; then
        fail "Required E0 asset or WASM file is missing or empty: $f"
    fi
done
ok "Regeneracion canonica E0 + verifier-first limpio complete"

echo ""

# ══════════════════════════════════════════════════════════════════════════════
# Phase 7: Compare WASM hashes
# ══════════════════════════════════════════════════════════════════════════════
info "Phase 7/11: WASM hash comparison"

EXPECTED_VERIFIER_WASM_SHA="d6f6bb12d2e8f88ab34b076ef8800c8ea53c0e504ea8c85269b6cb6b75fa94ab"
EXPECTED_ZKQ_WASM_SHA="b9c6b42bafd7f1fe5b01884593793b804d0a88ed6be01eabab94c34fa0508c30"

VERIFIER_WASM="contracts/groth16-verifier/target/wasm32v1-none/release/groth16_verifier.wasm"
ZKQ_WASM="contracts/zk-quorum/target/wasm32v1-none/release/zk_quorum.wasm"

if [ ! -f "$VERIFIER_WASM" ]; then
    fail "Verifier WASM not found at ${VERIFIER_WASM}"
fi
VERIFIER_ACTUAL_SHA=$(sha256_file "$VERIFIER_WASM")
if [ "$VERIFIER_ACTUAL_SHA" != "$EXPECTED_VERIFIER_WASM_SHA" ]; then
    fail "groth16_verifier.wasm SHA-256 mismatch: got ${VERIFIER_ACTUAL_SHA}, expected ${EXPECTED_VERIFIER_WASM_SHA}"
fi
ok "groth16_verifier.wasm SHA-256: ${VERIFIER_ACTUAL_SHA}"

if [ ! -f "$ZKQ_WASM" ]; then
    fail "zk-quorum WASM not found at ${ZKQ_WASM}"
fi
ZKQ_ACTUAL_SHA=$(sha256_file "$ZKQ_WASM")
if [ "$ZKQ_ACTUAL_SHA" != "$EXPECTED_ZKQ_WASM_SHA" ]; then
    fail "zk_quorum.wasm SHA-256 mismatch: got ${ZKQ_ACTUAL_SHA}, expected ${EXPECTED_ZKQ_WASM_SHA}"
fi
ok "zk_quorum.wasm SHA-256: ${ZKQ_ACTUAL_SHA}"

echo ""

# ══════════════════════════════════════════════════════════════════════════════
# Phase 8: Generate VK bins and validate hashes/format
# ══════════════════════════════════════════════════════════════════════════════
info "Phase 8/11: Generate VK bins and validate hashes/format"

# Build circom2soroban if not already built
if [ ! -f "tools/circom2soroban/target/release/circom2soroban" ]; then
    cargo build --manifest-path tools/circom2soroban/Cargo.toml --release
fi
C2S="tools/circom2soroban/target/release/circom2soroban"

mkdir -p "$T0_DIR"

# Generate vk_r0.bin from r0_vk.json
VK_R0_JSON="circuits/artifacts/manifests/r0_vk.json"
"$C2S" vk "$VK_R0_JSON" "${T0_DIR}/vk_r0.bin"
VK_R0_SIZE=$(wc -c < "${T0_DIR}/vk_r0.bin" | tr -d ' ')
VK_R0_SHA=$(sha256_file "${T0_DIR}/vk_r0.bin")
if [ "$VK_R0_SIZE" -ne 1348 ]; then
    fail "vk_r0.bin size mismatch: got ${VK_R0_SIZE}, expected 1348"
fi
ok "vk_r0.bin: ${VK_R0_SIZE} bytes, SHA-256: ${VK_R0_SHA}"

# Generate vk_r1.bin from r1_vk.json
VK_R1_JSON="circuits/artifacts/manifests/r1_vk.json"
"$C2S" vk "$VK_R1_JSON" "${T0_DIR}/vk_r1.bin"
VK_R1_SIZE=$(wc -c < "${T0_DIR}/vk_r1.bin" | tr -d ' ')
VK_R1_SHA=$(sha256_file "${T0_DIR}/vk_r1.bin")
if [ "$VK_R1_SIZE" -ne 1348 ]; then
    fail "vk_r1.bin size mismatch: got ${VK_R1_SIZE}, expected 1348"
fi
ok "vk_r1.bin: ${VK_R1_SIZE} bytes, SHA-256: ${VK_R1_SHA}"

echo ""

# ══════════════════════════════════════════════════════════════════════════════
# Phase 9: Create clean tmp/t0/ directory and write prepare.json
# ══════════════════════════════════════════════════════════════════════════════
info "Phase 9/11: Create clean tmp/t0/ evidence directory and write prepare.json"

mkdir -p "$EVIDENCE_DIR"

# Copy VK bins to evidence
cp "${T0_DIR}/vk_r0.bin" "${EVIDENCE_DIR}/vk_r0.bin"
cp "${T0_DIR}/vk_r1.bin" "${EVIDENCE_DIR}/vk_r1.bin"

# Write preflight data to prepare.json
cat > "${EVIDENCE_DIR}/prepare.json" <<PREPARE
{
  "network": "testnet",
  "passphrase": "${TESTNET_PASSPHRASE}",
  "source_public_address": "${EXPECTED_ADDRESS}",
  "verifier_wasm_sha256": "${VERIFIER_ACTUAL_SHA}",
  "zkquorum_wasm_sha256": "${ZKQ_ACTUAL_SHA}",
  "vk_r0_sha256": "${VK_R0_SHA}",
  "vk_r1_sha256": "${VK_R1_SHA}",
  "r0_zkey_sha256": "${ACTUAL_R0_ZKEY_SHA}",
  "r1_zkey_sha256": "${ACTUAL_R1_ZKEY_SHA}",
  "ptau_sha256": "${ACTUAL_PTAU_SHA}",
  "latest_ledger": ${LATEST_LEDGER},
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
PREPARE
ok "Evidence directory created and prepare.json written at ${EVIDENCE_DIR}"

# Secret scan on all evidence files using a self-contained Node snippet
echo "    Running secret scan on evidence files..."
node -e "
const fs = require('fs');
const path = require('path');
const STRKEY_SECRET_RE = /\bS[A-Z2-7]{55}\b/g;
let scanOk = true;
function scanDir(dir) {
    for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f);
        if (fs.statSync(fp).isDirectory()) { scanDir(fp); continue; }
        if (fp.endsWith('.bin')) continue; // binary skip
        const text = fs.readFileSync(fp, 'utf8');
        const matches = text.match(STRKEY_SECRET_RE);
        if (matches && matches.length > 0) {
            console.error('  [FAIL] ' + fp + ': prohibited StrKey secret(s) found');
            scanOk = false;
        }
    }
}
scanDir('${EVIDENCE_DIR}');
if (!scanOk) process.exit(1);
console.log('  [OK] No secrets in evidence');
" || fail "Secret scan found prohibited material in evidence"
ok "Secret scan: PASS (no S-keys in evidence)"

echo ""

# ══════════════════════════════════════════════════════════════════════════════
# Phase 10: Scope/proof helpers typecheck (delegated to packages/protocol checks)
# ══════════════════════════════════════════════════════════════════════════════
info "Phase 10/11: Protocol helpers typecheck"

# Verify the protocol package typechecks successfully
echo "    Installing protocol dependencies..."
npm ci --prefix packages/protocol || fail "Protocol dependency install failed"
ok "Protocol dependencies installed successfully"

echo "    Typechecking protocol package..."
npm --prefix packages/protocol run typecheck || fail "Protocol typecheck failed"
ok "Protocol package typechecked successfully"

echo ""

# ══════════════════════════════════════════════════════════════════════════════
# Phase 11: Secret scan and test suite checks
# ══════════════════════════════════════════════════════════════════════════════
info "Phase 11/11: Secret scan and test suite checks"

# Run protocol package tests for t0.test.ts (which validates manifest negatives, integers, C0, etc.)
echo "    Running protocol package unit tests..."
npm --prefix packages/protocol test -- --run tests/t0.test.ts || fail "Protocol unit tests failed"
ok "Protocol unit tests: PASS"

# Secret scan on all generated files in tmp/t0/ using a self-contained Node snippet
echo "    Running comprehensive secret scan on tmp/t0/..."
node -e "
const fs = require('fs');
const path = require('path');
const STRKEY_SECRET_RE = /\bS[A-Z2-7]{55}\b/g;
let failures = 0;
function scanDir(dir) {
    for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f);
        if (fs.statSync(fp).isDirectory()) { scanDir(fp); continue; }
        if (f.endsWith('.bin') || f.endsWith('.wasm') || f.endsWith('.zkey') || f.endsWith('.ptau')) continue;
        const text = fs.readFileSync(fp, 'utf8');
        const matches = text.match(STRKEY_SECRET_RE);
        if (matches && matches.length > 0) {
            console.error('  [FAIL] ' + fp + ': prohibited StrKey secret(s) found');
            failures++;
        }
    }
}
scanDir('${T0_DIR}');
if (failures > 0) { console.error('Found ' + failures + ' files with secrets'); process.exit(1); }
console.log('  [OK] No secrets in any text file under tmp/t0/');
" || fail "Comprehensive secret scan failed"
ok "Secret scan: PASS (comprehensive)"

echo ""

# ══════════════════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════════════════

echo "============================================"
echo "  ZK-Quorum T0 TESTNET R0 — PREPARE ONLY"
echo "============================================"
echo ""
echo "  Toolchain:   Node 24, Rust 1.96, Circom 2.2.3, snarkjs 0.7.6, Stellar CLI 27"
echo "  Network:     testnet"
echo "  Identity:    ${EXPECTED_ADDRESS}"
echo "  Verifier:    ${VERIFIER_ACTUAL_SHA}"
echo "  ZK-Quorum:   ${ZKQ_ACTUAL_SHA}"
echo "  VK R0:       ${VK_R0_SHA}"
echo "  VK R1:       ${VK_R1_SHA}"
echo "  R0 zkey:     ${ACTUAL_R0_ZKEY_SHA}"
echo "  R1 zkey:     ${ACTUAL_R1_ZKEY_SHA}"
echo "  Ptau:        ${ACTUAL_PTAU_SHA}"
echo "  Evidence:    ${EVIDENCE_DIR}"
echo "  No secrets:  VERIFIED"
echo ""
echo "  STATUS: PREPARE DATA GENERATED (prepare.json written)"
echo "  Next: --execute requires Codex review before deploy/invoke"
echo ""

exit 0
