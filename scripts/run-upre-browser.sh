#!/usr/bin/env bash
# ZK-Quorum U-Pre — Browser evidence collector for Chromium.
#
# --prepare-only: stage, build, and verify without browser execution.
#   Exits 0 if all checks pass.
# Default mode: validates fail-closed that tmp/u-pre/ contains required
#   JSON evidence files with exact schema. Exits 1 if any file missing
#   or invalid.
#
# Usage: bash scripts/run-upre-browser.sh [--prepare-only]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WEB_DIR="${PROJECT_DIR}/apps/web"
EVIDENCE_DIR="${PROJECT_DIR}/tmp/u-pre"

PREPARE_ONLY=false
for arg in "$@"; do
  if [ "$arg" = "--prepare-only" ]; then PREPARE_ONLY=true; fi
done

ok()   { printf '  [OK] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*" >&2; exit 1; }
info() { printf '==> %s\n' "$*"; }

info "U-Pre Browser Evidence Gate"
echo ""

# ── 1. Check assets are staged ──
PUBLIC_ASSETS="${WEB_DIR}/public/upre-assets"
if [ ! -f "${PUBLIC_ASSETS}/manifest.json" ]; then
  fail "Assets not staged. Run: node scripts/stage-assets-to-public.js"
fi
MANIFEST_SCHEMA=$(node -p "require('${PUBLIC_ASSETS}/manifest.json').schema")
if [ "${MANIFEST_SCHEMA}" != "UPRE_BROWSER_MANIFEST_V1" ]; then
  fail "Invalid manifest schema: ${MANIFEST_SCHEMA}"
fi
for asset in main.wasm r0_final.zkey r0_vk.json; do
  if [ ! -f "${PUBLIC_ASSETS}/${asset}" ]; then
    fail "Missing staged asset: ${asset}"
  fi
done
ok "Assets staged and manifest valid"

# ── 2. Verify dist build ──
if [ ! -d "${WEB_DIR}/dist" ]; then
  fail "dist/ not found — run npm run build first"
fi
TS_WORKERS=$(find "${WEB_DIR}/dist" -name "proverWorker*.ts" 2>/dev/null || true)
if [ -n "${TS_WORKERS}" ]; then
  fail "Build contains uncompiled .ts worker files: ${TS_WORKERS}"
fi
JS_WORKERS=$(find "${WEB_DIR}/dist" -name "proverWorker*.js" 2>/dev/null || true)
if [ -z "${JS_WORKERS}" ]; then
  fail "No compiled proverWorker JS bundle in dist/"
fi
ok "Build verified (compiled JS worker present, no .ts artifacts)"

# ── 3. --prepare-only mode ──
if [ "${PREPARE_ONLY}" = "true" ]; then
  echo ""
  ok "Prepare-only: stage + build verified. Browser execution skipped."
  exit 0
fi

# ── 4. Validate evidence files (strict fail-closed) ──
info "Validating evidence in ${EVIDENCE_DIR}"
echo ""

REQUIRED_EVIDENCE_FILES=(
  "manifest.json"
  "browser-result.json"
  "network.json"
  "console.json"
  "screenshot.png"
)

for f in "${REQUIRED_EVIDENCE_FILES[@]}"; do
  if [ ! -f "${EVIDENCE_DIR}/${f}" ]; then
    fail "Missing evidence file: ${f}"
  fi
done
ok "All required evidence files present"

# Validate browser-result.json structure (strict schema)
BR="${EVIDENCE_DIR}/browser-result.json"
if ! node -e "
const d = require('${BR}');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
assert(d.gate === 'U-PRE-BROWSER-R0', 'gate must be U-PRE-BROWSER-R0');
assert(Array.isArray(d.tests), 'tests must be array');
assert(d.tests.length >= 3, 'must have at least 3 test results');
assert(typeof d.timestamp === 'string', 'timestamp must be string');
assert(typeof d.userAgent === 'string', 'userAgent must be string');
assert(typeof d.memoryAvailable === 'string', 'memoryAvailable must be string');
for (const t of d.tests) {
  assert(typeof t.test === 'string', 'test name must be string');
  assert(['pass','fail','pending'].includes(t.stage), 'stage must be pass/fail/pending');
  assert(typeof t.durationMs === 'number', 'durationMs must be number');
  assert(typeof t.message === 'string', 'message must be string');
}
// Verify expected test names
const names = d.tests.map(t => t.test);
assert(names.includes('valid-r0'), 'must include valid-r0 test');
assert(names.includes('invalid-witness'), 'must include invalid-witness test');
const cancelTest = d.tests.find(t => t.test.startsWith('cancel'));
assert(cancelTest, 'must include cancel test');
assert(cancelTest.stage === 'pass', 'cancel test must pass');
// Valid R0 must pass
const validTest = d.tests.find(t => t.test === 'valid-r0');
assert(validTest.stage === 'pass', 'valid-r0 must pass');
assert(validTest.proofHash && validTest.proofHash.startsWith('0x'), 'valid-r0 must have proofHash');
assert(validTest.publicSignalsHash && validTest.publicSignalsHash.startsWith('0x'), 'valid-r0 must have publicSignalsHash');
assert(validTest.signalCount === 6, 'valid-r0 must have 6 signals');
assert(validTest.proofByteLen === 384, 'valid-r0 proof must be 384 bytes');
assert(validTest.publicByteLen === 196, 'valid-r0 public must be 196 bytes');
console.log('PASS');
" 2>&1; then
  fail "browser-result.json validation failed"
fi
ok "browser-result.json schema and content valid"

# Validate network.json (no POST/PUT/PATCH/DELETE, only GET to localhost)
NET="${EVIDENCE_DIR}/network.json"
if [ -f "${NET}" ]; then
  if ! node -e "
const d = require('${NET}');
const forbidden = d.filter(r => r.method && ['POST','PUT','PATCH','DELETE'].includes(r.method.toUpperCase()));
if (forbidden.length > 0) {
  console.error('Forbidden requests:', JSON.stringify(forbidden.map(r => r.method + ' ' + r.url)));
  process.exit(1);
}
// All requests must be GET to localhost:8788
const bad = d.filter(r => !r.url || (!r.url.includes('localhost:8788') && !r.url.startsWith('/')));
if (bad.length > 0) {
  console.error('Non-localhost requests:', JSON.stringify(bad.map(r => r.url)));
  process.exit(1);
}
console.log('PASS');
" 2>&1; then
    fail "network.json validation failed"
  fi
  ok "network.json: no forbidden methods, all localhost"
fi

echo ""
ok "All evidence validation passed"
exit 0
