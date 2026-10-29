#!/usr/bin/env bash
# Read-only server evidence. Never reset, deploy, top up or sign transactions.
set +x
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$(id -u)" -eq 0 ] || { echo 'ROOT_REQUIRED'; exit 1; }
[ "$#" -eq 2 ] && [ "$1" = --wallet ] || { echo 'Usage: bash ubuntu-check-hourly-payments.sh --wallet 0xADDRESS'; exit 1; }
wallet=$2
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) exit 1;; esac
export PATH="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin:$PATH"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
node --input-type=module - "$wallet" <<'JS'
import {isAddress} from 'ethers';
if(!isAddress(process.argv[2]))throw Error('PUBLIC_WALLET_REQUIRED');
JS
for unit in globaldroptrade-zero-daily.timer globaldroptrade-zero-daily.service globaldroptrade-rpc-failover.timer; do
 echo "CHECK_UNIT=$unit"
 systemctl show "$unit" --property=ActiveState --property=SubState --property=UnitFileState --property=ExecMainStatus || echo 'UNIT_STATUS_UNAVAILABLE'
 done
python3 - <<'PY'
import hashlib,json,os,stat
from pathlib import Path
state=Path('/var/lib/globaldroptrade/fresh-fast-testnet-automation-v1')
fd=os.open(state/'journal.json',os.O_RDONLY|os.O_NOFOLLOW)
with os.fdopen(fd) as f:
 s=os.fstat(f.fileno())
 if not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_mode&0o077:raise SystemExit('PRIVATE_JOURNAL_REQUIRED')
 d=json.load(f).get('daily',{})
print('SAVED_PROGRESS='+json.dumps({'memberBlock':d.get('registry',{}).get('through'),'positionBlock':d.get('positionIndex',{}).get('through'),'targetBlock':d.get('positionScanTarget',{}).get('number'),'paidPositionHours':sum(d.get('positionPaid',{}).values())}))
for name in ('daily-profit.mjs','position-profit.mjs','zero-start-automation.mjs'):
 a=Path('scripts')/name;b=Path('/opt/globaldroptrade-zero-daily/current/scripts')/name
 print('WORKER_SOURCE_MATCH_'+name+'='+str(b.is_file() and hashlib.sha256(a.read_bytes()).digest()==hashlib.sha256(b.read_bytes()).digest()).lower())
PY
# The diagnostic clones planning state and never persists scan/payment changes.
if flock -w 15 -E 75 /var/lib/globaldroptrade/fresh-fast-testnet-automation-v1/run.lock \
 node scripts/diagnose-zero-profit.mjs --fast-testnet --wallet "$wallet"; then
 echo 'HOURLY_READ_ONLY_CHECK_COMPLETE: no transactions sent; live recurrence still requires consecutive receipts.'
else
 result=$?
 if [ "$result" -eq 75 ]; then echo 'HOURLY_CHECK_WORKER_BUSY: no running transaction was interrupted.'; fi
 exit "$result"
fi
