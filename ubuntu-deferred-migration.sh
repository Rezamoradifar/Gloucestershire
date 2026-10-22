#!/usr/bin/env bash
# Install a read-only index and wallet console. Never deploy, pause or change the active vault.
set +x
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ]; then export PATH="$runtime:$PATH"; fi
for tool in node npm python3 systemctl flock nginx; do command -v "$tool" >/dev/null; done
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12))throw Error("Node 22.12+ required")'
envfile=/etc/globaldroptrade/trades.env
test -s "$envfile"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
node --env-file="$envfile" --input-type=module - <<'JS'
import {FetchRequest,JsonRpcProvider} from 'ethers';
import {readConfig} from './server/trades-api.mjs';
import {deferredPolicy,guardDeferredSource} from './scripts/deferred-migration-core.mjs';
let p;
try{
 const c=readConfig();if(c.chainId!==97||c.address!==deferredPolicy.source||!c.rpcUrl)throw Error('EXISTING_LEGACY_TESTNET_TARGET_REQUIRED');
 const r=new FetchRequest(c.rpcUrl);r.timeout=12000;p=new JsonRpcProvider(r,97,{staticNetwork:true,batchMaxCount:1});
 await guardDeferredSource(p);console.log('LEGACY_TARGET_VERIFIED_NO_CHAIN_WRITE');
}catch{console.error('SOURCE_VERIFICATION_FAILED: existing configuration unchanged');process.exitCode=1;}finally{p?.destroy();}
JS
GLOBAL_SKIP_AUTOMATION=1 bash ubuntu-unified.sh
python3 scripts/install-deferred-console.py
private=/var/lib/globaldroptrade/deferred-migration-index
public=/var/www/globaldroptrade/migration-data
node --input-type=module - "$private" "$public" <<'JS'
import fs from 'node:fs';
for(const [folder,mode]of [[process.argv[2],0o700],[process.argv[3],0o755]]){
 fs.mkdirSync(folder,{recursive:true,mode});const s=fs.lstatSync(folder);
 if(!s.isDirectory()||s.uid!==0||(s.mode&0o022)!==0||(mode===0o700&&(s.mode&0o077)!==0))throw Error('UNSAFE_MIGRATION_INDEX_DIRECTORY');
}
const lock=process.argv[2]+'/run.lock';if(fs.existsSync(lock)){const s=fs.lstatSync(lock);if(!s.isFile()||s.uid!==0||(s.mode&0o077)!==0)throw Error('UNSAFE_INDEX_LOCK');}
JS
base=/opt/globaldroptrade-migration-index
status=$(systemctl show --property=ActiveState --value globaldroptrade-deferred-index.service 2>/dev/null || true)
if [ "$status" != active ] && [ "$status" != activating ]; then
 release="$base/releases/$(date -u +%Y%m%dT%H%M%S)-$$"
 install -d -m 755 "$release/scripts"
 cp scripts/deferred-migration-core.mjs scripts/export-deferred-seed.mjs scripts/migration-journal.mjs "$release/scripts/"
 cp package.json package-lock.json "$release/"
 (cd "$release" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
 node_bin=$(command -v node)
 case "$node_bin" in /root/*) echo 'System-readable Node runtime required'; exit 1;; esac
 ln -sfn "$release" "$base/current"
 cat > /etc/systemd/system/globaldroptrade-deferred-index.service <<EOF
[Unit]
Description=Read-only Global testnet account and settlement event index
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=root
WorkingDirectory=$base/current
EnvironmentFile=$envfile
ExecStart=/usr/bin/flock -n $private/run.lock $node_bin $base/current/scripts/export-deferred-seed.mjs
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$private $public
UMask=0077
TimeoutStartSec=45min
EOF
 systemctl daemon-reload
 systemctl start --no-block globaldroptrade-deferred-index.service
fi
echo 'DEFERRED_MIGRATION_TOOLS_READY'
echo 'https://globaldroptrade.com/deploy/deferred-migration.html'
echo 'Event index runs in the background: journalctl -u globaldroptrade-deferred-index.service -n 20 --no-pager'
echo 'No blockchain transaction sent. Existing accounts, active vault and TLS were preserved.'
