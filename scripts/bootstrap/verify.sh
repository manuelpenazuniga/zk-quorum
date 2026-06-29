#!/usr/bin/env bash
# scripts/bootstrap/verify.sh — F0 acceptance checks (read-only on source).
#
# Walks the F0 acceptance criteria from plan §12:
#   - upstream SHA exacto
#   - circom --version/arquitectura correctas
#   - cargo test would work if a contract existed (skipped with reason)
#   - toolchain pins present
#
# Does NOT require circom/upstream/snarkjs to be installed — soft-skips any
# tool that is not in the cache, but fails hard on missing pins in the
# source tree (rust-toolchain.toml, .nvmrc, LICENSE, etc.).

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

# Don't fail on first miss — we collect results and report.
fail=0
warn=0
pass() { _zkq_log "  PASS  $*"; }
soft_fail() { _zkq_warn "SOFT FAIL: $*"; warn=$((warn + 1)); }
hard_fail() { _zkq_warn "HARD FAIL: $*"; fail=$((fail + 1)); }

_zkq_log "F0 verify — running acceptance checks"

# ── 1) Source-tree pins (F0.3) ──────────────────────────────────────────
for f in rust-toolchain.toml .nvmrc LICENSE package.json package-lock.json Cargo.toml .gitignore; do
  if [ -f "$ZKQ_ROOT/$f" ]; then
    pass "source pin: $f"
  else
    hard_fail "missing required file: $f"
  fi
done

# rust-toolchain pin
if [ -f "$ZKQ_ROOT/rust-toolchain.toml" ]; then
  ch="$(awk -F'"' '/^channel/ {print $2}' "$ZKQ_ROOT/rust-toolchain.toml" || true)"
  [ "$ch" = "$ZKQ_PIN_RUST_VERSION" ] \
    && pass "rust-toolchain channel = $ch" \
    || hard_fail "rust-toolchain channel '$ch' != $ZKQ_PIN_RUST_VERSION"
fi

# .nvmrc pin
if [ -f "$ZKQ_ROOT/.nvmrc" ]; then
  v="$(tr -d '[:space:]' < "$ZKQ_ROOT/.nvmrc" || true)"
  [ "$v" = "$ZKQ_PIN_NODE_MAJOR" ] \
    && pass ".nvmrc = $v" \
    || hard_fail ".nvmrc '$v' != $ZKQ_PIN_NODE_MAJOR"
fi

# package.json engines
if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$node_major" = "$ZKQ_PIN_NODE_MAJOR" ]; then
    pass "node $node_major.x on PATH matches .nvmrc"
  else
    soft_fail "node $node_major.x on PATH differs from .nvmrc ($ZKQ_PIN_NODE_MAJOR)"
  fi
else
  soft_fail "node not on PATH; .nvmrc specifies $ZKQ_PIN_NODE_MAJOR.x"
fi

# ── 2) Toolchain presence (F0.3) ───────────────────────────────────────
if command -v rustc >/dev/null 2>&1; then
  v="$(rustc --version | awk '{print $2}')"
  [ "$v" = "$ZKQ_PIN_RUST_VERSION" ] \
    && pass "rustc $v" \
    || soft_fail "rustc $v (pinned $ZKQ_PIN_RUST_VERSION); rust-toolchain.toml will switch"
else
  soft_fail "rustc not on PATH; rust-toolchain.toml will install $ZKQ_PIN_RUST_VERSION"
fi
if command -v cargo >/dev/null 2>&1; then
  pass "cargo $(cargo --version | awk '{print $2}')"
else
  soft_fail "cargo not on PATH"
fi
if command -v rustup >/dev/null 2>&1; then
  if rustup target list --installed 2>/dev/null | grep -qx 'wasm32v1-none'; then
    pass "rustup target wasm32v1-none installed"
  else
    soft_fail "rustup target wasm32v1-none not installed (needed by K0)"
  fi
fi

# Stellar CLI is intentionally not installed globally per F0 user constraint.
if command -v stellar >/dev/null 2>&1; then
  soft_fail "stellar CLI on PATH; user constraint says do not install globally"
else
  pass "stellar CLI not installed (per user constraint)"
fi

