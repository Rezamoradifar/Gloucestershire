#!/usr/bin/env bash
# Deploy and verify the approval-enabled testnet candidate with the existing server signer.
set +x
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "${1:-}" = --execute ] || { echo 'Pass --execute to authorize the testnet deployment.'; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo 'Unsupported CPU'; exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ]; then export PATH="$runtime:$PATH"; fi
for command in node npm flock systemctl; do command -v "$command" >/dev/null; done
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12))throw Error("Node 22.12+ required")'
test -s /etc/globaldroptrade/trades.env || { echo 'Existing API environment required'; exit 1; }
for unit in globaldroptrade-migration.service globaldroptrade-fresh-rewards.service; do
 if systemctl is-active --quiet "$unit"; then echo "Another deployment is running: $unit"; exit 1; fi
done
umask 077
directory=/var/lib/globaldroptrade/approved-rewards-v1
# Validate the directory before opening any lock or journal inside it.
node --input-type=module - "$directory" <<'JS'
import fs from 'node:fs';
const directory=process.argv[2];fs.mkdirSync(directory,{recursive:true,mode:0o700});
const s=fs.lstatSync(directory);
if(!s.isDirectory()||s.uid!==0||(s.mode&0o077)!==0)throw Error('PRIVATE_STATE_DIRECTORY_REQUIRED');
const lock=directory+'/run.lock';
if(fs.existsSync(lock)){const l=fs.lstatSync(lock);if(!l.isFile()||l.uid!==0||(l.mode&0o077)!==0)throw Error('PRIVATE_LOCK_REQUIRED');}
JS
exec 9>"$directory/run.lock"
flock -n 9 || { echo 'Another approval deployment is running'; exit 1; }
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
echo 'Deploying on BNB Testnet 97. Maximum cumulative transaction fee: 0.1 test BNB.'
node --env-file=/etc/globaldroptrade/trades.env scripts/deploy-approved-rewards.mjs --execute
