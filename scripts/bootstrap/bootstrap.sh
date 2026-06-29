#!/usr/bin/env bash
# scripts/bootstrap/bootstrap.sh — F0.4/F0.7/F0.8 reproducible bootstrap.
#
# Idempotent. Re-running is a no-op when every artefact is already at the
# pinned version. Never reaches for "latest" or --depth 1 with a moving tip.
#
# What it does:
#   1. Detects the host platform and refuses anything outside the
#      supported matrix (darwin-arm64, darwin-x64, linux-x64).
#   2. Installs the pinned circom binary into scripts/bootstrap/.bootstrap/.
#   3. Clones the pinned upstream commit of stellar/soroban-examples
#      into .bootstrap/upstream (NOT into spike/, which keeps the existing
#      spike workspace untouched for the upstream-derived reference).
#   4. Installs snarkjs@<exact> into a private node_modules under
#      scripts/bootstrap/.bootstrap/snarkjs/.
#
# It does NOT:
#   - install Stellar CLI globally (plan §1.3 + user constraint);
#   - touch spike/, docs/, contracts/, crates/, circuits/, apps/,
#     services/, tools/;
#   - fetch any "latest" tag;
#   - run cargo test / cargo build (that's the verifier's job).
#
# Usage:
#   ./scripts/bootstrap/bootstrap.sh            # normal idempotent run
#   BUILD_CIRCOM=1 ./scripts/bootstrap/bootstrap.sh
#                                               # force source build
#   FORCE=1   ./scripts/bootstrap/bootstrap.sh # re-do every step
#   OFFLINE=1 ./scripts/bootstrap/bootstrap.sh # fail loudly if a download is needed

set -euo pipefail

# Resolve script directory so we can source lib.sh regardless of cwd.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

_zkq_log "F0 bootstrap — pinned"
_zkq_log "  upstream commit : $ZKQ_PIN_UPSTREAM_COMMIT"
_zkq_log "  snarkjs version : $ZKQ_PIN_SNARKJS_VERSION (exact)"
_zkq_log "  circom version  : v$ZKQ_PIN_CIRCOM_VERSION"
_zkq_log "  rust channel    : $ZKQ_PIN_RUST_VERSION"
_zkq_log "  node major      : $ZKQ_PIN_NODE_MAJOR"

PLATFORM="$(_zkq_detect_platform)"
_zkq_log "  host platform   : $PLATFORM"

# Sanity: ensure we're inside the repo before writing the cache.
[ -d "$ZKQ_ROOT/.git" ] || _zkq_die "no .git at $ZKQ_ROOT; run from inside the repo"
[ -f "$ZKQ_ROOT/rust-toolchain.toml" ] \
  || _zkq_die "rust-toolchain.toml missing at repo root; F0.3 not applied"
[ -f "$ZKQ_ROOT/.nvmrc" ] \
  || _zkq_die ".nvmrc missing at repo root; F0.3 not applied"

mkdir -p "$ZKQ_CACHE_CIRCOM" "$ZKQ_CACHE_UPSTREAM" "$ZKQ_CACHE_SNARKJS"

# ── Helpers local to this script ─────────────────────────────────────────
_offline() {
  [ "${OFFLINE:-0}" = "1" ]
}
# Returns 0 (true) when the step should be skipped: marker exists AND
# FORCE != 1. When FORCE=1, every step re-runs.
_step_done() {
  local marker="$1"
  [ -f "$marker" ] && [ "${FORCE:-0}" != "1" ]
}

