#!/usr/bin/env bash
# One-time, reviewed V2 testnet frontend cutover. No legacy database deletion.
# Does NOT change the backend, install workers, deploy contracts, or move funds.
set +x
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
[ "$(id -u)" -eq 0 ] || { echo V2_RELEASE_ROOT_REQUIRED; exit 1; }
[ "${1:-}" = "--install" ] && [ "$#" -eq 1 ] || { echo "Usage: bash scripts/run-guarded-v2-site.sh --install"; exit 1; }
[ -d .git ] && [ -f ubuntu-global-v2-site.sh ] || { echo V2_RELEASE_CHECKOUT_REQUIRED; exit 1; }
export GLOBAL_V2_EXPECTED_SHA="$(git rev-parse HEAD)"
echo "V2_RELEASE_SHA=$GLOBAL_V2_EXPECTED_SHA"
# The --install implementation performs ALL preflight tests, build and API
# integrity checks before touching the served website. Running --check first
# used to duplicate npm install + 200 tests and made mobile SSH HUP more likely.
echo "V2_SINGLE_PASS_PREFLIGHT_AND_INSTALL_START"
bash ubuntu-global-v2-site.sh --install
echo "V2_FRONTEND_INSTALL_COMPLETED"
echo "V2_FINANCIAL_PRODUCTION_NOT_APPROVED"
