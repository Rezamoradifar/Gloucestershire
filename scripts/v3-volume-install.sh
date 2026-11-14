#!/usr/bin/env bash
# Separate gas-only hourly-testnet volume worker; never changes existing units.
set +x
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "$0")/.."
[[ "$(id -u)" == 0 && $# == 1 ]] || { echo V3_VOLUME_ROOT_AND_MODE_REQUIRED; exit 1; }
case "$1" in --init-wallet|--check|--install|--status) ;; *) echo V3_VOLUME_MODE_INVALID; exit 1 ;; esac
mode=$1
case "$(uname -m)" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) echo V3_VOLUME_ARCH_UNSUPPORTED; exit 1 ;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
[[ -x "$runtime/node" ]] && export PATH="$runtime:$PATH"
for cmd in node npm git systemctl systemd-run systemd-analyze journalctl flock cmp; do
 command -v "$cmd" >/dev/null || { echo "V3_VOLUME_MISSING_$cmd"; exit 1; }
done
[[ -d .git ]] || { echo V3_VOLUME_CHECKOUT_REQUIRED; exit 1; }
node="$(command -v node)"
unit=global-v3-hourly-network-volume-testnet
config=/etc/globaldroptrade/v3-hourly-keeper-testnet.json
proof=/var/lib/globaldroptrade/v3-hourly-testnet/deployment.json
key=/etc/globaldroptrade/v3-hourly-volume-keeper-gas-only.key
prior_key=/etc/globaldroptrade/v3-hourly-keeper-testnet-gas-only.key
if [[ "$mode" == --status ]]; then
 systemctl is-enabled "$unit.timer" || true
 systemctl is-active "$unit.timer" || true
 journalctl -u "$unit.service" -n 50 --no-pager -o cat
 exit 0
fi
if [[ "$mode" == --init-wallet ]]; then
 "$node" scripts/v3-volume-keeper.mjs --init-wallet
 echo V3_VOLUME_KEEPER_NOT_INSTALLED
 exit 0
fi
for file in "$config" "$proof" "$key" "$prior_key"; do
 [[ -f "$file" && ! -L "$file" && "$(stat -Lc '%a:%u' "$file")" == '600:0' ]] ||
  { echo V3_VOLUME_PRIVATE_INPUT_INVALID; exit 1; }
done
volume_address="$("$node" scripts/v3-volume-keeper.mjs --address)"
# The 24-hour routed keeper and the older original V3 keeper may also be
# active. Never let this worker share a signer with any known keeper: their
# independent timers do not share a nonce lock. A missing optional key is OK;
# an existing unsafe file (including a dangling symlink) fails closed.
for other_key in "$prior_key" \
 /etc/globaldroptrade/v3-routed-keeper-testnet-gas-only.key \
 /etc/globaldroptrade/v3-keeper-testnet-gas-only.key; do
 if [[ "$other_key" != "$prior_key" && ! -e "$other_key" && ! -L "$other_key" ]]; then
  continue
 fi
 [[ -f "$other_key" && ! -L "$other_key" && "$(stat -Lc '%a:%u' "$other_key")" == '600:0' ]] ||
  { echo V3_VOLUME_OTHER_KEEPER_KEY_UNSAFE; exit 1; }
 other_address="$("$node" scripts/global-v3-auto-compound-keeper.mjs --public-address --key-file "$other_key")"
 [[ "${volume_address#*=}" != "${other_address#*=}" ]] ||
  { echo V3_VOLUME_SIGNER_MUST_BE_SEPARATE; exit 1; }
done
"$node" scripts/v3-volume-keeper.mjs --check
echo V3_VOLUME_PREFLIGHT_PASS
if [[ "$mode" == --check ]]; then echo V3_VOLUME_NO_TRANSACTION_SENT; exit 0; fi
read -r name version _ <<< "$(systemctl --version)"
[[ "$name" == systemd && "$version" =~ ^[0-9]+$ && "$version" -ge 247 ]] || { echo V3_VOLUME_SYSTEMD_247_REQUIRED; exit 1; }
exec 9>/run/lock/v3-hourly-volume-install.lock
flock -n 9 || { echo V3_VOLUME_INSTALL_ALREADY_RUNNING; exit 1; }
for suffix in service timer; do
 [[ ! -e "/etc/systemd/system/$unit.$suffix" && ! -L "/etc/systemd/system/$unit.$suffix" ]] ||
  { echo V3_VOLUME_UNIT_EXISTS_REVIEW; exit 1; }
 systemctl cat "$unit.$suffix" >/dev/null 2>&1 && { echo V3_VOLUME_UNIT_EXISTS_REVIEW; exit 1; }
