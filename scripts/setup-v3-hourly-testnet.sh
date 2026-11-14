#!/usr/bin/env bash
# Separate BNB Testnet-only one-hour lab. Never replace the existing contract,
# website, data, key or keeper. The operator signs only testnet deployment.
set +x
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "$0")/.."
[[ "$(id -u)" -eq 0 && $# -eq 1 ]] || { echo V3_HOURLY_ROOT_AND_MODE_REQUIRED; exit 1; }
case "$1" in --prepare|--start-keeper|--status) ;; *) echo V3_HOURLY_INVALID_MODE; exit 1 ;; esac
mode=$1
case "$(uname -m)" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) echo V3_HOURLY_UNSUPPORTED_ARCH; exit 1 ;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
[[ -x "$runtime/node" ]] && export PATH="$runtime:$PATH"
for command in node npm git systemctl journalctl systemd-run; do
 command -v "$command" >/dev/null || { echo "V3_HOURLY_MISSING_$command"; exit 1; }
done
[[ -d .git ]] || { echo V3_HOURLY_REVIEWED_CHECKOUT_REQUIRED; exit 1; }
sha="$(git rev-parse HEAD)"
[[ "$sha" =~ ^[a-f0-9]{40}$ ]] || { echo V3_HOURLY_INVALID_SHA; exit 1; }
export GLOBAL_V3_RELEASE_PROFILE=hourly-testnet
proof=/var/lib/globaldroptrade/v3-hourly-testnet/deployment.json
site_unit_file=/var/lib/globaldroptrade/v3-hourly-testnet/site-install-unit
keeper=global-v3-hourly-compound-keeper-testnet
if [[ "$mode" == --status ]]; then
 echo '=== HOURLY TESTNET WEBSITE ==='
 if [[ -f "$site_unit_file" && ! -L "$site_unit_file" ]]; then
  unit="$(cat "$site_unit_file")"
  if [[ "$unit" =~ ^global-v3-hourly-site-[a-f0-9]{10}-[0-9]+\.service$ ]]; then
   systemctl show "$unit" -p ActiveState -p Result -p ExecMainStatus --no-pager || true
   journalctl -u "$unit" -n 35 --no-pager -o cat || true
  else echo V3_HOURLY_SITE_UNIT_INVALID; fi
 else echo V3_HOURLY_SITE_NOT_STARTED; fi
 echo '=== HOURLY TESTNET KEEPER ==='
 systemctl is-enabled "$keeper.timer" 2>/dev/null || true
 systemctl is-active "$keeper.timer" 2>/dev/null || true
 journalctl -u "$keeper.service" -n 35 --no-pager -o cat || true
 exit 0
fi
if [[ "$mode" == --start-keeper ]]; then
 if systemctl is-enabled "$keeper.timer" >/dev/null 2>&1; then
  if systemctl is-active --quiet "$keeper.timer"; then
   echo V3_HOURLY_KEEPER_ALREADY_ENABLED_AND_ACTIVE
   exit 0
  fi
  echo V3_HOURLY_KEEPER_ENABLED_BUT_INACTIVE_REVIEW
  exit 1
 fi
 [[ -f "$site_unit_file" && ! -L "$site_unit_file" ]] ||
  { echo V3_HOURLY_SITE_NOT_YET_CONFIRMED; exit 1; }
 site_unit="$(cat "$site_unit_file")"
 [[ "$site_unit" =~ ^global-v3-hourly-site-[a-f0-9]{10}-[0-9]+\.service$ ]] ||
  { echo V3_HOURLY_SITE_UNIT_INVALID; exit 1; }
 journalctl -u "$site_unit" --no-pager -o cat | grep -Fx \
  'V3_HOURLY_TESTNET_SITE_INSTALLED=https://globaldroptrade.com/hourly-test/' >/dev/null ||
  { echo V3_HOURLY_SITE_NOT_YET_CONFIRMED; exit 1; }
 bash scripts/install-global-v3-keeper-timer.sh --check
 bash scripts/install-global-v3-keeper-timer.sh --install
 echo V3_HOURLY_KEEPER_STARTED_VERIFY_JOURNAL
 exit 0
fi

[[ -t 0 && -t 1 ]] || { echo V3_HOURLY_DEPLOY_REQUIRES_INTERACTIVE_TERMINAL; exit 1; }
npm ci --ignore-scripts --no-audit --no-fund
if [[ -e "$proof" || -L "$proof" ]]; then
 [[ -f "$proof" && ! -L "$proof" ]] || { echo V3_HOURLY_PROOF_NOT_REGULAR; exit 1; }
 node scripts/verify-v3-hourly-testnet.mjs --check
 echo V3_HOURLY_EXISTING_DEPLOYMENT_VERIFIED_NO_REDEPLOY
else
 node scripts/deploy-global-v3-hourly-testnet.mjs --check-old-testnet-deployer
 node scripts/deploy-global-v3-hourly-testnet.mjs --deploy-old-testnet-deployer
 node scripts/verify-v3-hourly-testnet.mjs --check
fi
bash scripts/install-global-v3-keeper-timer.sh --init-wallet
if [[ -f "$site_unit_file" && ! -L "$site_unit_file" ]]; then
 oldunit="$(cat "$site_unit_file")"
 [[ "$oldunit" =~ ^global-v3-hourly-site-[a-f0-9]{10}-[0-9]+\.service$ ]] ||
  { echo V3_HOURLY_SITE_UNIT_INVALID; exit 1; }
 if journalctl -u "$oldunit" --no-pager -o cat | grep -Fx \
   'V3_HOURLY_TESTNET_SITE_INSTALLED=https://globaldroptrade.com/hourly-test/' >/dev/null; then
  echo V3_HOURLY_SITE_INSTALL_PREVIOUSLY_CONFIRMED
  exit 0
 fi
 state="$(systemctl show "$oldunit" -p ActiveState --value 2>/dev/null || true)"
 if [[ "$state" == active || "$state" == activating ]]; then
  echo "V3_HOURLY_SITE_INSTALL_ALREADY_RUNNING=$oldunit"
  exit 0
 fi
 echo V3_HOURLY_PREVIOUS_SITE_INSTALL_REQUIRES_REVIEW
 exit 1
fi
unit="global-v3-hourly-site-$(printf %.10s "$sha")-$(date -u +%s)"
systemd-run --unit="$unit" --collect --property=TimeoutStartSec=3600 \
 /bin/bash "$PWD/scripts/install-v3-hourly-testnet-site.sh" --install
printf '%s.service\n' "$unit" > "$site_unit_file"
chmod 600 "$site_unit_file"
echo "V3_HOURLY_SITE_SERVICE_STARTED=$unit.service"
echo V3_HOURLY_SITE_STARTED_NOT_YET_CONFIRMED
echo V3_HOURLY_NEW_KEEPER_REQUIRES_TESTNET_GAS_IF_UNFUNDED
echo 'V3_HOURLY_STATUS_COMMAND=bash scripts/setup-v3-hourly-testnet.sh --status'
