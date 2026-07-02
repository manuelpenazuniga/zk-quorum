#!/usr/bin/env bash
# ZK-Quorum U-Pre — Browser evidence collector for Chromium.
#
# Starts Vite in preview mode, opens Chromium, runs harness, saves evidence.
#
# Prerequisites:
#   1. npm ci completed in apps/web
#   2. Assets staged: node scripts/stage-assets-to-public.js
#   3. Node 24, Chromium installed
#   4. npm install puppeteer (in apps/web or root)
#
# Evidence output: tmp/u-pre/
#   manifest.json        — build/asset hashes and metadata
#   browser-result.json  — harness result JSON
#   network.json         — captured network requests
#   console.json         — captured console output
#   screenshot.png       — informational screenshot
#
# Usage: bash scripts/run-upre-browser.sh [--prepare-only]
#   --prepare-only: only stage/build/verify, skip browser execution
#   Without --prepare-only: requires puppeteer + Chromium, fails if missing

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WEB_DIR="${PROJECT_DIR}/apps/web"
EVIDENCE_DIR="${PROJECT_DIR}/tmp/u-pre"

PREPARE_ONLY=false
for arg in "$@"; do
  if [ "$arg" = "--prepare-only" ]; then PREPARE_ONLY=true; fi
done

# ── Helpers ──
ok()   { printf '  [OK] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*" >&2; exit 1; }
info() { printf '==> %s\n' "$*"; }

info "U-Pre Browser Evidence Collector"
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
    fail "Missing asset: ${asset}"
  fi
done
ok "Assets staged and manifest valid"

# ── 2. Verify dist build has no .ts worker files ──
if [ -d "${WEB_DIR}/dist" ]; then
  TS_WORKERS=$(find "${WEB_DIR}/dist" -name "proverWorker*.ts" 2>/dev/null || true)
  if [ -n "${TS_WORKERS}" ]; then
    fail "Build contains uncompiled .ts worker files: ${TS_WORKERS}"
  fi
fi
ok "Build verified (no uncompiled .ts workers)"

# ── 3. Prepare-only mode ──
if [ "${PREPARE_ONLY}" = "true" ]; then
  echo ""
  ok "Prepare-only mode: stage + build verified. Skipping browser execution."
  exit 0
fi

# ── 4. Check for browser automation ──
HAS_PUPPETEER=false
if node -e "require('puppeteer')" 2>/dev/null; then
  HAS_PUPPETEER=true
fi

HAS_PLAYWRIGHT=false
if node -e "require('playwright')" 2>/dev/null; then
  HAS_PLAYWRIGHT=true
fi

if [ "${HAS_PUPPETEER}" = "false" ] && [ "${HAS_PLAYWRIGHT}" = "false" ]; then
  echo ""
  echo "============================================"
  echo "  FAILED: Browser automation not found"
  echo "============================================"
  echo ""
  echo "  This runner requires puppeteer or playwright."
  echo "  Install: npm install puppeteer"
  echo ""
  echo "  Or use --prepare-only to skip browser execution."
  echo "  cd apps/web && npx vite preview --port 8788"
  echo "  Then open http://localhost:8788/harness.html in Chromium."
  echo ""
  echo "  Manual verification checklist:"
  echo "    1. Load harness → buttons enabled"
  echo "    2. Click 'Run valid R0' → proof PASS"
  echo "    3. Signals match fixture (check __ZKQ_HARNESS_RESULT__)"
  echo "    4. Proof/public hashes non-null, byte lengths 384/196"
  echo "    5. Click 'Run invalid witness' → sanitized error"
  echo "    6. Cancel with recovery"
  echo "    7. No POST/PUT/PATCH/DELETE requests"
  echo "    8. Only GET to localhost:8788"
  echo "    9. No secrets in URL/DOM/console/storage"
  echo "   10. Register user agent, duration, memory"
  exit 1
fi

info "Browser automation detected. Collecting evidence..."

# ── 5. Collect browser evidence ──
# PENDIENTE: Implement puppeteer/playwright automation when available.
# The harness page at /harness.html exposes window.__ZKQ_HARNESS_RESULT__
# with all test results. The collector should:
# 1. Start vite preview on port 8788
# 2. Launch Chromium
# 3. Navigate to http://localhost:8788/harness.html
# 4. Click buttons to run tests
# 5. Capture console, network, and result
# 6. Validate 10 checks from brief §5
# 7. Save evidence to tmp/u-pre/

echo "PENDIENTE: Browser automation implementation needed for full gate."
echo "Run manually: cd apps/web && npx vite preview --port 8788"
echo "Then open http://localhost:8788/harness.html in Chromium."

exit 1
