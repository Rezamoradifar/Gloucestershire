#!/usr/bin/env bash
# TESTNET-only, gas-only permissionless V3 auto-accrual service.
# No V3 deployment, mainnet activation, real fund access or wallet balance mint.
set -Eeuo pipefail
set +x
umask 077
BASE="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
ETC_DIR=/etc/globaldroptrade
CONFIG="$ETC_DIR/v3-keeper-testnet.json"
KEY="$ETC_DIR/v3-keeper-testnet-gas-only.key"
UNIT=global-v3-compound-keeper-testnet
STATE=globaldroptrade-v3-keeper
RELEASE_ROOT=/opt/global-v3-testnet-keeper
PROFILE_LINE=
case "${GLOBAL_V3_RELEASE_PROFILE:-}" in
 '') ;;
 routed-testnet)
  CONFIG="$ETC_DIR/v3-routed-keeper-testnet.json"
  KEY="$ETC_DIR/v3-routed-keeper-testnet-gas-only.key"
  UNIT=global-v3-routed-compound-keeper-testnet
  STATE=globaldroptrade-v3-routed-keeper
  RELEASE_ROOT=/opt/global-v3-routed-testnet-keeper
  PROFILE_LINE='Environment=GLOBAL_V3_RELEASE_PROFILE=routed-testnet'
  ;;
 *) echo V3_KEEPER_ERROR=V3_RELEASE_PROFILE_INVALID >&2; exit 1 ;;
esac
die(){ echo "V3_KEEPER_ERROR=$1" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "ROOT_REQUIRED_FOR_INSTALL"
[[ "$#" -eq 1 ]] || die "USAGE_INIT_WALLET_CHECK_INSTALL_OR_STATUS"
mode=$1
case "$mode" in
 --init-wallet|--check|--install|--status) ;;
 *) die "USAGE_INIT_WALLET_CHECK_INSTALL_OR_STATUS" ;;
esac
for item in node systemctl; do
 command -v "$item" >/dev/null || die "MISSING_$item"
done
node="$(command -v node)"
[[ -f "$BASE/scripts/global-v3-auto-compound-keeper.mjs" && -f "$BASE/package.json" ]] ||
 die "RUN_FROM_FULL_V3_REPOSITORY_CHECKOUT"
if [[ "$mode" == --init-wallet ]]; then
 [[ ! -e "$KEY" ]] || die "DEDICATED_KEEPER_WALLET_ALREADY_EXISTS"
 install -d -m 0700 "$ETC_DIR"
 # Generate a NEW, GAS-ONLY disposable testnet signer. NEVER export an
 # admin/funder/customer key. Print ONLY the public wallet address.
 (cd "$BASE"; V3_KEY_PATH="$KEY" "$node" --input-type=module -e '
  import fs from "node:fs";
  import {Wallet} from "ethers";
  const wallet=Wallet.createRandom();
  fs.writeFileSync(process.env.V3_KEY_PATH,wallet.privateKey+"\n",{flag:"wx",mode:0o600});
  console.log("V3_KEEPER_GAS_ONLY_PUBLIC_ADDRESS="+wallet.address);
  console.log("Fund only a SMALL amount of valueless BNB Testnet gas; never real tokens or customer assets.");
 ')
 exit 0
fi
if [[ "$mode" == --status ]]; then
 systemctl status "$UNIT.timer" --no-pager -l || true
 systemctl status "$UNIT.service" --no-pager -l || true
 exit 0
fi
[[ -f "$CONFIG" && ! -L "$CONFIG" ]] || die "MISSING_PINNED_V3_TESTNET_CONFIG"
[[ -f "$KEY" && ! -L "$KEY" ]] || die "MISSING_DEDICATED_GAS_ONLY_TESTNET_KEY"
[[ "$(stat -Lc '%a:%u' "$KEY")" == '600:0' ]] ||
 die "DEDICATED_TESTNET_KEY_MUST_BE_ROOT_0600"
[[ "$(stat -Lc '%a:%u' "$CONFIG")" == '600:0' ]] ||
 die "V3_CONFIG_MUST_BE_ROOT_0600"
(cd "$BASE"; "$node" scripts/global-v3-auto-compound-keeper.mjs --check --config "$CONFIG") ||
 die "PUBLIC_TESTNET_V3_RUNTIME_NOT_VERIFIED"
if [[ "$mode" == --check ]]; then
 echo "V3_KEEPER_PREFLIGHT_PASS=YES"
 echo "V3_KEEPER_TIMER_INSTALLED=NO"
 exit 0
fi

command -v systemd-analyze >/dev/null || die "MISSING_SYSTEMD_ANALYZE"
command -v npm >/dev/null || die "MISSING_NPM"
command -v git >/dev/null || die "MISSING_GIT"
[[ ! -e "/etc/systemd/system/$UNIT.service" && ! -e "/etc/systemd/system/$UNIT.timer" ]] ||
 die "KEEPER_TIMER_ALREADY_INSTALLED_REVIEW_BEFORE_UPGRADE"
sha="$(git -C "$BASE" rev-parse HEAD)"
[[ "$sha" =~ ^[a-f0-9]{40}$ ]] || die "REPOSITORY_COMMIT_SHA_INVALID"
# Freeze the exact reviewed script and dependency lock outside the mutable
# Global website checkout. Future git switches cannot change the running job.
RELEASE="$RELEASE_ROOT/releases/$sha"
[[ ! -e "$RELEASE" ]] || die "PINNED_KEEPER_RELEASE_ALREADY_EXISTS_REVIEW_BEFORE_RETRY"
install -d -m 0755 "$RELEASE/scripts"
install -m 0644 "$BASE/scripts/global-v3-auto-compound-keeper.mjs" "$RELEASE/scripts/"
install -m 0644 "$BASE/package.json" "$BASE/package-lock.json" "$RELEASE/"
(cd "$RELEASE"; npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
"$node" --check "$RELEASE/scripts/global-v3-auto-compound-keeper.mjs"
chmod -R go-w "$RELEASE"
cat > "/etc/systemd/system/$UNIT.service" <<EOF
[Unit]
Description=BNB Testnet V3 permissionless daily plus compounded claim keeper (no manager role)
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
StateDirectory=$STATE
$PROFILE_LINE
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

[Install]
WantedBy=multi-user.target
EOF
cat > "/etc/systemd/system/$UNIT.timer" <<EOF
[Unit]
Description=Hourly permissionless V3 TESTNET auto-compound accrual check

[Timer]
OnCalendar=hourly
RandomizedDelaySec=2m
Persistent=true
Unit=$UNIT.service

[Install]
WantedBy=timers.target
EOF
systemd-analyze verify "/etc/systemd/system/$UNIT.service" "/etc/systemd/system/$UNIT.timer" ||
 die "UNITS_DID_NOT_VALIDATE"
systemctl daemon-reload
systemctl enable --now "$UNIT.timer"
echo "V3_AUTO_COMPOUND_KEEPER_TIMER_INSTALLED=$UNIT.timer"
echo "V3_PINNED_KEEPER_RELEASE=$sha"
echo "V3_AUTO_COMPOUND_KEEPER_TESTNET_ONLY=TRUE"
echo "V3_ADMIN_APPROVAL_REQUIRED_FOR_ACCRUAL=FALSE"
echo "V3_KEEPER_MAY_ACCRUE_ONLY_IF_USER_CHECKIN_ELIGIBLE=TRUE"
echo "V3_KEEPER_STATUS=systemctl status $UNIT.timer --no-pager"
