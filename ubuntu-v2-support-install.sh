#!/usr/bin/env bash
# Add separately signed V2 support/announcement namespace to existing API.
# This changes code only; never deletes old vault records or user funds.
set +x
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "$0")"
[ "$(id -u)" -eq 0 ] || { echo V2_SUPPORT_ROOT_REQUIRED; exit 1; }
[ "$#" -eq 1 ] || { echo 'Usage: bash ubuntu-v2-support-install.sh --check|--install'; exit 1; }
case "$1" in --check|--install) mode="$1";; *) echo V2_SUPPORT_BAD_MODE; exit 1;; esac

expected=$(printenv GLOBAL_V2_EXPECTED_SHA || true)
[[ "$expected" =~ ^[0-9a-f]{40}$ ]] || { echo V2_SUPPORT_PINNED_RELEASE_REQUIRED; exit 1; }
[ "$(git rev-parse HEAD)" = "$expected" ] || { echo V2_SUPPORT_RELEASE_MISMATCH; exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo V2_SUPPORT_ARCH_UNSUPPORTED; exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
[ ! -x "$runtime/node" ] || export PATH="$runtime:$PATH"
for binary in node npm curl systemctl git readlink cp install python3 flock cmp mktemp; do
 command -v "$binary" >/dev/null || { echo "V2_SUPPORT_TOOL_MISSING:$binary"; exit 1; }
done
node --check server/trades-api.mjs
node --check server/community.mjs

# Install dependencies only to isolated reviewed checkout before preflight tests.
npm ci --ignore-scripts --no-audit --no-fund
node --test test/v2-community-isolation.test.mjs

live=/opt/globaldroptrade-api/current
old=$(readlink -f "$live")
unit=/etc/systemd/system/globaldroptrade-api.service
envfile=/etc/globaldroptrade/trades.env
[ -d "$old" ] && [ -f "$unit" ] && [ -f "$envfile" ] || {
 echo V2_SUPPORT_EXISTING_SERVICE_REQUIRED; exit 1;
}
systemctl is-active --quiet globaldroptrade-api || { echo V2_SUPPORT_API_NOT_ACTIVE; exit 1; }
node --env-file="$envfile" --input-type=module <<'NODE'
import {readConfig} from './server/trades-api.mjs';
const config=readConfig();
if(config.chainId!==97||config.port!==3115||
 config.address.toLowerCase()!=='0x4c0f6141b18971db4b14e45c0be8cddb09febc14')
 throw Error('OLD_VAULT_API_CONFIG_NOT_EXPECTED');
NODE

stage=$(mktemp -d /opt/v2-support-probe.XXXXXX)
trap 'rm -rf -- "$stage"' EXIT
curl -fsS --max-time 12 http://127.0.0.1:3115/api/health -o "$stage/health-before.json"
curl -fsS --max-time 12 http://127.0.0.1:3115/api/config -o "$stage/config-before.json"
echo V2_SUPPORT_PREFLIGHT_OK
if [ "$mode" = --check ]; then
 echo 'No server files, support database or old ledger were changed.'
 exit 0
fi

lockdir=/var/lib/globaldroptrade-api/v2-support-deploy
install -d -m 700 "$lockdir"
exec 9>"$lockdir/installer.lock"
flock -n 9 || { echo V2_SUPPORT_ROLLOUT_ALREADY_ACTIVE; exit 1; }
install -d -m 700 /var/backups/globaldroptrade
backup="/var/backups/globaldroptrade/v2-support-$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -m 700 "$backup"
cp -p "$unit" "$backup/api.service"
printf '%s\n' "$old" > "$backup/old-api-path.txt"
cp -p "$stage/config-before.json" "$backup/config-before.json"
changed=0
rollback(){
 local failed=0
 if [ "$changed" -eq 1 ]; then
  ln -sfn "$old" "$live" || failed=1
  cp -p "$backup/api.service" "$unit" || failed=1
  systemctl daemon-reload || failed=1
  systemctl restart globaldroptrade-api || failed=1
  curl -fsS --max-time 12 http://127.0.0.1:3115/api/health -o /dev/null || failed=1
 fi
 if [ "$failed" -ne 0 ]; then
  echo "V2_SUPPORT_ROLLBACK_MANUAL_REVIEW_REQUIRED:$backup" >&2
  return 1
 fi
 echo "V2_SUPPORT_ROLLBACK_OK:$backup"
}
failed(){
 local code=$?
 trap - EXIT
 rollback || code=1
 rm -rf -- "$stage"
 exit "$code"
}
trap - EXIT
trap failed EXIT
changed=1

# Existing installer builds and manages an atomic versioned API release.
# It never modifies the website, nginx, trading RPC config, or blockchain.
bash ubuntu-api.sh

curl -fsS --max-time 12 http://127.0.0.1:3115/api/config -o "$stage/config-after.json"
cmp -s "$stage/config-before.json" "$stage/config-after.json" || {
 echo V2_SUPPORT_OLD_API_CONFIG_UNEXPECTEDLY_CHANGED; exit 1;
}
curl -fsS --max-time 12 http://127.0.0.1:3115/api/v2/community/announcements \
 -o "$stage/v2-announcements.json"
curl -fsS --max-time 12 -X POST http://127.0.0.1:3115/api/v2/community/challenge \
 -H 'Content-Type: application/json' \
 --data '{"wallet":"0x1111111111111111111111111111111111111111"}' \
 -o "$stage/v2-challenge.json"

python3 - "$stage/v2-announcements.json" "$stage/v2-challenge.json" <<'PY'
import json,sys
ann=json.load(open(sys.argv[1]))
challenge=json.load(open(sys.argv[2]))
if not isinstance(ann.get('items'),list):
 raise SystemExit('V2_SUPPORT_ANNOUNCEMENTS_INVALID')
message=challenge.get('message','')
if ('Chain: 97' not in message or
 'Contract: 0xA98D8d3709f5D3730BAD5d76C334731784e7CF07' not in message or
 'Nonce: ' not in message or '0x4C0F6141' in message):
 raise SystemExit('V2_SUPPORT_SIGN_IN_IDENTITY_MISMATCH')
PY

changed=0
trap - EXIT
rm -rf -- "$stage"
echo V2_SUPPORT_ONLY_INSTALLED
echo "RELEASE_SHA=$expected"
echo "BACKUP_PATH=$backup"
echo 'Old contract, financial history, signer keys and other user data remain unchanged.'
