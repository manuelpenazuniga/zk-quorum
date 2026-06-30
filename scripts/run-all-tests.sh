#!/usr/bin/env bash
# ZK-Quorum C0 gate — clean-build reproducibility orchestrator.
# After the pinned bootstrap and `npm ci` prerequisites are installed, this
# deletes generated artifacts, regenerates them from zero, and runs the suite.
#
# Usage: bash scripts/run-all-tests.sh
# Exit code: non-zero on first failure.

set -euo pipefail
cd "$(dirname "$0")/.."

echo "============================================"
echo "ZK-Quorum C0 Clean-Build Reproducibility"
echo "============================================"
echo ""

# ── Node 24 sanity ──────────────────────────────────────────────────────────
REQUIRED_NODE_MAJOR=24
NODE_VERSION=$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1)
if [ "$NODE_VERSION" != "$REQUIRED_NODE_MAJOR" ]; then
    echo "ERROR: Node $REQUIRED_NODE_MAJOR required, found $(node --version 2>/dev/null || echo 'none')"
    exit 1
fi
echo "[OK] Node $(node --version)"

# ── Verify required binaries ─────────────────────────────────────────────────
if [ ! -x ".bootstrap/bin/circom" ]; then
    echo "ERROR: .bootstrap/bin/circom not found"
    exit 1
fi
CIRCOM_VERSION=$(.bootstrap/bin/circom --version 2>&1 | awk 'NR == 1 { print $3 }')
if [ "$CIRCOM_VERSION" != "2.2.3" ]; then
    echo "ERROR: Circom 2.2.3 required, found ${CIRCOM_VERSION:-unknown}"
    exit 1
fi
echo "[OK] circom $CIRCOM_VERSION"

if [ ! -x "node_modules/.bin/snarkjs" ]; then
    echo "ERROR: snarkjs not installed (run npm install)"
    exit 1
fi
SNARKJS_VERSION=$(node -p "require('./node_modules/snarkjs/package.json').version")
if [ "$SNARKJS_VERSION" != "0.7.6" ]; then
    echo "ERROR: snarkjs 0.7.6 required, found ${SNARKJS_VERSION:-unknown}"
    exit 1
fi
echo "[OK] snarkjs $SNARKJS_VERSION"

if ! command -v python3 &>/dev/null; then
    echo "ERROR: python3 not found"
    exit 1
fi
echo "[OK] python3 $(python3 --version)"

# ── Clean build artifacts ────────────────────────────────────────────────────
echo ""
echo "=== Cleaning build artifacts ==="
rm -rf circuits/build tmp
echo "[OK] circuits/build and tmp removed"

# ── Step 1: Compile circuits and run witness suite ───────────────────────────
echo ""
echo "=== Step 1: Witness suite (compiles R0/R1 from zero) ==="
node scripts/test-witness.js

# ── Step 2: Build test fixtures (auto-compiles test vectors circuit) ─────────
echo ""
echo "=== Step 2: Build test fixtures ==="
node scripts/build-test-fixtures.js

# ── Step 3: Build scope fixtures ─────────────────────────────────────────────
echo ""
echo "=== Step 3: Build scope fixtures ==="
node scripts/build-scope-fixtures.js

# ── Step 4: Independent BigInt Poseidon verification ─────────────────────────
echo ""
echo "=== Step 4: Independent Python BigInt engine ==="
python3 scripts/verify-poseidon-bigint.py

# ── Step 5: Rust tests, clippy, wasm32v1-none ────────────────────────────────
echo ""
echo "=== Step 5: Rust cargo test ==="
cargo test --manifest-path crates/credential/Cargo.toml

echo ""
echo "=== Step 6: Rust cargo clippy ==="
cargo clippy --manifest-path crates/credential/Cargo.toml -- -D warnings

echo ""
echo "=== Step 7: Rust wasm32v1-none check ==="
cargo check --manifest-path crates/credential/Cargo.toml --target wasm32v1-none --no-default-features

# ── Clean up tmp again ───────────────────────────────────────────────────────
rm -rf tmp

echo ""
echo "============================================"
echo "All C0 gate checks passed."
echo "============================================"