# ── 1) Circom (F0.7) ─────────────────────────────────────────────────────
install_circom() {
  local marker="$ZKQ_CACHE_CIRCOM/.installed"
  if _step_done "$marker"; then
    _zkq_log "circom: already pinned at $(cat "$marker")"
    return
  fi

  local bin="$ZKQ_CACHE_CIRCOM/circom"
  if [ "${BUILD_CIRCOM:-0}" = "1" ] || [ "$PLATFORM" = "darwin-arm64" ]; then
    _zkq_log "circom: building pinned source for $PLATFORM (this can take minutes)"
    if ! command -v cargo >/dev/null 2>&1; then
      _zkq_die "cargo required for BUILD_CIRCOM=1; install rust $ZKQ_PIN_RUST_VERSION first"
    fi
    _build_circom_from_source "$bin"
  else
    local url
    url="$(_zkq_circom_url "$PLATFORM")"
    _zkq_log "circom: downloading $url"
    _offline && _zkq_die "OFFLINE=1 but circom not yet cached"
    curl --fail --location --silent --show-error --output "$bin.tmp" "$url"
    chmod +x "$bin.tmp"
    mv "$bin.tmp" "$bin"
  fi

  local version
  version="$("$bin" --version 2>&1 | head -n1 || true)"
  case "$version" in
    *"$ZKQ_PIN_CIRCOM_VERSION"*) ;;
    *) _zkq_die "circom --version did not report $ZKQ_PIN_CIRCOM_VERSION: $version" ;;
  esac
  printf '%s\n%s\n' "$version" "$(zkq_sha256_file "$bin")" > "$marker"
  _zkq_log "circom: ready — $version"
}

_build_circom_from_source() {
  local bin="$1"
  local src_dir="$ZKQ_CACHE_CIRCOM/_src"
  local tarball="$ZKQ_CACHE_CIRCOM/circom.tar.gz"

  if [ ! -d "$src_dir" ]; then
    _offline && _zkq_die "OFFLINE=1 and circom source not cached at $src_dir"
    _zkq_log "circom: fetching source tarball v$ZKQ_PIN_CIRCOM_VERSION"
    local url="https://github.com/iden3/circom/archive/refs/tags/v${ZKQ_PIN_CIRCOM_VERSION}.tar.gz"
    curl --fail --location --silent --show-error --output "$tarball" "$url"
    mkdir -p "$src_dir"
    tar -xzf "$tarball" -C "$src_dir" --strip-components=1
  fi

  (
    cd "$src_dir"
    cargo build --release --locked
  )
  cp "$src_dir/target/release/circom" "$bin"
  chmod +x "$bin"
}

# ── 2) Upstream (F0.8) ───────────────────────────────────────────────────
install_upstream() {
  local dir="$ZKQ_CACHE_UPSTREAM/soroban-examples"
  local marker="$dir/.pinned"
  if _step_done "$marker"; then
    _zkq_log "upstream: already pinned at $ZKQ_PIN_UPSTREAM_COMMIT"
    return
  fi

  if [ -d "$dir/.git" ]; then
    _zkq_log "upstream: existing clone at $dir; resetting to pinned commit"
    (
      cd "$dir"
      git remote set-url origin "$ZKQ_PIN_UPSTREAM_REPO"
      git fetch --no-tags origin "$ZKQ_PIN_UPSTREAM_COMMIT"
      git checkout --quiet --detach FETCH_HEAD
    )
  else
    _offline && _zkq_die "OFFLINE=1 and upstream not cached at $dir"
    _zkq_log "upstream: cloning pinned commit $ZKQ_PIN_UPSTREAM_COMMIT"
    # Init empty repo, then fetch the exact commit (no --depth 1 with mobile HEAD).
    mkdir -p "$dir"
    (
      cd "$dir"
      git init --quiet --initial-branch=main
      git remote add origin "$ZKQ_PIN_UPSTREAM_REPO"
      git fetch --no-tags origin "$ZKQ_PIN_UPSTREAM_COMMIT"
      git checkout --quiet --detach FETCH_HEAD
    )
  fi

  local actual
  actual="$(cd "$dir" && git rev-parse HEAD)"
  if [ "$actual" != "$ZKQ_PIN_UPSTREAM_COMMIT" ]; then
    _zkq_die "upstream HEAD is $actual, expected $ZKQ_PIN_UPSTREAM_COMMIT"
  fi

  printf '%s\n' "$actual" > "$marker"
  _zkq_log "upstream: pinned at $actual"
}

