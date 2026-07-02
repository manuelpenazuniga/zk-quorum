#!/usr/bin/env bash
# ZK-Quorum C0 — Groth16 development setup for BLS12-381 (ONE-SHOT CEREMONY).
#
# WARNING: This is a ONE-SHOT trusted ceremony. Run it once, commit the
# resulting manifests + VKs, and deliver the generated ptau/zkey files to
# Codex for publication. Do NOT re-run for day-to-day development — use
# `scripts/fetch-setup-assets.js` instead for reproducible gate validation.
#
# Generates:
#   1. Powers of Tau phase 1 (power-14, BLS12-381).
#   2. Circuit R1CS + WASM (via circom compilation).
#   3. Groth16 zkey per circuit (R0, R1) with circuit-specific contribution.
#   4. Verification keys (VK JSON, committed to Git).
#   5. Manifests with SHA-256, byte sizes, commands, tool versions, ptau
#      provenance/checksum, and public signal schema.
#   6. Positive proofs + snarkjs verify sanity.
#
# This is a TRUSTED / NON-PRODUCTION ceremony for the hackathon.
# Never use these artifacts in production.
#
# Usage (ONE-SHOT): bash scripts/setup-groth16.sh
#
# Environment:
#   Node 24, Circom 2.2.3 (.bootstrap/bin/circom), snarkjs 0.7.6 (repo-local).

set -euo pipefail
cd "$(dirname "$0")/.."

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
    candidate=".bootstrap/circom/v2.2.3/circom"
    if [ -x "${candidate}" ]; then
        echo "${candidate}"
        return
    fi
    candidate=".bootstrap/bin/circom"
    if [ -x "${candidate}" ]; then
        echo "${candidate}"
        return
    fi
    echo "ERROR: circom 2.2.3 not found" >&2
    exit 1
}

CIRCOM=$(resolve_circom)
SNARKJS="node_modules/.bin/snarkjs"
SETUP_DIR="tmp/setup"
POWER=14
PTAU_FILE="${SETUP_DIR}/pot14_final.ptau"
PTAU_SEED="0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"
PTAU_BEACON_ITERS=10
R0_CONTRIB_NAME="R0 circuit-specific"
R0_CONTRIB_ENTROPY="r0-specific-entropy-2026"
R1_CONTRIB_NAME="R1 circuit-specific"
R1_CONTRIB_ENTROPY="r1-specific-entropy-2026"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# ── Portable SHA256 helper (Node crypto, works on macOS/Linux) ────────────────
# We avoid sha256sum / shasum portability issues by using Node's crypto module.
sha256_node() {
    node -e "
const fs = require('fs');
const crypto = require('crypto');
const buf = fs.readFileSync(process.argv[1]);
console.log(crypto.createHash('sha256').update(buf).digest('hex'));
" "$1"
}

echo "============================================"
echo "ZK-Quorum Groth16 BLS12-381 Dev Setup"
echo "============================================"
echo "Timestamp: ${TIMESTAMP}"
echo "Power: 2^${POWER} = $(( 1 << POWER ))"
echo "TRUSTED/NON-PRODUCTION — do not use in production"
echo ""

# ── Toolchain check ──────────────────────────────────────────────────────────
if [ ! -x "${CIRCOM}" ]; then
    echo "ERROR: ${CIRCOM} not found. Run bootstrap first."
    exit 1
fi
CIRCOM_VERSION=$(${CIRCOM} --version 2>&1 | awk 'NR==1{print $3}')
echo "[OK] circom ${CIRCOM_VERSION}"

if [ ! -x "${SNARKJS}" ]; then
    echo "ERROR: snarkjs not installed (run npm install)"
    exit 1
fi
SNARKJS_VERSION=$(node -p "require('./node_modules/snarkjs/package.json').version")
echo "[OK] snarkjs ${SNARKJS_VERSION}"
NODE_VERSION=$(node --version)
echo "[OK] Node ${NODE_VERSION}"
echo ""

