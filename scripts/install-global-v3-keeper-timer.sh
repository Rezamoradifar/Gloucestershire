#!/usr/bin/env bash
# V3 BNB TESTNET keeper only. Never deploy, change website, or transfer rewards.
set +x
set -Eeuo pipefail
umask 077
BASE="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
ETC_DIR=/etc/globaldroptrade
CONFIG="$ETC_DIR/v3-keeper-testnet.json"
KEY="$ETC_DIR/v3-keeper-testnet-gas-only.key"
UNIT=global-v3-compound-keeper-testnet
die(){ echo "V3_KEEPER_ERROR=$1" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die ROOT_REQUIRED_FOR_INSTALL
[[ $# -eq 1 ]] || die USAGE_INIT_WALLET_CHECK_INSTALL_OR_STATUS
mode=$1
case "$mode" in --init-wallet|--check|--install|--status) ;; *) die INVALID_MODE ;; esac
arch="$(uname -m)"
case "$arch" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) die UNSUPPORTED_ARCH ;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
[[ -x "$runtime/node" ]] && export PATH="$runtime:$PATH"
for item in node systemctl; do command -v "$item" >/dev/null || die "MISSING_$item"; done
node="$(command -v node)"
[[ -f "$BASE/scripts/global-v3-auto-compound-keeper.mjs" &&
   -f "$BASE/scripts/v3-keeper-receipt-poll.mjs" && -f "$BASE/package-lock.json" ]] ||
 die REVIEWED_V3_KEEPER_CHECKOUT_REQUIRED
cd "$BASE"
if [[ "$mode" == --status ]]; then
 systemctl status "$UNIT.timer" --no-pager -l || true
 journalctl -u "$UNIT.service" -n 40 --no-pager -o cat
 exit 0
fi
if [[ "$mode" == --init-wallet ]]; then
 [[ ! -L "$ETC_DIR" && ! -L "$KEY" ]] || die UNEXPECTED_SYMLINK
 if [[ ! -d "$ETC_DIR" ]]; then install -d -m 0700 "$ETC_DIR"; fi
 [[ "$(stat -Lc %u "$ETC_DIR")" == 0 ]] || die CONFIG_DIRECTORY_NOT_ROOT_OWNED
 if [[ ! -e "$KEY" ]]; then
  V3_KEY_PATH="$KEY" "$node" --input-type=module -e '
   import fs from "node:fs";
   import {Wallet} from "ethers";
   const wallet=Wallet.createRandom();
   fs.writeFileSync(process.env.V3_KEY_PATH,wallet.privateKey+"\n",{flag:"wx",mode:0o600});
  '
 else
  echo V3_KEEPER_EXISTING_KEY_PRESERVED
 fi
 "$node" scripts/global-v3-auto-compound-keeper.mjs --public-address --key-file "$KEY"
 echo V3_KEEPER_ADDRESS_IS_FOR_VALUELESS_TESTNET_GAS_ONLY_NOT_TREASURY
 echo V3_KEEPER_TIMER_INSTALLED=NO
 exit 0
fi
[[ -f "$CONFIG" && ! -L "$CONFIG" ]] || die MISSING_PINNED_V3_TESTNET_CONFIG
[[ -f "$KEY" && ! -L "$KEY" ]] || die MISSING_DEDICATED_GAS_ONLY_TESTNET_KEY
[[ "$(stat -Lc '%a:%u' "$KEY")" == '600:0' ]] || die TESTNET_KEY_MUST_BE_ROOT_0600
[[ "$(stat -Lc '%a:%u' "$CONFIG")" == '600:0' ]] || die V3_CONFIG_MUST_BE_ROOT_0600
# Read-only, but now also verifies signer roles, wallet tBNB, and pause state.
# No file is installed and no transaction is signed if readiness fails.
"$node" scripts/global-v3-auto-compound-keeper.mjs --check --config "$CONFIG" --key-file "$KEY"
echo V3_KEEPER_PREFLIGHT_PASS=YES
if [[ "$mode" == --check ]]; then
 echo V3_KEEPER_CHECK_DID_NOT_ENABLE_TIMER_OR_SEND_TRANSACTION
 exit 0
fi
for command in npm git flock systemd-analyze; do
 command -v "$command" >/dev/null || die "MISSING_$command"
done
exec 9>/run/lock/global-v3-compound-keeper-install.lock
flock -n 9 || die INSTALL_ALREADY_RUNNING
[[ ! -e "/etc/systemd/system/$UNIT.service" && ! -e "/etc/systemd/system/$UNIT.timer" ]] ||
 die KEEPER_TIMER_ALREADY_INSTALLED_REVIEW_BEFORE_UPGRADE
