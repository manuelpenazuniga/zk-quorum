#!/usr/bin/env bash
# scripts/bootstrap/lib.sh — shared helpers for F0 bootstrap.
# Sourced by scripts/bootstrap/bootstrap.sh and scripts/bootstrap/verify.sh.
#
# Pin and platform detection is centralised here so neither the bootstrap
# nor the verifier can drift onto "latest" tags or the wrong circom binary
# (see plan §3, §10, §12/F0.4, §12/F0.7, §12/F0.8).

# ── Pinned versions (F0.3) ────────────────────────────────────────────────
# Updating any of these requires a decision-record entry per plan §3.1.
: "${ZKQ_PIN_UPSTREAM_COMMIT:=7b168174ae1268dab91a0190d80a94ab7ff41b59}"
: "${ZKQ_PIN_UPSTREAM_REPO:=https://github.com/stellar/soroban-examples.git}"
: "${ZKQ_PIN_SNARKJS_VERSION:=0.7.6}"
: "${ZKQ_PIN_CIRCOM_VERSION:=2.2.3}"
: "${ZKQ_PIN_RUST_VERSION:=1.96.0}"
: "${ZKQ_PIN_NODE_MAJOR:=24}"

# ── Paths (all relative to repo root) ────────────────────────────────────
# Scripts may be invoked from anywhere; resolve the repo root once.
_zkq_repo_root() {
  local src="${BASH_SOURCE[0]}"
  # lib.sh lives at scripts/bootstrap/lib.sh -> repo root is ../../..
  local dir
  dir="$(cd -- "$(dirname -- "$src")" && pwd)"
  (cd "$dir/../.." && pwd)
}
ZKQ_ROOT="$(_zkq_repo_root)"

# Per-host cache for downloaded tools. The repo itself never carries them.
ZKQ_CACHE="${ZKQ_ROOT}/.bootstrap"
ZKQ_CACHE_CIRCOM="${ZKQ_CACHE}/circom/v${ZKQ_PIN_CIRCOM_VERSION}"
ZKQ_CACHE_UPSTREAM="${ZKQ_CACHE}/upstream"
ZKQ_CACHE_SNARKJS="${ZKQ_CACHE}/snarkjs"

# ── Logging ─────────────────────────────────────────────────────────────
_zkq_log()  { printf '[zkq] %s\n' "$*"; }
_zkq_warn() { printf '[zkq] WARN: %s\n' "$*" >&2; }
_zkq_die()  { printf '[zkq] ERROR: %s\n' "$*" >&2; exit 1; }

# ── Platform detection (F0.7) ─────────────────────────────────────────────
# Output: a single canonical platform token.
_zkq_normalise_arch() {
  case "$1" in
    arm64|aarch64) printf 'arm64' ;;
    x86_64|amd64)  printf 'x64'  ;;
    *) _zkq_die "unsupported architecture: $1" ;;
  esac
}
_zkq_normalise_os() {
  case "$1" in
    Darwin) printf 'darwin' ;;
    Linux)  printf 'linux'  ;;
    *) _zkq_die "unsupported OS: $1" ;;
  esac
}
_zkq_detect_platform() {
  local s m
  command -v uname >/dev/null 2>&1 || _zkq_die "uname not found; this bootstrap targets POSIX systems only"
  s="$(uname -s)"
  m="$(uname -m)"
  printf '%s-%s' "$(_zkq_normalise_os "$s")" "$(_zkq_normalise_arch "$m")"
}

# ── Circom asset mapping (F0.7) ──────────────────────────────────────────
# iden3/circom v2.2.3 ships prebuilt binaries for linux-amd64 and
# macos-amd64. Apple Silicon builds the pinned source by default.
_zkq_circom_asset() {
  case "$1" in
    darwin-x64) printf 'circom-macos-amd64' ;;
    linux-x64)  printf 'circom-linux-amd64' ;;
    *) _zkq_die "no circom prebuilt for platform: $1" ;;
  esac
}
_zkq_circom_url() {
  local asset
  asset="$(_zkq_circom_asset "$1")"
  printf 'https://github.com/iden3/circom/releases/download/v%s/%s' \
    "$ZKQ_PIN_CIRCOM_VERSION" "$asset"
}
# ── Tool checks ──────────────────────────────────────────────────────────
zkq_require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 \
    || _zkq_die "required command not found on PATH: $cmd"
}

# ── Checksum helpers ─────────────────────────────────────────────────────
# sha256_file <path> -> hex digest
zkq_sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    _zkq_die "neither sha256sum nor shasum available"
  fi
}
