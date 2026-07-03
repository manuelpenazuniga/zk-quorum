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
# Node.js is not required for this build.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Reject external non-empty RUSTFLAGS or CARGO_ENCODED_RUSTFLAGS
if [ -n "${RUSTFLAGS:-}" ] || [ -n "${CARGO_ENCODED_RUSTFLAGS:-}" ]; then
  echo "ERROR: External non-empty RUSTFLAGS or CARGO_ENCODED_RUSTFLAGS are not allowed" >&2
  exit 1
fi

# Calculate effective CARGO_HOME and RUSTUP_HOME
EFFECTIVE_CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
EFFECTIVE_RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"

# Export compilation flags and path remappings
export CARGO_INCREMENTAL=0
export SOURCE_DATE_EPOCH=0
export RUSTFLAGS="--remap-path-prefix $PROJECT_DIR=/workspace --remap-path-prefix $EFFECTIVE_CARGO_HOME=/cargo --remap-path-prefix $EFFECTIVE_RUSTUP_HOME=/rustup"

ZK_CRATE="$PROJECT_DIR/crates/zk"
VERIFIER="$PROJECT_DIR/contracts/groth16-verifier"
ZK_QUORUM="$PROJECT_DIR/contracts/zk-quorum"

echo "==> ZK-Quorum: verifier-first build"
echo "    Project: $PROJECT_DIR"
echo "    Rust:    $(rustc --version)"
echo ""

# ── Prerequisite checks ──

REQUIRED_RUST="1.96"
ACTUAL_RUST="$(rustc --version | sed 's/rustc \([0-9]*\.[0-9]*\).*/\1/')"
if [ "$ACTUAL_RUST" != "$REQUIRED_RUST" ]; then
  echo "ERROR: rustc $REQUIRED_RUST required, found $ACTUAL_RUST" >&2
  exit 1
fi
echo "    Rust $REQUIRED_RUST confirmed."

if ! rustup target list --installed | grep -q 'wasm32v1-none'; then
  echo "ERROR: target wasm32v1-none is not installed" >&2
  exit 1
fi
echo "    Target wasm32v1-none confirmed."
echo ""

# ── Dependency lock pin checks ──
# Verify soroban-sdk, soroban-spec, soroban-spec-rust, soroban-ledger-snapshot
# are all pinned to 25.1.0.

PINNED_VERSION="25.1.0"
LOCK_FILES=(
  "$VERIFIER/Cargo.lock"
  "$ZK_QUORUM/Cargo.lock"
  "$ZK_CRATE/Cargo.lock"
)
PINNED_PKGS="soroban-sdk soroban-spec soroban-spec-rust soroban-ledger-snapshot"

for lock in "${LOCK_FILES[@]}"; do
  if [ ! -f "$lock" ]; then
    echo "ERROR: $lock not found" >&2
    exit 1
  fi
  for pkg in $PINNED_PKGS; do
    ver=$(grep -A1 "name = \"$pkg\"" "$lock" | grep 'version' | sed 's/.*"\(.*\)"/\1/')
    if [ -z "$ver" ]; then
      continue
    fi
    if [ "$ver" != "$PINNED_VERSION" ]; then
      echo "ERROR: $pkg in $(basename "$lock") is $ver, expected $PINNED_VERSION" >&2
      exit 1
    fi
  done
done
echo "    Lock pins confirmed at $PINNED_VERSION."
echo ""

# ── Clean target directories for fresh build ──

echo "==> Cleaning target directories"
rm -rf "$ZK_CRATE/target"
rm -rf "$VERIFIER/target"
rm -rf "$ZK_QUORUM/target"

# ── Step 1: Build and test crates/zk ──

echo ""
echo "==> Step 1/5: crates/zk — build, clippy, test"
cargo build \
  --manifest-path "$ZK_CRATE/Cargo.toml" \
  --target wasm32v1-none \
  --release \
  --no-default-features

cargo clippy \
  --manifest-path "$ZK_CRATE/Cargo.toml" \
  --target wasm32v1-none \
  --release \
  --no-default-features \
  -- -D warnings -A dead_code

