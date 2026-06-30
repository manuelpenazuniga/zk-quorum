#!/usr/bin/env bash
#
# Deterministic verifier-first build for ZK-Quorum Soroban contracts.
# The zk-quorum contract imports groth16-verifier WASM via contractimport!,
# so groth16-verifier MUST be built before zk-quorum.
#
# Usage: ./scripts/build-verifier-first.sh
#
# Output: WASM files in each contract's target directory.
# These WASM files MUST NOT be versioned in Git.
#
# Pinned toolchain: Rust 1.96, target wasm32v1-none.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "==> ZK-Quorum: verifier-first build"
echo "    Project: $PROJECT_DIR"
echo "    Rust: $(rustc --version)"
echo ""

# Step 1: Build crates/zk (shared library)
echo "==> Step 1/3: Building crates/zk"
cargo build \
  --manifest-path "$PROJECT_DIR/crates/zk/Cargo.toml" \
  --target wasm32v1-none \
  --release \
  --no-default-features

# Step 2: Build groth16-verifier WASM
echo "==> Step 2/3: Building groth16-verifier"
cargo build \
  --manifest-path "$PROJECT_DIR/contracts/groth16-verifier/Cargo.toml" \
  --target wasm32v1-none \
  --release

# Verify the WASM exists
VERIFIER_WASM="$PROJECT_DIR/contracts/groth16-verifier/target/wasm32v1-none/release/groth16_verifier.wasm"
if [ ! -f "$VERIFIER_WASM" ]; then
  echo "ERROR: Verifier WASM not found at $VERIFIER_WASM" >&2
  exit 1
fi
echo "    Verifier WASM: $VERIFIER_WASM ($(du -h "$VERIFIER_WASM" | cut -f1))"

# Step 3: Build zk-quorum WASM (imports verifier WASM via contractimport!)
echo "==> Step 3/3: Building zk-quorum"
cargo build \
  --manifest-path "$PROJECT_DIR/contracts/zk-quorum/Cargo.toml" \
  --target wasm32v1-none \
  --release

ZQ_WASM="$PROJECT_DIR/contracts/zk-quorum/target/wasm32v1-none/release/zk_quorum.wasm"
if [ ! -f "$ZQ_WASM" ]; then
  echo "ERROR: zk-quorum WASM not found at $ZQ_WASM" >&2
  exit 1
fi
echo "    zk-quorum WASM: $ZQ_WASM ($(du -h "$ZQ_WASM" | cut -f1))"

echo ""
echo "==> Build complete."
echo "    groth16_verifier.wasm $(sha256sum "$VERIFIER_WASM" | cut -d' ' -f1)"
echo "    zk_quorum.wasm         $(sha256sum "$ZQ_WASM" | cut -d' ' -f1)"
