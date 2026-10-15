#!/usr/bin/env bash
# Deploy and connect the explicitly approved owner on BNB TESTNET only.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) exit 1;; esac
node_root="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch"
[ -x "$node_root/bin/node" ] || { echo 'System-readable reviewed Node runtime missing'; exit 1; }
export PATH="$node_root/bin:$PATH"
[ "$(df -Pk . | awk 'NR==2 {print $4}')" -ge 1048576 ] || { echo 'At least 1 GiB free required for the frontend build'; exit 1; }
state=/root/global-testnet-v071/.testnet-server/owner-v2-5bc282-20261015
install -d -m 700 "$state"
exec 9>"$state/deployment.lock"
flock -n 9 || { echo 'Another deployment/update is already running'; exit 1; }
# Reuse the completed frontend dependency installation instead of downloading it again.
if [ ! -d website/node_modules ]; then
 deps=/root/global-features-20261015-KnokOd/website/node_modules
 [ -d "$deps" ] || { echo 'Existing frontend dependencies missing'; exit 1; }
 ln -s "$deps" website/node_modules
fi
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
# Build before signing: frontend failures must not waste deployment gas.
export VITE_CHAIN_ID=97
export VITE_LEGACY_VAULT_ADDRESS=0x7f19354B765920B9b17003d0840EEaA133883DcA
export VITE_VAULT_ADDRESS=0x1111111111111111111111111111111111111111
npm run build --prefix website
node scripts/deploy-owner-v2.mjs
new_vault=$(node --input-type=module -e "import fs from 'node:fs';const r=JSON.parse(fs.readFileSync('$state/deployment-public.json'));if(r.chainId!==97||r.owner!=='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632'||r.salesModel!==2||!r.verified)throw Error('Unverified deployment report');console.log(r.contractAddress)")
export VITE_VAULT_ADDRESS="$new_vault"
npm run build --prefix website
# Keep support records; only change the contract used to authorize the new owner.
install -d -m 700 "$state/api-backup"
cp -p /etc/globaldroptrade/trades.env "$state/api-backup/trades.env"
export GLOBAL_NEW_VAULT="$new_vault"
python3 - <<'PY'
from pathlib import Path
import os
p=Path('/etc/globaldroptrade/trades.env');lines=p.read_text().splitlines()
values={'TRADES_CHAIN_ID':'97','TRADES_VAULT_ADDRESS':os.environ['GLOBAL_NEW_VAULT']}
lines=[line for line in lines if line.split('=',1)[0].strip() not in values]+[k+'='+v for k,v in values.items()]
p.write_text('\n'.join(lines)+'\n');p.chmod(0o600)
PY
# A failed installation restores the previous API target; old vault data remains on-chain.
if ! bash ubuntu-resume-community.sh; then
 cp -p "$state/api-backup/trades.env" /etc/globaldroptrade/trades.env
 systemctl restart globaldroptrade-api || true
 echo 'Connection not confirmed. API target restored; preserve the deployment report and rerun after diagnosis.'
 exit 1
fi
printf '\nNEW_TESTNET_VAULT=%s\nOWNER=0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632\n' "$new_vault"
echo 'Old balances are NOT migrated. Use Open previous contract accounts for old positions.'
echo 'NEW_OWNER_TESTNET_CONNECTED'