done
git diff --quiet HEAD -- scripts/v3-volume-keeper.mjs scripts/global-v3-auto-compound-keeper.mjs \
 scripts/v3-keeper-receipt-poll.mjs scripts/v3-volume-install.sh package.json package-lock.json ||
 { echo V3_VOLUME_SOURCE_MODIFIED; exit 1; }
sha="$(git rev-parse HEAD)"
[[ "$sha" =~ ^[a-f0-9]{40}$ ]] || { echo V3_VOLUME_SHA_INVALID; exit 1; }
base=/opt/global-v3-hourly-volume-keeper
release="$base/releases/$sha"
install -d -m 0755 "$base/releases"
stage=''
tmp="$(mktemp -d /tmp/v3-volume-units.XXXXXX)"
cleanup(){ [[ -z "$stage" || ! -d "$stage" ]] || rm -rf -- "$stage"; rm -rf -- "$tmp"; }
trap cleanup EXIT
if [[ ! -e "$release" && ! -L "$release" ]]; then
 stage="$(mktemp -d "$base/releases/.staging.XXXXXX")"
 chmod 755 "$stage"
 install -d -m 0755 "$stage/scripts"
 install -m 0644 scripts/v3-volume-keeper.mjs scripts/global-v3-auto-compound-keeper.mjs \
  scripts/v3-keeper-receipt-poll.mjs "$stage/scripts/"
 install -m 0644 package.json package-lock.json "$stage/"
 (umask 022; cd "$stage"; npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
 chmod -R u+rwX,go+rX,go-w "$stage"
 "$node" --check "$stage/scripts/v3-volume-keeper.mjs"
 mv -T "$stage" "$release"
 stage=''
else
 [[ -d "$release" && ! -L "$release" && "$(stat -Lc %u "$release")" == 0 ]] ||
  { echo V3_VOLUME_RELEASE_INVALID; exit 1; }
 for file in scripts/v3-volume-keeper.mjs scripts/global-v3-auto-compound-keeper.mjs \
  scripts/v3-keeper-receipt-poll.mjs package.json package-lock.json; do
  cmp -s "$file" "$release/$file" || { echo V3_VOLUME_RELEASE_MISMATCH; exit 1; }
 done
fi
printf 'GLOBAL_V3_VOLUME_CREDENTIAL_PROBE\n' > "$tmp/sample"
chmod 600 "$tmp/sample"
systemd-run --quiet --wait --collect --unit="v3-volume-probe-$$" \
 --property=Type=oneshot --property=DynamicUser=yes \
 --property="WorkingDirectory=$release" --property="LoadCredential=volume-gas-key:$tmp/sample" \
 --property=ProtectSystem=strict --property=ProtectHome=yes --property=PrivateTmp=yes \
 --property=NoNewPrivileges=yes --property=TimeoutStartSec=60 \
 "$node" "$release/scripts/v3-volume-keeper.mjs" --probe-systemd-credential ||
 { echo V3_VOLUME_CREDENTIAL_PROBE_FAILED; exit 1; }
echo V3_VOLUME_SYSTEMD_CREDENTIAL_PROBE_PASS
cat > "$tmp/$unit.service" <<EOF
[Unit]
Description=BNB Testnet V3 volume job processor only
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
DynamicUser=yes
WorkingDirectory=$release
ExecStart=$node $release/scripts/v3-volume-keeper.mjs --run
LoadCredential=volume-config:$config
LoadCredential=deployment-proof:$proof
LoadCredential=volume-gas-key:$key
StateDirectory=globaldroptrade-v3-hourly-volume
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
cat > "$tmp/$unit.timer" <<EOF
[Unit]
Description=Check isolated testnet network volume every two minutes
[Timer]
OnCalendar=*:0/2
RandomizedDelaySec=5s
Persistent=true
Unit=$unit.service
[Install]
WantedBy=timers.target
EOF
systemd-analyze verify "$tmp/$unit.service" "$tmp/$unit.timer" || { echo V3_VOLUME_UNITS_INVALID; exit 1; }
install -m 0644 "$tmp/$unit.service" "$tmp/$unit.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now "$unit.timer"
systemctl start --no-block "$unit.service"
echo "V3_VOLUME_TIMER_INSTALLED=$unit.timer"
echo V3_VOLUME_FIRST_RUN_REQUESTED_NOT_YET_VERIFIED
