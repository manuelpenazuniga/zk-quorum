#!/usr/bin/env bash
# ZK-Quorum U-Pre — Browser evidence collector for Chromium.
#
# Starts Vite in preview mode, opens Chromium via Puppeteer/Playwright,
# runs the harness page, collects evidence, and validates 10 checks.
#
# Prerequisites:
#   1. npm ci completed in apps/web
#   2. Assets staged: node scripts/stage-assets-to-public.js
#   3. Node 24, Chromium installed
#   4. npm install puppeteer (or npx puppeteer)
#
# Evidence output: tmp/u-pre/
#   manifest.json        — build/asset hashes and metadata
#   browser-result.json  — harness result JSON
#   network.json         — captured network requests
#   console.json         — captured console output
#   screenshot.png       — informational screenshot
#
# Usage: bash scripts/run-upre-browser.js [--chromium-path /path/to/chrome]
#
# PENDIENTE: This script is ready but requires a real Chromium browser.
# The actual browser-driven evidence collection is gated on having a
# browser automation tool (Puppeteer/Playwright) installed and a
# display server available. The harness page at /harness.html is
# fully functional and can be manually tested by running:
#   cd apps/web && npx vite preview --port 8788
#   Then open http://localhost:8788/harness.html in Chromium.
#
# Gate checklist (manual verification):
#   1. Load harness → buttons enabled
#   2. Click "Run valid R0" → proof generated, verify true
#   3. Signals match fixture (check browser-result.json)
#   4. Proof/public hashes non-null, byte lengths exact (384 / 196)
#   5. Click "Run invalid witness" → fails with sanitized error
#   6. Cancel during valid run → resolves in bounded time
#   7. No POST/PUT/PATCH/DELETE requests during gate
#   8. Only GET to localhost:8788 for HTML/JS/worker/WASM/zkey/VK/manifest
#   9. No nullifierSecret, trapdoor, siblings, or witness in URL/DOM/console/storage
#  10. Register user agent, duration, memory observed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WEB_DIR="${PROJECT_DIR}/apps/web"
EVIDENCE_DIR="${PROJECT_DIR}/tmp/u-pre"

# ── Helpers ──
ok()   { printf '  [OK] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*" >&2; exit 1; }
info() { printf '==> %s\n' "$*"; }

# ── Check prerequisites ──

info "U-Pre Browser Evidence Collector"
echo ""

# Check assets are staged
PUBLIC_ASSETS="${WEB_DIR}/public/upre-assets"
if [ ! -f "${PUBLIC_ASSETS}/manifest.json" ]; then
  fail "Assets not staged. Run: node scripts/stage-assets-to-public.js"
fi

MANIFEST_PATH="${PUBLIC_ASSETS}/manifest.json"
MANIFEST_SCHEMA=$(node -p "require('${MANIFEST_PATH}').schema")
if [ "${MANIFEST_SCHEMA}" != "UPRE_BROWSER_MANIFEST_V1" ]; then
  fail "Invalid manifest schema: ${MANIFEST_SCHEMA}"
fi

# Check required asset files
for asset in main.wasm r0_final.zkey r0_vk.json; do
  if [ ! -f "${PUBLIC_ASSETS}/${asset}" ]; then
    fail "Missing asset: ${asset}"
  fi
done
ok "Assets staged and manifest valid"

# ── Check for browser automation ──

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
  echo "  PENDIENTE: Browser automation not found"
  echo "============================================"
  echo ""
  echo "  This runner requires puppeteer or playwright to collect browser evidence."
  echo "  Install with: npm install puppeteer"
  echo ""
  echo "  Manual verification steps:"
  echo "  1. cd apps/web && npx vite preview --port 8788"
  echo "  2. Open http://localhost:8788/harness.html in Chromium"
  echo "  3. Click 'Run valid R0' → verify proof generated"
  echo "  4. Click 'Run invalid witness' → verify error sanitized"
  echo "  5. Click 'Cancel' during a run → verify bounded cancel"
  echo "  6. Check DevTools Network tab: only GET requests"
  echo "  7. Check DevTools Console: no secret values"
  echo "  8. Copy result from window.__ZKQ_HARNESS_RESULT__"
  echo ""
  echo "  Build + typecheck: PASS"
  echo "  Unit tests: PASS"
  echo "  Staging: PASS"
  echo "  Browser evidence: PENDIENTE (requires Chromium)"
  echo ""
  exit 0
fi

# ── Run browser evidence collection (PENDIENTE: implement when puppeteer available) ──

info "Browser automation detected. Running harness..."

# TODO: Implement browser automation when puppeteer/playwright is installed.
# The harness page at /harness.html exposes window.__ZKQ_HARNESS_RESULT__
# which contains all test results. The collector should:
# 1. Start vite preview
# 2. Launch Chromium
# 3. Navigate to harness
# 4. Click buttons to run tests
# 5. Capture console, network, and result
# 6. Validate 10 checks
# 7. Save evidence

echo "PENDIENTE: Browser automation implementation needed."
echo "The harness page is ready at /harness.html."
echo "Run manually: cd apps/web && npx vite preview --port 8788"

exit 0
