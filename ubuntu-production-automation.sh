#!/usr/bin/env bash
# Separate production runtime. Requires an independently verified deployed contract.
set +x
set -Eeuo pipefail
umask 077
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
action=${1:---check}
manifest=${2:-/etc/globaldroptrade/mainnet-automation.json}
[[ $# -le 2 && "$manifest" = /* && ( "$action" = --check || "$action" = --install ) ]] || { echo 'Usage: bash ubuntu-production-automation.sh --check|--install [PRIVATE_ACTIVATION_JSON]'; exit 1; }
[[ $EUID = 0 ]] || { echo 'ROOT_REQUIRED'; exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
[[ -x "$runtime/node" ]] || { echo 'MANAGED_NODE_RUNTIME_REQUIRED'; exit 1; }
export PATH="$runtime:$PATH"
cd -- "$source_dir"
if [[ "$action" = --check ]]; then
 npm ci --omit=dev --ignore-scripts --no-audit --no-fund
 exec node scripts/production-automation-cli.mjs --check --activation-file "$manifest"
fi
# This installer never stops a running financial worker or restores its journal.
install -d -m 700 /var/lib/globaldroptrade/mainnet-automation-v1
exec 9>/var/lib/globaldroptrade/mainnet-automation-v1/install.lock
flock -n 9 || { echo 'PRODUCTION_INSTALL_BUSY'; exit 1; }
if systemctl is-active --quiet globaldroptrade-mainnet.service; then echo 'PRODUCTION_WORKER_BUSY'; exit 1; fi
install -d -m 755 /opt/globaldroptrade-mainnet-automation/releases
release=$(mktemp -d /opt/globaldroptrade-mainnet-automation/releases/release.XXXXXXXX)
chmod 755 "$release"
tar --exclude='__pycache__' -cf - scripts server artifacts contracts config.mainnet.json package.json package-lock.json | tar -xf - -C "$release"
cd -- "$release"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
node scripts/production-automation-cli.mjs --check --activation-file "$manifest" > "$release/preflight.json"
# Check the manifest and dedicated operator key only after read-only chain proof.
role=$(node --input-type=module - "$manifest" "$release/preflight.json" <<'JS'
import fs from 'node:fs';import {Wallet} from 'ethers';
import {validateProductionActivation} from './scripts/production-automation-cli.mjs';
import {readPrivateKey} from './scripts/migration-signers.mjs';
const file=process.argv[2],m=validateProductionActivation(JSON.parse(fs.readFileSync(file)));
const lines=fs.readFileSync(process.argv[3],'utf8').trim().split('\n'),r=JSON.parse(lines.at(-1));
if(r.chainId!==56||r.dryRun!==true)throw Error('PRODUCTION_PREFLIGHT_REQUIRED');
if(m.role==='primary'){
 if(fs.readFileSync('/etc/machine-id','utf8').trim()!==m.executionMachineId)throw Error('PRODUCTION_PRIMARY_HOST_REQUIRED');
 if(!r.reporterAuthorized||BigInt(r.operatorGasWei)<=0n)throw Error('PRODUCTION_REPORTER_AND_GAS_REQUIRED');
 const key=readPrivateKey('/etc/globaldroptrade/mainnet-automation.key');
 if(!key||new Wallet(key).address!==m.operator)throw Error('PRODUCTION_OPERATOR_KEY_MISMATCH');
}
console.log(m.role);
JS
)
# Store the exact activation path in a private systemd argument file using safe quoting.
python3 - "$manifest" "$release" <<'PY'
import json,sys
from pathlib import Path
manifest,backup=sys.argv[1:]
# The path is embedded in systemd syntax; reject control characters and specifiers.
if any(ord(c)<32 or c in '%$"\\' for c in manifest): raise ValueError('SAFE_ACTIVATION_PATH_REQUIRED')
Path(backup,'activation-path').write_text(manifest+'\n')
PY
# Timer changes happen only after all preparation succeeds.
was_enabled=false
systemctl is-enabled --quiet globaldroptrade-mainnet.timer && was_enabled=true
systemctl stop globaldroptrade-mainnet.timer 2>/dev/null || true
if systemctl is-active --quiet globaldroptrade-mainnet.service; then
 if $was_enabled; then systemctl start globaldroptrade-mainnet.timer; fi
 echo 'PRODUCTION_WORKER_BUSY'; exit 1
fi
backup=$(mktemp -d /var/lib/globaldroptrade/mainnet-automation-v1/install.XXXXXXXX)
for unit in globaldroptrade-mainnet.service globaldroptrade-mainnet.timer; do
 if [[ -f /etc/systemd/system/$unit ]]; then cp -p "/etc/systemd/system/$unit" "$backup/$unit"; fi
done
if [[ -L /opt/globaldroptrade-mainnet-automation/current ]]; then readlink /opt/globaldroptrade-mainnet-automation/current > "$backup/previous-release"; fi
mode=--check
[[ "$role" = primary ]] && mode=--execute
cat > /etc/systemd/system/globaldroptrade-mainnet.service <<UNIT
[Unit]
Description=Global production funded profit and owner-approved withdrawal worker
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=root
UMask=0077
WorkingDirectory=/opt/globaldroptrade-mainnet-automation/current
ExecStart=$runtime/node /opt/globaldroptrade-mainnet-automation/current/scripts/production-automation-cli.mjs $mode --activation-file "$manifest"
TimeoutStartSec=infinity
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/globaldroptrade/mainnet-automation-v1
UNIT
cat > /etc/systemd/system/globaldroptrade-mainnet.timer <<'UNIT'
[Unit]
Description=Run Global production automation independently of SSH sessions
[Timer]
OnBootSec=60s
OnUnitInactiveSec=5min
AccuracySec=10s
Unit=globaldroptrade-mainnet.service
[Install]
WantedBy=timers.target
UNIT
ln -s "$release" /opt/globaldroptrade-mainnet-automation/current.next
mv -Tf /opt/globaldroptrade-mainnet-automation/current.next /opt/globaldroptrade-mainnet-automation/current
systemctl daemon-reload
systemctl enable --now globaldroptrade-mainnet.timer
# The enabled timer may start its first run immediately if the boot delay elapsed.
echo "PRODUCTION_RUNTIME_INSTALLED role=$role backup=$backup"
echo 'Owner capital authority is unchanged. Standby uses read-only checks; no automatic writer promotion.'
