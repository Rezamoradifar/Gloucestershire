#!/usr/bin/env bash
# Final read-only launch gate for Global mainnet. This script never signs or broadcasts.
set +x
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

usage() {
  echo "Usage: bash ubuntu-mainnet-final-gate.sh --from PUBLIC_ADDRESS [--rpc-file /absolute/private/file] [--activation-file /absolute/private/json]"
}

from=""
rpc_file=""
activation_file=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) from="${2:-}"; shift 2;;
    --rpc-file) rpc_file="${2:-}"; shift 2;;
    --activation-file) activation_file="${2:-}"; shift 2;;
    *) usage; exit 1;;
  esac
done
[[ -n "$from" ]] || { usage; exit 1; }
[[ -z "$rpc_file" || "$rpc_file" = /* ]] || { echo MAINNET_PRIVATE_RPC_FILE_REQUIRED; exit 1; }
[[ -z "$activation_file" || "$activation_file" = /* ]] || { echo MAINNET_PRIVATE_ACTIVATION_FILE_REQUIRED; exit 1; }
[[ "$EUID" -eq 0 ]] || { echo ROOT_REQUIRED; exit 1; }

echo "GLOBAL_MAINNET_GATE phase=OFFLINE_PLAN"
bash ubuntu-mainnet.sh plan >/tmp/global-mainnet-plan.$$.json
trap 'rm -f /tmp/global-mainnet-plan.$$.json' EXIT

echo "GLOBAL_MAINNET_GATE phase=RPC_AND_HISTORY"
readiness=(bash ubuntu-mainnet-readiness.sh check --from "$from")
[[ -z "$rpc_file" ]] || readiness+=(--rpc-file "$rpc_file")
"${readiness[@]}"

echo "GLOBAL_MAINNET_GATE phase=SOURCE_AND_ROLE_REVIEW"
node --input-type=module - <<'JS'
import fs from 'node:fs';
import {getAddress} from 'ethers';
const c=JSON.parse(fs.readFileSync('config.mainnet.json','utf8'));
const addresses=[c.initialOwner,...c.partners,c.dropshippingWallet].map(getAddress);
if(new Set(addresses.map(x=>x.toLowerCase())).size!==addresses.length)throw Error('MAINNET_RECIPIENTS_MUST_BE_UNIQUE');
if(c.chainId!==56||c.dailyPeriodSeconds!==86400)throw Error('MAINNET_CHAIN_OR_PERIOD_MISMATCH');
console.log(JSON.stringify({
 version:1,kind:'global-mainnet-final-gate',
 chainId:56,periodSeconds:86400,
 owner:c.initialOwner,partners:c.partners,dropshippingWallet:c.dropshippingWallet,
 productionUSDT:c.usdt,bnbUsdFeed:c.bnbUsdFeed,usdtUsdFeed:c.usdtUsdFeed,
 recipientConfirmationRequired:true,
 ownerLiquidityAuthorityReviewRequired:true,
 signerOpened:false,transactionsSigned:0,transactionsSent:0
},null,2));
JS

if [[ -n "$activation_file" ]]; then
  echo "GLOBAL_MAINNET_GATE phase=POST_DEPLOY_AUTOMATION_CHECK"
  bash ubuntu-production-automation.sh --check "$activation_file"
else
  echo "GLOBAL_MAINNET_GATE phase=PREDEPLOY_COMPLETE"
  echo "GLOBAL_MAINNET_GATE_BLOCKED MAINNET_DEPLOYMENT_AND_ACTIVATION_MANIFEST_REQUIRED"
  echo "No key was opened and no transaction was sent."
  exit 2
fi

echo "GLOBAL_MAINNET_GATE phase=POST_DEPLOY_COMPLETE"
echo "Review reporter permission, operator gas, reward funding, approved-withdrawal path and live site target before enabling the production timer."
