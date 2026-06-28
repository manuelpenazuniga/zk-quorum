#!/usr/bin/env bash
# Regenera el entorno del spike SIN copiar artefactos (evita el crash de WSL).
# Uso: cd spike && ./bootstrap.sh
set -e
git clone --depth 1 https://github.com/stellar/soroban-examples.git
npm install snarkjs
curl -fsSL https://github.com/iden3/circom/releases/latest/download/circom-linux-amd64 -o circom && chmod +x circom
echo "OK. Smoke test:  cd soroban-examples/privacy-pools/contract && cargo test --release"