git -C "$BASE" diff --quiet HEAD -- scripts/global-v3-auto-compound-keeper.mjs \
 scripts/v3-keeper-receipt-poll.mjs scripts/install-global-v3-keeper-timer.sh package.json package-lock.json ||
 die LOCAL_KEEPER_CHANGES_REQUIRE_REVIEW
sha="$(git -C "$BASE" rev-parse HEAD)"
[[ "$sha" =~ ^[a-f0-9]{40}$ ]] || die INVALID_COMMIT_SHA
RELEASE="/opt/global-v3-testnet-keeper/releases/$sha"
stage=''; units=''
cleanup(){
 [[ -z "$stage" || ! -d "$stage" ]] || rm -rf -- "$stage"
 [[ -z "$units" || ! -d "$units" ]] || rm -rf -- "$units"
}
trap cleanup EXIT
install -d -m 0755 /opt/global-v3-testnet-keeper /opt/global-v3-testnet-keeper/releases
if [[ ! -e "$RELEASE" ]]; then
 stage="$(mktemp -d /opt/global-v3-testnet-keeper/releases/.staging.XXXXXX)"
 chmod 0755 "$stage"
 install -d -m 0755 "$stage/scripts"
 install -m 0644 scripts/global-v3-auto-compound-keeper.mjs scripts/v3-keeper-receipt-poll.mjs "$stage/scripts/"
 install -m 0644 package.json package-lock.json "$stage/"
 # The dynamic service user must read JS/dependencies. Never change key modes.
 (umask 022; cd "$stage"; npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
 chmod -R u+rwX,go+rX,go-w "$stage"
 "$node" --check "$stage/scripts/global-v3-auto-compound-keeper.mjs"
 mv -T "$stage" "$RELEASE"
 stage=''
else
 [[ -d "$RELEASE" && ! -L "$RELEASE" && "$(stat -Lc %u "$RELEASE")" == 0 ]] || die INVALID_EXISTING_RELEASE
 for file in scripts/global-v3-auto-compound-keeper.mjs scripts/v3-keeper-receipt-poll.mjs package.json package-lock.json; do
  cmp -s "$BASE/$file" "$RELEASE/$file" || die PINNED_KEEPER_RELEASE_MISMATCH
 done
fi
(cd "$RELEASE"; "$node" --input-type=module -e 'await import("./scripts/global-v3-auto-compound-keeper.mjs");')
units="$(mktemp -d /tmp/global-v3-keeper-units.XXXXXX)"
cat > "$units/$UNIT.service" <<EOF
[Unit]
Description=BNB Testnet V3 permissionless internal daily and compound credits
After=network-online.target
Wants=network-online.target
ConditionPathExists=$CONFIG
ConditionPathExists=$KEY

[Service]
Type=oneshot
DynamicUser=yes
WorkingDirectory=$RELEASE
ExecStart=$node $RELEASE/scripts/global-v3-auto-compound-keeper.mjs --run --config %d/keeper-config --key-file %d/keeper-gas-key
LoadCredential=keeper-config:$CONFIG
LoadCredential=keeper-gas-key:$KEY
StateDirectory=globaldroptrade-v3-keeper
StateDirectoryMode=0700
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
NoNewPrivileges=yes
LockPersonality=yes
RestrictSUIDSGID=yes
UMask=0077
TimeoutStartSec=1800
EOF
cat > "$units/$UNIT.timer" <<EOF
[Unit]
Description=Hourly BNB Testnet V3 eligible internal accrual check

[Timer]
OnCalendar=hourly
RandomizedDelaySec=2m
Persistent=true
Unit=$UNIT.service

[Install]
WantedBy=timers.target
EOF
systemd-analyze verify "$units/$UNIT.service" "$units/$UNIT.timer" || die UNITS_DID_NOT_VALIDATE
install -m 0644 "$units/$UNIT.service" "$units/$UNIT.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now "$UNIT.timer"
systemctl start --no-block "$UNIT.service"
echo "V3_AUTO_COMPOUND_KEEPER_TIMER_INSTALLED=$UNIT.timer"
echo "V3_PINNED_KEEPER_RELEASE=$sha"
echo V3_AUTO_COMPOUND_KEEPER_TESTNET_ONLY=TRUE
echo V3_ADMIN_APPROVAL_REQUIRED_FOR_ACCRUAL=FALSE
echo V3_KEEPER_MAY_ACCRUE_ONLY_IF_USER_CHECKIN_ELIGIBLE=TRUE
echo V3_FIRST_RUN_REQUESTED_NOT_YET_VERIFIED
echo "V3_KEEPER_LOG_COMMAND=journalctl -u $UNIT.service -n 60 --no-pager -o cat"
