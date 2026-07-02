#!/usr/bin/env bash
# ZK-Quorum C0 gate — clean-build reproducibility orchestrator.
# Order: clean → compile → fixtures → witness → fetch assets → gate → manifests → Rust
#
# Does NOT use git cleanliness check. Compares only owned generated paths
# or explicit hashes against committed manifests.
#
# Assets are fetched from an immutable source; never regenerated here.
# Set ZKQ_SETUP_BASE_URL to override the default release URL, or let the
# default point at the canonical GitHub release.
#
# Usage: bash scripts/run-all-tests.sh
# Exit code: non-zero on first failure.

set -euo pipefail
cd "$(dirname "$0")/.."

readonly RELEASE_SOURCE="$(pwd)/circuits/.release-assets/c0-setup-v1"
if [ -z "${ZKQ_SETUP_BASE_URL:-}" ] && [ -d "${RELEASE_SOURCE}" ]; then
    export ZKQ_SETUP_BASE_URL="file://${RELEASE_SOURCE}"
fi

echo "============================================"
echo "ZK-Quorum C0 Clean-Build Reproducibility"
echo "============================================"
echo ""

# ── Toolchain sanity ──────────────────────────────────────────────────────
if ! node --version 2>/dev/null | grep -q '^v'; then
    echo "ERROR: Node not found"
    exit 1
fi
echo "[OK] Node $(node --version)"

# ── Circom binary resolver (fail-closed) ───────────────────────────────────
resolve_circom() {
    local candidate="${ZKQ_CIRCOM_BIN:-}"
    if [ -n "${candidate}" ]; then
        if [ ! -x "${candidate}" ]; then
            echo "ERROR: ZKQ_CIRCOM_BIN=${candidate} is not executable" >&2
            exit 1
        fi
        echo "${candidate}"
        return
    fi
    # Canonical path from foundation bootstrap
    candidate=".bootstrap/circom/v2.2.3/circom"
    if [ -x "${candidate}" ]; then
        echo "${candidate}"
        return
    fi
    # Legacy compatibility path
    candidate=".bootstrap/bin/circom"
    if [ -x "${candidate}" ]; then
        echo "${candidate}"
        return
    fi
    echo "ERROR: circom 2.2.3 not found. Set ZKQ_CIRCOM_BIN or run bootstrap." >&2
    exit 1
}

CIRCOM=$(resolve_circom)
CIRCOM_VERSION=$("${CIRCOM}" --version 2>&1 | awk 'NR == 1 { print $3 }')
if [ "${CIRCOM_VERSION}" != "2.2.3" ]; then
    echo "ERROR: Circom 2.2.3 required, found ${CIRCOM_VERSION:-unknown}"
    exit 1
fi
echo "[OK] circom ${CIRCOM_VERSION} (${CIRCOM})"

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

if ! command -v cargo &>/dev/null; then
    echo "ERROR: cargo not found"
    exit 1
fi
RUST_VERSION=$(rustc --version 2>/dev/null | awk '{print $2}')
echo "[OK] Rust ${RUST_VERSION:-unknown}"
echo ""

# ── Clean build artifacts ────────────────────────────────────────────────────
echo "=== Cleaning build artifacts ==="
rm -rf circuits/build tmp
echo "[OK] circuits/build and tmp removed (source assets preserved)"
echo ""

# ── Step 1: Compile circuits ─────────────────────────────────────────────────
echo "=== Step 1: Compile circuits ==="
mkdir -p circuits/build/public-vote circuits/build/commit-vote

echo "  Compiling R0..."
${CIRCOM} --prime bls12381 --r1cs --sym --wasm --output circuits/build/public-vote \
    circuits/public-vote/main.circom

echo "  Compiling R1..."
${CIRCOM} --prime bls12381 --r1cs --sym --wasm --output circuits/build/commit-vote \
    circuits/commit-vote/main.circom

echo "[OK] Circuits compiled"
echo ""

# ── Step 2: Generate test fixtures ───────────────────────────────────────────
echo "=== Step 2: Generate test fixtures ==="
node scripts/build-test-fixtures.js
echo ""

# ── Step 3: Generate scope fixtures ──────────────────────────────────────────
echo "=== Step 3: Generate scope fixtures ==="
node scripts/build-scope-fixtures.js
echo ""

# ── Step 4: Run witness suite (23+ tests) ────────────────────────────────────
echo "=== Step 4: Witness suite ==="
node scripts/test-witness.js
echo ""

# ── Step 5: Independent Python BigInt engine ─────────────────────────────────
echo "=== Step 5: Independent Python BigInt engine ==="
python3 scripts/verify-poseidon-bigint.py
echo ""

# ── Step 6: Fetch & verify setup assets (never regenerate) ────────────────────
echo "=== Step 6: Fetch & verify setup assets ==="
node scripts/fetch-setup-assets.js
echo ""

# ── Step 7: Gate C0 — proof verification, mutations, Fr round-trip ──────────
echo "=== Step 7: Gate C0 proof verification & mutation harness ==="
node scripts/gate-c0.js
echo ""

# ── Step 8: Verify manifest hashes match regenerated artifacts ──────────────
echo "=== Step 8: Verify manifests/hashes ==="
node scripts/verify-manifests.js
echo ""

# ── Step 9: Rust tests, clippy, wasm32v1-none ───────────────────────────────
echo "=== Step 9: Rust cargo test ==="
cargo test --manifest-path crates/credential/Cargo.toml
echo ""

echo "=== Step 10: Rust cargo clippy ==="
cargo clippy --manifest-path crates/credential/Cargo.toml -- -D warnings
echo ""

echo "=== Step 11: Rust wasm32v1-none check ==="
cargo check --manifest-path crates/credential/Cargo.toml --target wasm32v1-none --no-default-features
echo ""

echo ""
echo "============================================"
echo "All C0 gate checks passed."
echo "============================================"
