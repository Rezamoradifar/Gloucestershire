#!/usr/bin/env bash
# Isolated verification only; does not deploy, swap nginx, or mutate blockchain state.
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
RUNTIME=/opt/globaldroptrade-node/node-v22.23.3-linux-x64/bin
if [ -d "$RUNTIME" ]; then export PATH="$RUNTIME:$PATH"; fi
command -v node >/dev/null
command -v npm >/dev/null
echo "V2_TEST_PHASE dependencies-root"
npm ci --include=dev --ignore-scripts --no-audit --no-fund
echo "V2_TEST_PHASE dependencies-website"
npm ci --prefix website --include=dev --ignore-scripts --no-audit --no-fund
echo "V2_TEST_PHASE website-tests"
npm test --prefix website
echo "V2_TEST_PHASE website-build"
npm run build --prefix website
echo "GLOBAL_V2_FRONTEND_TEST_AND_BUILD_PASS"
echo "NOT A PRODUCTION ACCEPTANCE: no live ABI validation, vault funding, or E2E financial settlement is verified."