# ── Setup directory ──────────────────────────────────────────────────────────
mkdir -p "${SETUP_DIR}" circuits/build/public-vote circuits/build/commit-vote

# ── Phase 1: Powers of Tau (generate if not already cached) ───────────────────
PTAU_GENERATED="no"
if [ -f "${PTAU_FILE}" ]; then
    PTAU_SHA=$(sha256_node "${PTAU_FILE}")
    echo "Ptau exists: ${PTAU_SHA}"
    "${SNARKJS}" powersoftau verify "${PTAU_FILE}" 2>&1 | grep -q "Powers of Tau Ok!" && \
        echo "[OK] powersoftau verify passed" || \
        { echo "ERROR: powersoftau verify failed"; exit 1; }
else
    echo "Generating Powers of Tau (power=${POWER}, BLS12-381)..."
    "${SNARKJS}" powersoftau new bls12381 ${POWER} "${SETUP_DIR}/pot14_0000.ptau" -v

    "${SNARKJS}" powersoftau contribute "${SETUP_DIR}/pot14_0000.ptau" "${SETUP_DIR}/pot14_0001.ptau" \
        --name="ZK-Quorum dev contribution" -v <<< "zkquorum-dev-entropy"

    "${SNARKJS}" powersoftau beacon "${SETUP_DIR}/pot14_0001.ptau" "${SETUP_DIR}/pot14_beacon.ptau" \
        "${PTAU_SEED}" ${PTAU_BEACON_ITERS} -n="Final Beacon" -v

    "${SNARKJS}" powersoftau prepare phase2 "${SETUP_DIR}/pot14_beacon.ptau" "${PTAU_FILE}" -v

    rm -f "${SETUP_DIR}/pot14_0000.ptau" "${SETUP_DIR}/pot14_0001.ptau" "${SETUP_DIR}/pot14_beacon.ptau"

    PTAU_GENERATED="yes"
    echo "[OK] Ptau generated"
fi

PTAU_SHA256=$(sha256_node "${PTAU_FILE}")
PTAU_BYTES=$(wc -c < "${PTAU_FILE}" | tr -d ' ')
echo "Ptau SHA256: ${PTAU_SHA256}"
echo "Ptau bytes:  ${PTAU_BYTES}"
echo ""

# ── Phase 2: Compile circuits ────────────────────────────────────────────────
echo "=== Compiling R0 circuit ==="
${CIRCOM} --prime bls12381 --r1cs --sym --wasm --output circuits/build/public-vote \
    circuits/public-vote/main.circom

echo ""
echo "=== Compiling R1 circuit ==="
${CIRCOM} --prime bls12381 --r1cs --sym --wasm --output circuits/build/commit-vote \
    circuits/commit-vote/main.circom

R0_R1CS_SHA256=$(sha256_node circuits/build/public-vote/main.r1cs)
R1_R1CS_SHA256=$(sha256_node circuits/build/commit-vote/main.r1cs)

echo ""
echo "R0 R1CS: ${R0_R1CS_SHA256}"
echo "R1 R1CS: ${R1_R1CS_SHA256}"

echo ""
echo "=== R1CS info ==="
"${SNARKJS}" r1cs info circuits/build/public-vote/main.r1cs
echo "---"
"${SNARKJS}" r1cs info circuits/build/commit-vote/main.r1cs
echo ""

