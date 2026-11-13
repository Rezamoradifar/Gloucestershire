#!/usr/bin/env bash
# SINGLE-GATE BNB TESTNET V3 release for the approved separate Global website.
# Operator must sign the actual contract deployment; never silently sign or
# import any real-money wallet. No mainnet, old V2 data migration or DB wipe.
set +x
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "$0")/.."
[[ "$(id -u)" -eq 0 ]] || { echo V3_RELEASE_REQUIRES_ROOT; exit 1; }
[[ $# -eq 1 ]] || { echo "Usage: --preflight|--deploy-testnet-and-install|--install-verified-site"; exit 1; }
case "$1" in
 --preflight|--deploy-testnet-and-install|--install-verified-site) ;;
 *) echo V3_RELEASE_INVALID_MODE; exit 1 ;;
esac
[[ -d .git ]] || { echo V3_RELEASE_GIT_REPOSITORY_REQUIRED; exit 1; }
sha="$(git rev-parse HEAD)"
[[ "$sha" =~ ^[a-f0-9]{40}$ ]] || { echo V3_RELEASE_INVALID_SHA; exit 1; }
arch="$(uname -m)"
if [[ "$arch" == x86_64 ]]; then arch=x64; elif [[ "$arch" == aarch64 ]]; then arch=arm64; else echo V3_RELEASE_UNSUPPORTED_CPU; exit 1; fi
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
[[ -x "$runtime/node" ]] && export PATH="$runtime:$PATH"
command -v node >/dev/null || { echo V3_RELEASE_NODE_MISSING; exit 1; }
proof=/var/lib/globaldroptrade/v3-prototype/deployment.json
echo "V3_PINNED_SITE_CODE_SHA=$sha"
if [[ "$1" == --preflight ]]; then
 if [[ -s "$proof" ]]; then
  node scripts/verify-v3-site-deployment.mjs --check
 else
  node scripts/deploy-global-v3-testnet.mjs --check-old-testnet-deployer
 fi
 echo V3_PREFLIGHT_READ_ONLY_COMPLETE
 exit 0
fi
if [[ "$1" == --deploy-testnet-and-install ]]; then
 if [[ -s "$proof" ]]; then
  # A previously SUCCESSFUL V3 deployment may have left Android SSH at the
  # prompt because ethers had a late provider poll cancellation during exit.
  # DO NOT broadcast another contract creation or reuse an old nonce.
  # The independent chain/receipt/bytecode verification below must pass.
  echo V3_DEPLOYMENT_PROOF_FOUND_REVERIFY_ONLY_NO_REDEPLOY
 elif [[ -e "$proof" ]]; then
  echo V3_INCOMPLETE_DEPLOYMENT_INTENT_RECONCILE_CHAIN_BEFORE_ANY_RETRY; exit 1
 else
  # No on-chain V3 deployment has been attempted under this operator marker.
  # This stops before any transaction if the old testnet signer lacks gas.
  node scripts/deploy-global-v3-testnet.mjs --check-old-testnet-deployer
  # The deployer itself requires an exact typed testnet confirmation in the TTY.
  node scripts/deploy-global-v3-testnet.mjs --deploy-old-testnet-deployer
 fi
fi
# Either a new or an existing deployment must pass independent public testnet
# tx-receipt, contract-code/source, fee-wallet, role and network validation.
node scripts/verify-v3-site-deployment.mjs --check
# Site release is detached from Android SSH and uses the existing atomic
# installer with backed-up V2 site and backend/journal integrity checks.
bash scripts/launch-v3-site-after-deployment.sh --install
echo "V3_TESTNET_RELEASE_STARTED_NOT_YET_COMPLETED"
echo "V3_TESTNET_RELEASE_SUCCESS_REQUIRES=V3_TESTNET_PRIMARY_DASHBOARD_INSTALLED"
echo "V3_AUTOMATIC_COMPOUND_KEEPER_REQUIRES_SEPARATE_GAS_ONLY_SETUP"
