#!/usr/bin/env bash
# Deploy a new empty testnet contract using literal release settings and the existing signer.
set +x
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
profile_args=()
case "$#:$*" in
 '1:--execute') ;;
 '2:--execute --fast-testnet'|'2:--fast-testnet --execute') profile_args=(--fast-testnet);;
 *) echo 'Pass --execute, optionally with --fast-testnet, to authorize the testnet deployment.'; exit 1;;
esac
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
if [ "${#profile_args[@]}" -gt 0 ]; then
 for unit in globaldroptrade-automation.timer globaldroptrade-oracles.timer globaldroptrade-zero-daily.timer globaldroptrade-automation.service globaldroptrade-oracles.service globaldroptrade-zero-daily.service; do
  loaded=$(systemctl show --property=LoadState --value "$unit") || { echo "Cannot inspect signer worker: $unit"; exit 1; }
  case "$loaded" in
   not-found) continue;;
   loaded)
    active=$(systemctl show --property=ActiveState --value "$unit") || { echo "Cannot inspect signer worker: $unit"; exit 1; }
    case "$active" in inactive|failed) ;; *) echo "Stop the signer worker before fast-testnet deployment: $unit"; exit 1;; esac
    ;;
   *) echo "Cannot inspect signer worker: $unit"; exit 1;;
  esac
 done
fi
umask 077
directory=$(node --input-type=module - "${profile_args[@]}" <<'JS'
import {parseZeroStartProfileArgs} from './scripts/zero-start-profile.mjs';
console.log(parseZeroStartProfileArgs(process.argv.slice(2)).profile.stateDir);
JS
)
node --input-type=module - "$directory" <<'JS'
import fs from 'node:fs';
const directory=process.argv[2];fs.mkdirSync(directory,{recursive:true,mode:0o700});
const s=fs.lstatSync(directory);
if(!s.isDirectory()||s.uid!==0||(s.mode&0o077)!==0)throw Error('PRIVATE_STATE_DIRECTORY_REQUIRED');
const lock=directory+'/run.lock';
if(fs.existsSync(lock)){const l=fs.lstatSync(lock);if(!l.isFile()||l.uid!==0||(l.mode&0o077)!==0)throw Error('PRIVATE_LOCK_REQUIRED');}
JS
exec 9>"$directory/run.lock"
flock -n 9 || { echo 'Another fresh-zero deployment is running'; exit 1; }
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
echo 'Deploying on BNB Testnet 97. Maximum cumulative transaction fee: 0.1 test BNB.'
node --env-file=/etc/globaldroptrade/trades.env scripts/deploy-zero-start.mjs --execute "${profile_args[@]}"