# ── Phase 3: Groth16 zkey per circuit ────────────────────────────────────────
for CIRCUIT in r0 r1; do
    if [ "${CIRCUIT}" = "r0" ]; then
        CIRCUIT_NAME="public-vote"
        CONTRIB_NAME="${R0_CONTRIB_NAME}"
        CONTRIB_ENTROPY="${R0_CONTRIB_ENTROPY}"
    else
        CIRCUIT_NAME="commit-vote"
        CONTRIB_NAME="${R1_CONTRIB_NAME}"
        CONTRIB_ENTROPY="${R1_CONTRIB_ENTROPY}"
    fi

    ZKEY_0000="${SETUP_DIR}/${CIRCUIT}_0000.zkey"
    ZKEY_0001="${SETUP_DIR}/${CIRCUIT}_0001.zkey"
    ZKEY_FINAL="${SETUP_DIR}/${CIRCUIT}_final.zkey"
    VK_FILE="${SETUP_DIR}/${CIRCUIT}_vk.json"
    PROOF_FILE="${SETUP_DIR}/${CIRCUIT}_proof.json"
    PUBLIC_FILE="${SETUP_DIR}/${CIRCUIT}_public.json"

    echo "=== ${CIRCUIT} zkey setup ==="

    "${SNARKJS}" groth16 setup circuits/build/${CIRCUIT_NAME}/main.r1cs "${PTAU_FILE}" "${ZKEY_0000}"

    "${SNARKJS}" zkey contribute "${ZKEY_0000}" "${ZKEY_0001}" \
        --name="${CONTRIB_NAME}" -v <<< "${CONTRIB_ENTROPY}"

    "${SNARKJS}" zkey beacon "${ZKEY_0001}" "${ZKEY_FINAL}" \
        "${PTAU_SEED}" ${PTAU_BEACON_ITERS} -n="${CIRCUIT} Final Beacon"

    "${SNARKJS}" zkey verify circuits/build/${CIRCUIT_NAME}/main.r1cs "${PTAU_FILE}" "${ZKEY_FINAL}" 2>&1 | \
        grep -q "ZKey Ok!" && echo "[OK] zkey verify passed" || { echo "ERROR: zkey verify failed"; exit 1; }

    "${SNARKJS}" zkey export verificationkey "${ZKEY_FINAL}" "${VK_FILE}"

    ZKEY_SHA256=$(sha256_node "${ZKEY_FINAL}")
    ZKEY_BYTES=$(wc -c < "${ZKEY_FINAL}" | tr -d ' ')
    VK_SHA256=$(sha256_node "${VK_FILE}")
    VK_BYTES=$(wc -c < "${VK_FILE}" | tr -d ' ')

    echo "  zkey SHA256: ${ZKEY_SHA256}"
    echo "  zkey bytes:  ${ZKEY_BYTES}"
    echo "  VK SHA256:   ${VK_SHA256}"
    echo "  VK bytes:    ${VK_BYTES}"

    cp "${VK_FILE}" "circuits/artifacts/manifests/${CIRCUIT}_vk.json"
    echo "  VK copied to circuits/artifacts/manifests/${CIRCUIT}_vk.json"
    echo ""
done

# ── Phase 4: Generate test proofs and verify ──────────────────────────────────
echo "=== Generating test proofs ==="

# R0 proof
echo "--- R0 ---"
cat circuits/artifacts/fixtures/r0-vote-0.json | node -e "
const {stdin}=process;
let d='';
stdin.on('data',c=>d+=c);
stdin.on('end',()=>{
  const o=JSON.parse(d);
  delete o._meta;
  process.stdout.write(JSON.stringify(o));
})" > "${SETUP_DIR}/r0_input.json"

"${SNARKJS}" groth16 fullprove "${SETUP_DIR}/r0_input.json" \
    circuits/build/public-vote/main_js/main.wasm \
    "${SETUP_DIR}/r0_final.zkey" \
    "${SETUP_DIR}/r0_proof.json" \
    "${SETUP_DIR}/r0_public.json"

"${SNARKJS}" groth16 verify "${SETUP_DIR}/r0_vk.json" \
    "${SETUP_DIR}/r0_public.json" "${SETUP_DIR}/r0_proof.json" 2>&1 | \
    grep -q "OK!" && echo "[OK] R0 proof verified" || { echo "ERROR: R0 proof verify failed"; exit 1; }

# R1 proof
echo "--- R1 ---"
cat circuits/artifacts/fixtures/r1-vote-3-salt-42.json | node -e "
const {stdin}=process;
let d='';
stdin.on('data',c=>d+=c);
stdin.on('end',()=>{
  const o=JSON.parse(d);
  delete o._meta;
  process.stdout.write(JSON.stringify(o));
})" > "${SETUP_DIR}/r1_input.json"

