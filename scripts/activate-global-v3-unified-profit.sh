#!/usr/bin/env bash
# Operator-gated setup of TESTNET V3 internal-profit keeper and unified frontend.
# Never deploys a contract, migrates V2 funds, pays a user, or uses mainnet.
set +x
set -Eeuo pipefail
umask 077
BASE="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
[[ $# -eq 1 && ( "$1" == --preflight || "$1" == --activate ) ]] ||
 { echo "USAGE: bash scripts/activate-global-v3-unified-profit.sh --preflight|--activate"; exit 1; }
[[ "$(id -u)" -eq 0 ]] || { echo V3_OPERATOR_ROOT_REQUIRED; exit 1; }
cd "$BASE"
arch="$(uname -m)"
case "$arch" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) echo UNSUPPORTED_ARCH; exit 1 ;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
[[ -x "$runtime/node" ]] && export PATH="$runtime:$PATH"
for tool in node npm git systemctl; do command -v "$tool" >/dev/null ||
 { echo "MISSING_V3_ACTIVATION_DEPENDENCY=$tool"; exit 1; }; done
[[ -f scripts/install-global-v3-keeper-timer.sh &&
   -f scripts/fund-v3-keeper-gas-from-old-deployer.mjs &&
   -f scripts/verify-v3-site-deployment.mjs &&
   -d .git ]] || { echo V3_REVIEWED_FULL_CHECKOUT_REQUIRED; exit 1; }
echo "V3_ACTIVATION_PINNED_RELEASE_SHA=$(git rev-parse HEAD)"
# Last deployed V3 receipt and code MUST match the currently reviewed
# unchanged contract. Stop before moving even valueless gas if it doesn't.
node scripts/verify-v3-site-deployment.mjs --check
echo "V3_SITE_EXISTING_CONTRACT_VERIFIED"
if [[ "$1" == --preflight ]]; then
 node scripts/diagnose-global-v3-profit-readonly.mjs --check \
  --config=/etc/globaldroptrade/v3-keeper-testnet.json
 echo V3_PROFIT_ACTIVATION_PREFLIGHT_READONLY
 systemctl is-active global-v3-compound-keeper-testnet.timer || true
 exit 0
fi
if [[ -e /etc/systemd/system/global-v3-compound-keeper-testnet.timer ||
      -e /etc/systemd/system/global-v3-compound-keeper-testnet.service ]]; then
 if systemctl is-active --quiet global-v3-compound-keeper-testnet.timer; then
  echo V3_EXISTING_KEEPER_TIMER_ALREADY_ACTIVE_NO_DUPLICATE_INSTALL
 else
  echo V3_KEEPER_PARTIAL_EXISTING_UNIT_REQUIRES_REVIEW_NO_OVERWRITE
  exit 1
 fi
else
 # Create a disposable separate gas-only wallet once; never print private key.
 bash scripts/install-global-v3-keeper-timer.sh --init-wallet
 # Operator explicitly types the phrase for a capped amount of valueless
 # BNB Testnet tBNB from the already validated old testnet deployer.
 node scripts/fund-v3-keeper-gas-from-old-deployer.mjs --fund
 # The check requires real gas and correct separate non-manager account roles.
 bash scripts/install-global-v3-keeper-timer.sh --check
 bash scripts/install-global-v3-keeper-timer.sh --install
fi
echo "V3_KEEPER_ENABLED=$(systemctl is-enabled global-v3-compound-keeper-testnet.timer)"
echo "V3_KEEPER_ACTIVE=$(systemctl is-active global-v3-compound-keeper-testnet.timer)"
# Site can use this same reviewed release's one unified account UI. Existing
# V3 chain receipt, bytecode and root-owned site install backups are checked
# by the launcher before the detached systemd installation starts.
bash scripts/launch-v3-site-after-deployment.sh --install
echo V3_SINGLE_ACCOUNT_SITE_INSTALL_STARTED_NOT_YET_COMPLETE
echo V3_SITE_SUCCESS_REQUIRES=V3_TESTNET_PRIMARY_DASHBOARD_INSTALLED
echo V3_KEEPER_SUCCESS_REQUIRES=V3_AUTO_COMPOUND_RUN_RESULT_WITH_CONFIRMED_TRANSACTIONS
echo V3_TESTNET_ONLY_NO_REAL_USDT_NO_MAINNET_APPROVAL
