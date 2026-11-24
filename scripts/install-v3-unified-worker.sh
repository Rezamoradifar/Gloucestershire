#!/usr/bin/env bash
# Install the isolated hourly accrual and network-volume worker on the Global testnet host.
set -Eeuo pipefail
umask 077
sha=${1:-}
[[ $sha =~ ^[0-9a-f]{40}$ && $(id -u) == 0 && $(hostname -s) == vps-luna-2585 ]]
[[ $(git rev-parse HEAD) == "$sha" ]]
git diff --quiet "$sha" --
root=/opt/global-v3-unified-worker
config=/etc/globaldroptrade
proof=/var/lib/globaldroptrade/v3-unified-testnet/deployment-proof.json
unit=global-v3-unified-keeper-testnet
user=global-v3-unified
key=$config/v3-unified-keeper-testnet-gas-only.key
profile=()
case $#:${2:-} in
  1:) ;;
  2:--single-capital|2:--daily-capital|2:--referral-profit|2:--manual-reinvest|2:--upline-rates|2:--account-reinvest|2:--portfolio)
    name=${2#--}
    root=/opt/global-v3-$name-worker
    proof=/var/lib/globaldroptrade/v3-$name-testnet/deployment-proof.json
    unit=global-v3-$name-keeper-testnet
    user=global-v3-$name
    key=$config/v3-$name-keeper-testnet-gas-only.key
    profile=("$2")
    ;;
  *) echo UNIFIED_WORKER_INVALID_RELEASE_PROFILE >&2; exit 1 ;;
esac
release=$root/$sha
case $(uname -m) in
  x86_64) arch=x64 ;;
  aarch64) arch=arm64 ;;
  *) exit 1 ;;
esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
[[ -x $runtime/node && -x $runtime/npm ]] || { echo UNIFIED_WORKER_RUNTIME_REQUIRED; exit 1; }
export PATH="$runtime:/usr/sbin:/usr/bin:/sbin:/bin"
for dir in "$config" "$root"; do
  [[ -e $dir || -L $dir ]] || install -d -m 0755 "$dir"
  [[ -d $dir && ! -L $dir && $(stat -c %u "$dir") == 0 && $((8#$(stat -c %a "$dir") & 0022)) == 0 ]]
done
[[ $(realpath "$root") == "$root" && $(realpath "$config") == "$config" && $(realpath "$proof") == "$proof" && -f $proof ]]
exec 9>"$root/.install.lock"
flock -n 9 || { echo UNIFIED_WORKER_INSTALL_IN_PROGRESS; exit 1; }
work=$(mktemp -d "$root/.install.XXXXXXXX")
trap 'rm -rf -- "$work"' EXIT
if [[ ! -e $release && ! -L $release ]]; then
  mkdir "$work/code"
  git archive "$sha" scripts package.json package-lock.json | tar -x -C "$work/code"
  (cd "$work/code" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
  printf '%s\n' "$sha" > "$work/code/.release"
  chmod -R u=rwX,go=rX "$work/code"
  mv -T "$work/code" "$release"
fi
[[ -d $release && ! -L $release && $(stat -c %u "$release") == 0 &&
   $(cat "$release/.release") == "$sha" && $((8#$(stat -c %a "$release") & 0022)) == 0 ]]
node "$release/scripts/run-v3-unified-worker.mjs" --init-key "${profile[@]}"
gas_status=0
node "$release/scripts/run-v3-unified-worker.mjs" --check "$sha" "${profile[@]}" || gas_status=$?
if (( gas_status != 0 )); then
  [[ $gas_status == 42 && ${#profile[@]} != 0 ]] || exit "$gas_status"
fi
success_exit=''
if [[ ${#profile[@]} != 0 ]]; then success_exit='SuccessExitStatus=42'; fi
if ! getent passwd "$user" >/dev/null; then
  useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$user"
fi
[[ $(getent passwd "$user" | cut -d: -f6,7) == /nonexistent:/usr/sbin/nologin && $(id -u "$user") != 0 && $(id -Gn "$user") == "$user" ]]
cat > "$work/$unit.service" <<UNIT
[Unit]
Description=Global V3 isolated unified testnet worker
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Environment=TZ=UTC
$success_exit
User=$user
Group=$user
StateDirectory=$unit
StateDirectoryMode=0700
WorkingDirectory=$release
LoadCredential=keeper-key:$key
LoadCredential=deployment-proof:$proof
ExecStart=$runtime/node $release/scripts/run-v3-unified-worker.mjs --tick ${profile[*]}
TimeoutStartSec=6min
UMask=0077
NoNewPrivileges=true
ProtectHome=true
ProtectSystem=strict
PrivateTmp=true
PrivateDevices=true
RestrictSUIDSGID=true
ProtectKernelModules=true
ProtectKernelTunables=true
ProtectControlGroups=true
CapabilityBoundingSet=
UNIT
cat > "$work/$unit.timer" <<UNIT
[Unit]
Description=Schedule isolated Global V3 testnet accrual and volume

[Timer]
OnBootSec=30s
OnUnitInactiveSec=15s
AccuracySec=1s
Unit=$unit.service

[Install]
WantedBy=timers.target
UNIT
systemd-analyze verify "$work/$unit.service" "$work/$unit.timer"
for ext in service timer; do
  target="/etc/systemd/system/$unit.$ext"
  [[ ! -L $target && ( ! -e $target || -f $target ) ]]
  install -m 0644 "$work/$unit.$ext" "$target.new"
  mv -T "$target.new" "$target"
done
systemctl daemon-reload
systemctl start "$unit.service"
systemctl enable --now "$unit.timer"
systemctl is-active --quiet "$unit.timer"
if (( gas_status == 42 )); then
  echo UNIFIED_TESTNET_WORKER_WAITING_FOR_TEST_GAS
else
  echo UNIFIED_TESTNET_WORKER_ACTIVE
fi