"${SNARKJS}" groth16 fullprove "${SETUP_DIR}/r1_input.json" \
    circuits/build/commit-vote/main_js/main.wasm \
    "${SETUP_DIR}/r1_final.zkey" \
    "${SETUP_DIR}/r1_proof.json" \
    "${SETUP_DIR}/r1_public.json"

"${SNARKJS}" groth16 verify "${SETUP_DIR}/r1_vk.json" \
    "${SETUP_DIR}/r1_public.json" "${SETUP_DIR}/r1_proof.json" 2>&1 | \
    grep -q "OK!" && echo "[OK] R1 proof verified" || { echo "ERROR: R1 proof verify failed"; exit 1; }

# ── Phase 5: Write manifests ─────────────────────────────────────────────────
echo ""
echo "=== Writing manifests ==="

R0_ZKEY_SHA256=$(sha256_node ${SETUP_DIR}/r0_final.zkey)
R0_ZKEY_BYTES=$(wc -c < ${SETUP_DIR}/r0_final.zkey | tr -d ' ')
R0_VK_SHA256=$(sha256_node ${SETUP_DIR}/r0_vk.json)
R0_VK_BYTES=$(wc -c < ${SETUP_DIR}/r0_vk.json | tr -d ' ')
R0_R1CS_BYTES=$(wc -c < circuits/build/public-vote/main.r1cs | tr -d ' ')

R1_ZKEY_SHA256=$(sha256_node ${SETUP_DIR}/r1_final.zkey)
R1_ZKEY_BYTES=$(wc -c < ${SETUP_DIR}/r1_final.zkey | tr -d ' ')
R1_VK_SHA256=$(sha256_node ${SETUP_DIR}/r1_vk.json)
R1_VK_BYTES=$(wc -c < ${SETUP_DIR}/r1_vk.json | tr -d ' ')
R1_R1CS_BYTES=$(wc -c < circuits/build/commit-vote/main.r1cs | tr -d ' ')

node scripts/write-setup-manifests.js \
    "${TIMESTAMP}" \
    "${CIRCOM_VERSION}" "${SNARKJS_VERSION}" "${NODE_VERSION}" \
    "${POWER}" \
    "${PTAU_SHA256}" "${PTAU_BYTES}" "${PTAU_SEED}" "${PTAU_BEACON_ITERS}" \
    "${R0_R1CS_SHA256}" "${R0_R1CS_BYTES}" "${R0_ZKEY_SHA256}" "${R0_ZKEY_BYTES}" "${R0_VK_SHA256}" "${R0_VK_BYTES}" \
    "${R1_R1CS_SHA256}" "${R1_R1CS_BYTES}" "${R1_ZKEY_SHA256}" "${R1_ZKEY_BYTES}" "${R1_VK_SHA256}" "${R1_VK_BYTES}"

echo "[OK] Manifests written"

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "============================================"
echo "Setup complete."
echo ""
echo "Committed (Git):"
echo "  circuits/artifacts/manifests/public-vote-r0.json"
echo "  circuits/artifacts/manifests/commit-vote-r1.json"
echo "  circuits/artifacts/manifests/r0_vk.json"
echo "  circuits/artifacts/manifests/r1_vk.json"
echo ""
echo "NOT committed (too large, in tmp/setup/):"
echo "  tmp/setup/pot14_final.ptau       (${PTAU_BYTES} bytes)"
echo "  tmp/setup/r0_final.zkey          ($(wc -c < ${SETUP_DIR}/r0_final.zkey | tr -d ' ') bytes)"
echo "  tmp/setup/r1_final.zkey          ($(wc -c < ${SETUP_DIR}/r1_final.zkey | tr -d ' ') bytes)"
echo "  tmp/setup/r{0,1}_{proof,public,input}.json"
echo ""
echo "Ptau SHA256: ${PTAU_SHA256}"
echo "============================================"
