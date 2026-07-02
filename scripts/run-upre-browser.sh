#!/usr/bin/env bash
# ZK-Quorum U-Pre — Browser evidence gate for Chromium.
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
ok "Build verified (compiled JS worker, no .ts artifacts)"

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

# ── Validate browser-result.json (strict schema) ──
BR="${EVIDENCE_DIR}/browser-result.json"
node -e "
const d = require('${BR}');

// Exact top-level keys
const allowedKeys = new Set(['gate','tests','timestamp','userAgent','peakMemory','heapLimitMB']);
const actualKeys = Object.keys(d);
for (const k of actualKeys) {
  if (!allowedKeys.has(k)) throw new Error('unknown top-level key: ' + k);
}
for (const k of allowedKeys) {
  if (!(k in d)) throw new Error('missing top-level key: ' + k);
}

if (d.gate !== 'U-PRE-BROWSER-R0') throw new Error('gate must be U-PRE-BROWSER-R0');
if (!Array.isArray(d.tests) || d.tests.length < 4) throw new Error('tests must be array with >=4 entries');
if (typeof d.timestamp !== 'string') throw new Error('timestamp must be string');
if (typeof d.userAgent !== 'string') throw new Error('userAgent must be string');
if (d.peakMemory !== 'unsupported') throw new Error('peakMemory must be \"unsupported\"');
if (d.heapLimitMB !== null && typeof d.heapLimitMB !== 'number') throw new Error('heapLimitMB must be number or null');

// Exact test keys
const testKeys = new Set(['test','stage','durationMs','message','proofHash','publicSignalsHash','signalCount','proofByteLen','publicByteLen','peakMemory','heapLimitMB']);
const requiredTests = ['valid-r0','invalid-witness','cancel-r0','recovery-r0'];
for (const t of d.tests) {
  for (const k of Object.keys(t)) {
    if (!testKeys.has(k)) throw new Error('unknown test key: ' + k);
  }
  if (t.stage !== 'pass' && t.stage !== 'fail') throw new Error('stage must be pass or fail');
  if (typeof t.durationMs !== 'number') throw new Error('durationMs must be number');
  if (typeof t.message !== 'string') throw new Error('message must be string');
  if (t.peakMemory !== 'unsupported') throw new Error('test peakMemory must be \"unsupported\"');
}

// All 4 required tests must exist and pass
for (const name of requiredTests) {
  const found = d.tests.find(t => t.test === name);
  if (!found) throw new Error('missing required test: ' + name);
  if (found.stage !== 'pass') throw new Error(name + ' must pass, got ' + found.stage);
  if (typeof found.durationMs !== 'number' || found.durationMs < 0) throw new Error(name + ' durationMs invalid');
}

// valid-r0 must have proof data
const vr0 = d.tests.find(t => t.test === 'valid-r0');
if (!vr0.proofHash || !vr0.proofHash.startsWith('0x')) throw new Error('valid-r0 must have proofHash');
if (!vr0.publicSignalsHash || !vr0.publicSignalsHash.startsWith('0x')) throw new Error('valid-r0 must have publicSignalsHash');
if (vr0.signalCount !== 6) throw new Error('valid-r0 must have 6 signals');
if (vr0.proofByteLen !== 384) throw new Error('valid-r0 proof must be 384 bytes');
if (vr0.publicByteLen !== 196) throw new Error('valid-r0 public must be 196 bytes');

// recovery-r0 must have proof data
const rr0 = d.tests.find(t => t.test === 'recovery-r0');
if (!rr0.proofHash || !rr0.proofHash.startsWith('0x')) throw new Error('recovery-r0 must have proofHash');
if (!rr0.publicSignalsHash || !rr0.publicSignalsHash.startsWith('0x')) throw new Error('recovery-r0 must have publicSignalsHash');
if (rr0.signalCount !== 6) throw new Error('recovery-r0 must have 6 signals');
if (rr0.proofByteLen !== 384) throw new Error('recovery-r0 proof must be 384 bytes');

// cancel-r0 must have null proof data
const cr0 = d.tests.find(t => t.test === 'cancel-r0');
if (cr0.proofHash !== null) throw new Error('cancel-r0 proofHash must be null');
if (cr0.signalCount !== null) throw new Error('cancel-r0 signalCount must be null');

console.log('browser-result.json: PASS');
" 2>&1 || fail "browser-result.json validation failed"

# ── Validate network.json ──
NET="${EVIDENCE_DIR}/network.json"
node -e "
const d = require('${NET}');

// Exact top-level keys
const allowedKeys = new Set(['schema','entries']);
const actualKeys = Object.keys(d);
for (const k of actualKeys) {
  if (!allowedKeys.has(k)) throw new Error('unknown network key: ' + k);
}
for (const k of allowedKeys) {
  if (!(k in d)) throw new Error('missing network key: ' + k);
}

if (d.schema !== 'upre-network-v1') throw new Error('network schema must be upre-network-v1');
if (!Array.isArray(d.entries) || d.entries.length === 0) throw new Error('entries must be non-empty array');

const ALLOWED_ORIGINS = new Set(['http://127.0.0.1:8788','http://localhost:8788']);
const ALLOWED_METHODS = new Set(['GET']);

for (const entry of d.entries) {
  const ek = Object.keys(entry);
  const expectedKeys = new Set(['method','url','status','type']);
  for (const k of ek) {
    if (!expectedKeys.has(k)) throw new Error('unknown entry key: ' + k);
  }
  for (const k of expectedKeys) {
    if (!(k in entry)) throw new Error('missing entry key: ' + k);
  }

  if (!ALLOWED_METHODS.has(entry.method)) throw new Error('forbidden method: ' + entry.method + ' ' + entry.url);
  if (entry.method === 'GET') {
    const ok = [...ALLOWED_ORIGINS].some(origin => entry.url.startsWith(origin));
    if (!ok) throw new Error('forbidden origin: ' + entry.url);
  }
}
console.log('network.json: PASS');
" 2>&1 || fail "network.json validation failed"

# ── Validate console.json ──
CON="${EVIDENCE_DIR}/console.json"
node -e "
const d = require('${CON}');
if (!Array.isArray(d)) throw new Error('console.json must be array');
const bad = d.filter(e => {
  const t = typeof e === 'string' ? e : JSON.stringify(e);
  return t.includes('nullifierSecret') || t.includes('trapdoor') || t.includes('witness');
});
if (bad.length > 0) throw new Error('console contains secrets');
console.log('console.json: PASS (no secrets)');
" 2>&1 || fail "console.json validation failed"

echo ""
ok "All evidence validation passed"
exit 0
