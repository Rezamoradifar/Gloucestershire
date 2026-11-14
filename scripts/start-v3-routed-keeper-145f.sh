#!/usr/bin/env bash
# Resume only the already installed routed V3 BNB Testnet keeper workflow.
# It does not redeploy the vault, pay withdrawals, or alter deposit routes.
set +x
set -Eeuo pipefail
umask 077
[[ $# -eq 0 ]] || { echo V3_KEEPER_ARGUMENTS_INVALID; exit 1; }
[[ "$(id -u)" == 0 ]] || { echo V3_KEEPER_ROOT_REQUIRED; exit 1; }
expected=145f90b247202e40e5a1b9fd0216ea3ac8716b31
release=''
for candidate in /opt/global-commerce.*; do
 [[ -d "$candidate/.git" ]] || continue
 [[ "$(git -C "$candidate" rev-parse HEAD 2>/dev/null)" == "$expected" ]] || continue
 git -C "$candidate" diff --quiet HEAD -- \
  scripts/install-global-v3-keeper-timer.sh scripts/global-v3-auto-compound-keeper.mjs \
  scripts/v3-keeper-receipt-poll.mjs scripts/verify-v3-site-deployment.mjs \
  scripts/verify-prior-v3-testnet-empty.mjs scripts/v3-release-profile.mjs \
  scripts/compile-global-v3.mjs contracts/v3 package.json package-lock.json || continue
 [[ -d "$candidate/node_modules/ethers" && -d "$candidate/node_modules/solc" ]] || continue
 release="$candidate"
 break
done
[[ -n "$release" ]] || { echo V3_KEEPER_REVIEWED_CHECKOUT_NOT_FOUND; exit 1; }
cd "$release"
case "$(uname -m)" in
 x86_64) arch=x64;;
 aarch64|arm64) arch=arm64;;
 *) echo V3_KEEPER_UNSUPPORTED_CPU; exit 1;;
esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
[[ ! -x "$runtime/node" ]] || export PATH="$runtime:$PATH"
timer=global-v3-routed-compound-keeper-testnet.timer
service=global-v3-routed-compound-keeper-testnet.service
if systemctl is-active --quiet "$timer"; then
 echo V3_ROUTED_KEEPER_TIMER_ALREADY_ACTIVE
 exit 0
fi
if systemctl cat "$timer" >/dev/null 2>&1 || systemctl cat "$service" >/dev/null 2>&1 || \
 [[ -e "/etc/systemd/system/$timer" || -L "/etc/systemd/system/$timer" || \
    -e "/etc/systemd/system/$service" || -L "/etc/systemd/system/$service" ]]; then
 echo V3_ROUTED_KEEPER_EXISTING_UNITS_REQUIRE_REVIEW
 exit 2
fi
site_file=/var/lib/globaldroptrade/v3-routed-testnet/site-install-unit
[[ -f "$site_file" && ! -L "$site_file" ]] || { echo V3_KEEPER_SITE_UNIT_MISSING; exit 1; }
site_unit=$(cat "$site_file")
[[ "$site_unit" =~ ^global-v3-site-[a-f0-9]{10}-[0-9]+\.service$ ]] || { echo V3_KEEPER_SITE_UNIT_INVALID; exit 1; }
journalctl -u "$site_unit" --no-pager -o cat | grep -Fx 'V3_TESTNET_PRIMARY_DASHBOARD_INSTALLED' >/dev/null || \
 { echo V3_KEEPER_SITE_INSTALL_NOT_CONFIRMED; exit 1; }
config=/etc/globaldroptrade/v3-routed-keeper-testnet.json
[[ -f "$config" && ! -L "$config" ]] || { echo V3_KEEPER_CONFIG_MISSING; exit 1; }
export GLOBAL_V3_RELEASE_PROFILE=routed-testnet
node scripts/verify-v3-site-deployment.mjs --check
bash scripts/install-global-v3-keeper-timer.sh --init-wallet
if output=$(bash scripts/install-global-v3-keeper-timer.sh --check 2>&1); then
 printf '%s\n' "$output"
else
 code=$?
 printf '%s\n' "$output"
 if [[ "$output" == *GAS_ONLY_KEEPER_HAS_TOO_LITTLE_TEST_BNB* ]]; then
  echo V3_ROUTED_KEEPER_WAITING_FOR_TESTNET_GAS
  exit 0
 fi
 echo V3_ROUTED_KEEPER_CHECK_FAILED
 exit "$code"
fi
bash scripts/install-global-v3-keeper-timer.sh --install
systemctl is-active --quiet "$timer" || { echo V3_ROUTED_KEEPER_TIMER_NOT_ACTIVE; exit 1; }
echo V3_ROUTED_KEEPER_TIMER_ACTIVE_FIRST_RUN_NOT_YET_CONFIRMED
