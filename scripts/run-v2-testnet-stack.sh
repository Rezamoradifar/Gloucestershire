#!/usr/bin/env bash
# Guarded Global V2 TESTNET website + isolated V2 read/support integration.
# Does not deploy contracts, send transactions, wipe data, enable signers or touch
# historical positions. Old V1 finance API config remains unchanged.
set +x
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "$0")/.."
[ "$#" -eq 1 ] || { echo 'Usage: bash scripts/run-v2-testnet-stack.sh --check|--install'; exit 1; }
case "$1" in --check|--install) ;; *) echo V2_STACK_INVALID_MODE; exit 1;; esac
[ "$(id -u)" -eq 0 ] || { echo V2_STACK_ROOT_REQUIRED; exit 1; }
[ -d .git ] || { echo V2_STACK_CHECKOUT_REQUIRED; exit 1; }
export GLOBAL_V2_EXPECTED_SHA=$(git rev-parse HEAD)
[[ "$GLOBAL_V2_EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo V2_STACK_INVALID_SHA; exit 1; }
export PATH="/opt/globaldroptrade-node/node-v22.23.3-linux-x64/bin:$PATH"
for tool in node git curl nginx flock; do command -v "$tool" >/dev/null || {
 echo "V2_STACK_MISSING_TOOL_$tool"; exit 1; }; done
echo "V2_STACK_PINNED_SHA=$GLOBAL_V2_EXPECTED_SHA"
echo 'V2_STACK_PHASE=API_AND_RPC_PREFLIGHT'
bash ubuntu-v2-support-install.sh --check
echo 'V2_STACK_PHASE=FRONTEND_PREFLIGHT'
bash ubuntu-global-v2-site.sh --check
echo 'V2_STACK_CHECK_OK'
if [ "$1" = --check ]; then
 echo 'No service, wallet, contract, data or frontend changed.'
 exit 0
fi
echo 'V2_STACK_PHASE=INSTALL_ISOLATED_SUPPORT_AND_RPC'
bash ubuntu-v2-support-install.sh --install
echo 'V2_STACK_PHASE=INSTALL_FRONTEND_WITH_ROLLBACK'
# Frontend installer leaves old site files in place if its own health gate fails.
# An installed V2 API extension is backward compatible with V1; it does not
# change the legacy vault address, worker or stored ledger.
bash ubuntu-global-v2-site.sh --install
echo 'V2_TESTNET_STACK_INSTALLED'
echo 'V2_MAINNET_AND_REAL_CAPITAL_NOT_APPROVED'
echo 'Old contract data and financial journals were not deleted.'