echo "    crates/zk tests:"
cargo test \
  --manifest-path "$ZK_CRATE/Cargo.toml" \
  --release

# ── Step 2: Build and test groth16-verifier ──

echo ""
echo "==> Step 2/5: groth16-verifier — build, clippy, test"
cargo build \
  --manifest-path "$VERIFIER/Cargo.toml" \
  --target wasm32v1-none \
  --release

cargo clippy \
  --manifest-path "$VERIFIER/Cargo.toml" \
  --target wasm32v1-none \
  --release \
  -- -D warnings

echo "    groth16-verifier tests:"
cargo test \
  --manifest-path "$VERIFIER/Cargo.toml" \
  --release

# Verify the WASM exists
VERIFIER_WASM="$VERIFIER/target/wasm32v1-none/release/groth16_verifier.wasm"
if [ ! -f "$VERIFIER_WASM" ]; then
  echo "ERROR: Verifier WASM not found at $VERIFIER_WASM" >&2
  exit 1
fi
echo "    Verifier WASM: $VERIFIER_WASM ($(du -h "$VERIFIER_WASM" | cut -f1))"

# ── Step 3: Build and test zk-quorum (imports verifier WASM via contractimport!) ──

echo ""
echo "==> Step 3/5: zk-quorum — build, clippy, test"
cargo build \
  --manifest-path "$ZK_QUORUM/Cargo.toml" \
  --target wasm32v1-none \
  --release

cargo clippy \
  --manifest-path "$ZK_QUORUM/Cargo.toml" \
  --target wasm32v1-none \
  --release \
  -- -D warnings

echo "    zk-quorum tests:"
cargo test \
  --manifest-path "$ZK_QUORUM/Cargo.toml" \
  --release

ZQ_WASM="$ZK_QUORUM/target/wasm32v1-none/release/zk_quorum.wasm"
if [ ! -f "$ZQ_WASM" ]; then
  echo "ERROR: zk-quorum WASM not found at $ZQ_WASM" >&2
  exit 1
fi
echo "    zk-quorum WASM: $ZQ_WASM ($(du -h "$ZQ_WASM" | cut -f1))"

# ── Step 4: WASM stale check (ensure imports exist) ──

echo ""
echo "==> Step 4/5: WASM validity checks"
for wasm in "$VERIFIER_WASM" "$ZQ_WASM"; do
  if ! head -c4 "$wasm" | grep -q $'\x00\x61\x73\x6d'; then
    echo "ERROR: $wasm does not have wasm magic bytes" >&2
    exit 1
  fi
  echo "    $(basename "$wasm"): valid wasm magic"
done

# ── Step 5: Confirm zero ignored/skipped tests ──

echo ""
echo "==> Step 5/5: Zero-ignored test confirmation"
for manifest in "$ZK_CRATE/Cargo.toml" "$VERIFIER/Cargo.toml" "$ZK_QUORUM/Cargo.toml"; do
  dir="$(dirname "$manifest")"
  ignored=$(cargo test --manifest-path "$manifest" --release -- --list --ignored)
  if printf '%s\n' "$ignored" | grep -q ': test$'; then
    echo "ERROR: Ignored tests found in $(basename "$dir")" >&2
    printf '%s\n' "$ignored" | grep ': test$' >&2
    exit 1
  else
    echo "    $(basename "$dir"): 0 ignored"
  fi
done

# ── SHA-256 hashes (portable: shasum on macOS, sha256sum elsewhere) ──

echo ""
echo "==> Build complete."
if command -v sha256sum &>/dev/null; then
  HASHER="sha256sum"
elif command -v shasum &>/dev/null; then
  HASHER="shasum -a 256"
else
  echo "WARNING: no sha256sum or shasum found; skipping hash output" >&2
  HASHER=""
fi

if [ -n "$HASHER" ]; then
  echo "    groth16_verifier.wasm  $($HASHER "$VERIFIER_WASM" | awk '{print $1}')"
  echo "    zk_quorum.wasm          $($HASHER "$ZQ_WASM" | awk '{print $1}')"
fi

echo ""
echo "    All gates: PASS"
