#!/usr/bin/env bash
# Final Global BNB Testnet gate. Local E2E + live read-only verification only.
set +x
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

expected_target="0x4C0F6141b18971db4b14e45c0bE8CddB09febc14"
mode="${1:---all}"
case "$mode" in --local|--live-readonly|--all) ;; *) echo 'Usage: bash ubuntu-final-testnet-e2e.sh --local|--live-readonly|--all'; exit 1;; esac

local_gate(){
  echo 'FINAL_TESTNET_GATE phase=LOCAL_E2E'
  command -v node >/dev/null
  command -v npm >/dev/null
  npm ci --ignore-scripts --no-audit --no-fund
  npm run compile:new-deployer-testnet
  node --test --test-concurrency=1 \
    test/new-deployer-testnet-automation.test.mjs \
    test/new-deployer-testnet-index-catchup.test.mjs \
    test/split-position-index.test.mjs \
    test/new-deployer-testnet-deploy-wrapper.test.mjs \
    test/final-testnet-gate.test.mjs
  echo 'FINAL_TESTNET_LOCAL_E2E_PASS'
}

live_gate(){
  echo 'FINAL_TESTNET_GATE phase=LIVE_READ_ONLY'
  command -v curl >/dev/null
  command -v python3 >/dev/null
  temporary=$(mktemp -d)
  trap 'rm -rf -- "$temporary"' RETURN

  curl --fail-with-body --silent --show-error --max-time 20 \
    https://globaldroptrade.com/api/health > "$temporary/health.json"
  curl --fail-with-body --silent --show-error --max-time 20 \
    https://globaldroptrade.com/api/config > "$temporary/config.json"
  curl --fail-with-body --silent --show-error --max-time 20 \
    https://globaldroptrade.com/api/automation/status > "$temporary/automation.json"

  python3 - "$temporary/config.json" "$temporary/automation.json" "$expected_target" <<'PY'
import json,sys
config_file,status_file,expected=sys.argv[1:]
with open(config_file) as f: config=json.load(f)
with open(status_file) as f: status=json.load(f)
if not isinstance(config,dict) or config.get('chainId') != 97:
    raise SystemExit('FINAL_TESTNET_CONFIG_CHAIN_REQUIRED')
target=config.get('vaultAddress') or config.get('address') or config.get('target')
if not isinstance(target,str) or target.lower()!=expected.lower():
    raise SystemExit('FINAL_TESTNET_CONFIG_TARGET_REQUIRED')
if not isinstance(status,dict) or status.get('chainId') != 97:
    raise SystemExit('FINAL_TESTNET_AUTOMATION_CHAIN_REQUIRED')
status_target=status.get('vaultAddress') or status.get('address') or status.get('target')
if not isinstance(status_target,str) or status_target.lower()!=expected.lower():
    raise SystemExit('FINAL_TESTNET_AUTOMATION_TARGET_REQUIRED')
allowed={'waiting','running','credited','ready','indexing','scheduled','not_due','processed'}
if status.get('status') not in allowed:
    raise SystemExit('FINAL_TESTNET_AUTOMATION_STATUS_REQUIRED')
blockers=status.get('blockers',[])
if not isinstance(blockers,list) or any(not isinstance(x,str) for x in blockers):
    raise SystemExit('FINAL_TESTNET_BLOCKERS_INVALID')
last=status.get('lastCredit')
if last is not None:
    if not isinstance(last,dict) or not isinstance(last.get('batches'),list):
        raise SystemExit('FINAL_TESTNET_LAST_CREDIT_INVALID')
    for row in last['batches']:
        h=row.get('transactionHash') if isinstance(row,dict) else None
        if not isinstance(h,str) or len(h)!=66 or not h.startswith('0x'):
            raise SystemExit('FINAL_TESTNET_LAST_CREDIT_INVALID')
print(json.dumps({
  'version':1,
  'chainId':97,
  'target':target,
  'automationStatus':status.get('status'),
  'blockers':blockers,
  'lastCreditPresent':last is not None
},separators=(',',':')))
PY

  catchup=/var/lib/globaldroptrade/new-deployer-testnet-automation-v1/index-catchup-status.json
  if [ -f "$catchup" ]; then
    python3 - "$catchup" "$expected_target" <<'PY'
import json,sys
file,expected=sys.argv[1:]
with open(file) as f: value=json.load(f)
if value.get('chainId')!=97 or str(value.get('target','')).lower()!=expected.lower():
    raise SystemExit('FINAL_TESTNET_CATCHUP_IDENTITY_REQUIRED')
if value.get('status')!='indexed':
    raise SystemExit('FINAL_TESTNET_CATCHUP_NOT_COMPLETE')
if value.get('transactionsSent')!=0 or value.get('signerOpened') is not False:
    raise SystemExit('FINAL_TESTNET_CATCHUP_MUST_BE_SIGNER_FREE')
print('FINAL_TESTNET_INDEX_CATCHUP_PASS')
PY
  else
    echo 'FINAL_TESTNET_CATCHUP_STATUS_MISSING'
    exit 1
  fi

  if command -v systemctl >/dev/null && [ -d /run/systemd/system ]; then
    systemctl is-active --quiet globaldroptrade-new-deployer-daily.timer || {
      echo 'FINAL_TESTNET_TIMER_NOT_ACTIVE'
      exit 1
    }
    echo 'FINAL_TESTNET_TIMER_ACTIVE'
  fi
  echo 'FINAL_TESTNET_LIVE_READ_ONLY_PASS'
}

case "$mode" in
  --local) local_gate;;
  --live-readonly) live_gate;;
  --all) local_gate; live_gate;;
esac

echo 'FINAL_TESTNET_GATE_PASS'
echo 'No public-chain user transaction was signed or sent by this gate.'