# ── 3) snarkjs (F0.3) ────────────────────────────────────────────────────
install_snarkjs() {
  local marker="$ZKQ_CACHE_SNARKJS/.installed"
  if _step_done "$marker"; then
    _zkq_log "snarkjs: already pinned at $(cat "$marker")"
    return
  fi

  local pkg_json="$ZKQ_CACHE_SNARKJS/package.json"
  local node_modules="$ZKQ_CACHE_SNARKJS/node_modules"
  if [ -d "$node_modules/snarkjs" ] && [ "${FORCE:-0}" != "1" ]; then
    local have
    have="$(cd "$ZKQ_CACHE_SNARKJS" && node -p "require('./node_modules/snarkjs/package.json').version" 2>/dev/null || true)"
    if [ "$have" = "$ZKQ_PIN_SNARKJS_VERSION" ]; then
      _zkq_log "snarkjs: $have already installed (marking pinned)"
      printf '%s\n' "$have" > "$marker"
      return
    fi
    _zkq_log "snarkjs: cached version '$have' != $ZKQ_PIN_SNARKJS_VERSION; reinstalling"
  fi

  _offline && _zkq_die "OFFLINE=1 and snarkjs not cached"

  # Honour engines (node major from .nvmrc) only as a soft warning.
  if command -v node >/dev/null 2>&1; then
    local node_major
    node_major="$(node -p 'process.versions.node.split(".")[0]')"
    if [ "$node_major" != "$ZKQ_PIN_NODE_MAJOR" ]; then
      _zkq_warn "node major is $node_major, expected $ZKQ_PIN_NODE_MAJOR (see .nvmrc)"
    fi
  else
    _zkq_warn "node not on PATH; install Node ${ZKQ_PIN_NODE_MAJOR}.x (see .nvmrc)"
  fi

  # Write a tiny package.json so npm ci can reproduce this install.
  cat > "$pkg_json" <<JSON
{
  "name": "zk-quorum-bootstrap-snarkjs",
  "version": "0.0.0",
  "private": true,
  "description": "F0 cache for snarkjs at the exact pinned version",
  "license": "MIT",
  "dependencies": {
    "snarkjs": "${ZKQ_PIN_SNARKJS_VERSION}"
  }
}
JSON

  (
    cd "$ZKQ_CACHE_SNARKJS"
    if [ -f package-lock.json ]; then
      npm ci --no-audit --no-fund --silent
    else
      npm install --no-audit --no-fund --silent \
        --save-exact "snarkjs@${ZKQ_PIN_SNARKJS_VERSION}"
    fi
  )

  local got
  got="$(node -p "require('$node_modules/snarkjs/package.json').version")"
  [ "$got" = "$ZKQ_PIN_SNARKJS_VERSION" ] \
    || _zkq_die "snarkjs installed as $got, expected $ZKQ_PIN_SNARKJS_VERSION"

  printf '%s\n' "$got" > "$marker"
  _zkq_log "snarkjs: ready — $got"
}

# ── Run ──────────────────────────────────────────────────────────────────
install_circom
install_upstream
install_snarkjs

_zkq_log "F0 bootstrap complete."
_zkq_log "  circom   : $("$ZKQ_CACHE_CIRCOM/circom" --version 2>&1 | head -n1)"
_zkq_log "  upstream : $(cat "$ZKQ_CACHE_UPSTREAM/soroban-examples/.pinned")"
_zkq_log "  snarkjs  : $(cat "$ZKQ_CACHE_SNARKJS/.installed")"
_zkq_log "  cache    : $ZKQ_CACHE"
_zkq_log "Next: run scripts/bootstrap/verify.sh to confirm F0 acceptance."
