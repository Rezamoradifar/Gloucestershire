#!/usr/bin/env bash
# Verified, signer-free GlobalDropTrade acceptance checks.
# Never starts the reward worker, resets journals, deploys contracts, or pays users.
set +x
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if [ "$#" -ne 1 ]; then echo 'Usage: bash ubuntu-global-complete-readiness.sh --local|--live-readonly'; exit 1; fi
mode="$1"
case "$mode" in --local|--live-readonly) ;; *) echo 'GLOBAL_READINESS_MODE_REQUIRED'; exit 1;; esac
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo 'GLOBAL_UNSUPPORTED_ARCH'; exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ]; then export PATH="$runtime:$PATH"; fi
for tool in node npm python3; do command -v "$tool" >/dev/null || { echo "GLOBAL_TOOL_MISSING_$tool"; exit 1; }; done

if [ "$mode" = --local ]; then
 echo 'GLOBAL_LOCAL_TESTS_START'
 npm ci --ignore-scripts --no-audit --no-fund
 npm run compile
 npm run compile:fresh
 npm run compile:fast-testnet
 node --test --test-concurrency=1 \
  test/new-deployer-testnet-index-catchup.test.mjs \
  test/new-deployer-testnet-automation.test.mjs \
  test/daily-profit-referrals.test.mjs \
  test/new-user-diagnostic-rpc.test.mjs \
  test/new-user-testnet-diagnostic.test.mjs \
  test/configure-testnet-rpc-fallbacks.test.mjs \
  test/testnet-zero-v2-deploy.test.mjs \
  test/testnet-zero-v2-preflight.test.mjs \
  test/testnet-zero-v2-wrapper.test.mjs \
  test/testnet-withdrawal-audit.test.mjs \
  test/check-live-worker-index.test.mjs \
  test/global-consolidated-readiness.test.mjs \
  test/history-relay.test.mjs \
  test/event-history-rpc-installer.test.mjs
 npm ci --prefix website --ignore-scripts --no-audit --no-fund
 npm test --prefix website -- --run \
  tests/referral-invite.test.ts tests/server-event-history.test.ts
 npm run build --prefix website
 echo 'GLOBAL_LOCAL_ACCEPTANCE_TEST_PASS'
 echo 'No blockchain transactions were signed by this local acceptance suite.'
 exit 0
fi

[ "$(id -u)" -eq 0 ] || { echo 'GLOBAL_READONLY_ROOT_REQUIRED'; exit 1; }
for tool in curl systemctl; do command -v "$tool" >/dev/null || { echo "GLOBAL_TOOL_MISSING_$tool"; exit 1; }; done
echo 'GLOBAL_LIVE_READONLY_START'
node --env-file=/etc/globaldroptrade/trades.env --input-type=module <<'JS'
import {readConfig} from './server/trades-api.mjs';
const config=readConfig();
if(config.chainId!==97||config.address?.toLowerCase()!=='0x4c0f6141b18971db4b14e45c0be8cddb09febc14')
 throw Error('GLOBAL_LIVE_VAULT_MISMATCH');
console.log(JSON.stringify({network:'BNB_TESTNET',chainId:97,primaryRpcConfigured:!!config.rpcUrl,
 totalRpcCandidates:config.rpcUrls.length,contractPinned:true}));
JS

for name in globaldroptrade-api.service globaldroptrade-new-deployer-daily.timer; do
 if systemctl is-active --quiet "$name"; then echo "SERVICE_ACTIVE $name"; else echo "SERVICE_NOT_ACTIVE $name"; exit 1; fi
done

tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
curl -fsS --max-time 20 http://127.0.0.1:3115/api/health -o "$tmp/health.json"
curl -fsS --max-time 20 http://127.0.0.1:3115/api/config -o "$tmp/config.json"
curl -fsS --max-time 20 http://127.0.0.1:3115/api/automation/status -o "$tmp/automation.json"
curl -fsS --max-time 25 \
 'http://127.0.0.1:3115/api/event-history/window?wallet=0x786eBc9EA12ED00616E538DD35A78dC8E12FFDF6&asset=0x0000000000000000000000000000000000000000&scope=wallet&kind=finance' \
 -o "$tmp/history.json"

python3 - "$tmp" <<'PY'
import json,sys,pathlib
path=pathlib.Path(sys.argv[1])
get=lambda file:json.loads((path/file).read_text())
health,conf,automation,history=map(get,['health.json','config.json','automation.json','history.json'])
target='0x4c0f6141b18971db4b14e45c0be8cddb09febc14'
if health.get('status')!='ok' or not health.get('configured'):
 raise SystemExit('GLOBAL_API_HEALTH_FAILED')
if conf.get('chainId')!=97 or str(conf.get('vaultAddress','')).lower()!=target:
 raise SystemExit('GLOBAL_PUBLIC_API_TARGET_CHANGED')
if automation.get('chainId')!=97 or str(automation.get('vaultAddress',automation.get('target',''))).lower()!=target:
 raise SystemExit('GLOBAL_AUTOMATION_IDENTITY_CHANGED')
if automation.get('blockers'):
 raise SystemExit('GLOBAL_AUTOMATION_BLOCKED')
if automation.get('dailyStatus') not in ('ready','credited','scheduled','not_due'):
 raise SystemExit('GLOBAL_DAILY_NOT_READY')
if history.get('chainId')!=97 or str(history.get('vaultAddress','')).lower()!=target or not isinstance(history.get('confirmedHead'),int):
 raise SystemExit('GLOBAL_HISTORY_NOT_INSTALLED_OR_INVALID')
print('GLOBAL_HISTORY_API_READONLY_PASS')
print('GLOBAL_AUTOMATION_NO_BLOCKERS')
print('GLOBAL_LAST_PROCESSED_CREDIT_EPOCH', (automation.get('lastCredit') or {}).get('epoch'))
PY

echo 'GLOBAL_CHECK: deployed worker code and live financial cursors'
node scripts/check-live-worker-index.mjs
echo 'GLOBAL_CHECK: RPC archive doctor'
node scripts/testnet-rpc-doctor.mjs
echo 'GLOBAL_CHECK: latest five distinct new depositors'
node scripts/diagnose-new-user-testnet.mjs 5
echo 'GLOBAL_CHECK: actual owner-approved withdrawal queue and cash'
node scripts/testnet-withdrawal-audit.mjs
echo 'GLOBAL_CHECK: V1 obligations before any V2 change'
node scripts/preflight-testnet-zero-v2.mjs --check

echo 'GLOBAL_LIVE_READONLY_PASS'
echo 'Profit remains an internal accounting credit until an approved, funded withdrawal is paid.'
echo 'V2 deployment, cutover, mainnet transfers, manual credits and reindexing writes were NOT performed.'