# ── 3) Bootstrapped artefacts (F0.4 / F0.7 / F0.8) ────────────────────
circom_bin="$ZKQ_CACHE_CIRCOM/circom"
if [ -x "$circom_bin" ]; then
  v="$("$circom_bin" --version 2>&1 | head -n1 || true)"
  case "$v" in
    *"$ZKQ_PIN_CIRCOM_VERSION"*) pass "circom cache: $v" ;;
    *) hard_fail "circom cache version mismatch: $v (pinned $ZKQ_PIN_CIRCOM_VERSION)" ;;
  esac
else
  soft_fail "circom not in cache; run scripts/bootstrap/bootstrap.sh"
fi

upstream_marker="$ZKQ_CACHE_UPSTREAM/soroban-examples/.pinned"
if [ -f "$upstream_marker" ]; then
  pinned="$(cat "$upstream_marker")"
  [ "$pinned" = "$ZKQ_PIN_UPSTREAM_COMMIT" ] \
    && pass "upstream pinned at $pinned" \
    || hard_fail "upstream pin mismatch: $pinned != $ZKQ_PIN_UPSTREAM_COMMIT"
else
  soft_fail "upstream not in cache; run scripts/bootstrap/bootstrap.sh"
fi

snarkjs_marker="$ZKQ_CACHE_SNARKJS/.installed"
if [ -f "$snarkjs_marker" ]; then
  pinned="$(cat "$snarkjs_marker")"
  [ "$pinned" = "$ZKQ_PIN_SNARKJS_VERSION" ] \
    && pass "snarkjs pinned at $pinned" \
    || hard_fail "snarkjs pin mismatch: $pinned != $ZKQ_PIN_SNARKJS_VERSION"
else
  soft_fail "snarkjs not in cache; run scripts/bootstrap/bootstrap.sh"
fi

# ── 4) Sanity of owned manifests ───────────────────────────────────────
# package.json / package-lock.json parse
if command -v node >/dev/null 2>&1; then
  if node -e "JSON.parse(require('fs').readFileSync('$ZKQ_ROOT/package.json','utf8'))" 2>/dev/null; then
    pass "package.json parses as JSON"
  else
    hard_fail "package.json is not valid JSON"
  fi
  if node -e "JSON.parse(require('fs').readFileSync('$ZKQ_ROOT/package-lock.json','utf8'))" 2>/dev/null; then
    pass "package-lock.json parses as JSON"
  else
    hard_fail "package-lock.json is not valid JSON"
  fi
fi
# Cargo.toml parse (use cargo when available, else a shallow sanity check)
if command -v cargo >/dev/null 2>&1; then
  if (cd "$ZKQ_ROOT" && cargo verify-project --quiet 2>/dev/null); then
    pass "Cargo.toml parses (cargo verify-project)"
  else
    # `cargo verify-project` is gone in newer cargo; fall back to `cargo metadata`.
    if (cd "$ZKQ_ROOT" && cargo metadata --no-deps --format-version 1 >/dev/null 2>&1); then
      pass "Cargo.toml parses (cargo metadata)"
    else
      hard_fail "Cargo.toml does not parse with cargo"
    fi
  fi
else
  soft_fail "cargo not on PATH; cannot validate Cargo.toml"
fi

# ── 5) Lockfile consistency ───────────────────────────────────────────
if command -v npm >/dev/null 2>&1; then
  if (cd "$ZKQ_ROOT" && npm ls --workspaces=false --depth=0 >/dev/null 2>&1); then
    pass "npm ls agrees with package.json + package-lock.json"
  else
    # Empty manifest: `npm ls` may complain. Allow if both are empty.
    if [ ! -s "$ZKQ_ROOT/package.json" ] || ! grep -q '"dependencies"' "$ZKQ_ROOT/package.json"; then
      soft_fail "npm ls noisy on empty root manifest; ignoring"
    else
      hard_fail "npm ls disagrees with package.json + package-lock.json"
    fi
  fi
fi

# ── 6) Report ──────────────────────────────────────────────────────────
echo
_zkq_log "F0 verify summary: $fail hard fail(s), $warn soft fail(s)"
if [ "$fail" -gt 0 ]; then
  exit 1
fi
exit 0
