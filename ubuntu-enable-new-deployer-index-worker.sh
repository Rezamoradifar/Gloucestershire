#!/usr/bin/env bash
# Install an isolated signer-free BNB testnet indexer timer.
# Never changes the payment worker, policy, API, signer, or financial cursors.
set -Eeuo pipefail
set +x
umask 077

fail() { printf '%s\n' "INDEX_TIMER_STOPPED_${1}" >&2; exit 1; }
[ "$#" -eq 1 ] && { [ "$1" = --check ] || [ "$1" = --install ]; } || fail USAGE
[ "$(id -u)" -eq 0 ] || fail ROOT_REQUIRED
mode=$1
src=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
repo=Rezamoradifar/Gloucestershire
nodebase=/opt/globaldroptrade-node
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) fail ARCH_REQUIRED;; esac
nodebin="$nodebase/node-v22.23.3-linux-$arch/bin"
[ -x "$nodebin/node" ] && [ -x "$nodebin/npm" ] || fail PINNED_NODE_REQUIRED
export PATH="$nodebin:$PATH"
[ -d "$src/.git" ] && [ -f "$src/scripts/auto-index-new-deployer.mjs" ] || fail PINNED_CHECKOUT_REQUIRED
sha=$(git -C "$src" rev-parse HEAD) || fail GIT_REF_REQUIRED
[[ "$sha" =~ ^[a-f0-9]{40}$ ]] || fail GIT_REF_REQUIRED
[ -z "$(git -C "$src" status --porcelain --untracked-files=no)" ] || fail DIRTY_CHECKOUT
[ "$(git -C "$src" config --get remote.origin.url || true)" = "https://github.com/$repo.git" ] || fail REPO_MISMATCH
[ "${INDEX_EXPECTED_SHA:-}" = "$sha" ] || fail EXPLICIT_SHA_REQUIRED
[ "$(systemctl is-active globaldroptrade-api.service)" = active ] || fail API_INACTIVE
[ "$(systemctl is-active globaldroptrade-new-deployer-daily.timer)" = active ] || fail FINANCIAL_TIMER_INACTIVE
[ "$(systemctl show globaldroptrade-new-deployer-daily.service -p WorkingDirectory --value)" != '' ] || fail WORKER_DIRECTORY_MISSING
# This API response is a public chain/contract identity, not a secret.
config=$(curl --noproxy '*' -fsS --max-time 8 http://127.0.0.1:3115/api/config) || fail API_CONFIG_UNAVAILABLE
printf '%s' "$config" | "$nodebin/node" -e '
 let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{
 const x=JSON.parse(s);if(x.chainId!==97||String(x.vaultAddress||"").toLowerCase()!=="0x4c0f6141b18971db4b14e45c0be8cddb09febc14")process.exit(1);
 });' || fail TESTNET_TARGET_MISMATCH
journal=/var/lib/globaldroptrade/new-deployer-testnet-automation-v1/journal.json
[ -f "$journal" ] && [ ! -L "$journal" ] || fail JOURNAL_REQUIRED
[ "$(stat -c '%u %a' "$journal")" = '0 600' ] || fail PRIVATE_JOURNAL_REQUIRED
"$nodebin/node" -e '
const fs=require("fs"),s=JSON.parse(fs.readFileSync(process.argv[1])),d=s.daily||{},t=d.positionScanTarget;
if(s.identity?.chainId!==97||String(s.identity?.target||"").toLowerCase()!=="0x4c0f6141b18971db4b14e45c0be8cddb09febc14"||!Number.isSafeInteger(t?.number)||!Number.isSafeInteger(d.registry?.through)||!Number.isSafeInteger(d.positionIndex?.through))process.exit(1);
console.log(`INDEX_TIMER_INDEX=${d.registry.through}/${d.positionIndex.through} TARGET=${t.number}`)
' "$journal" || fail INDEX_IDENTITY_INVALID

root=/opt/globaldroptrade-readonly-index
releases="$root/releases"
release="$releases/$sha"
service=globaldroptrade-readonly-index.service
timer=globaldroptrade-readonly-index.timer
if [ "$mode" = --check ]; then
  "$nodebin/node" --check "$src/scripts/auto-index-new-deployer.mjs"
  echo "INDEX_TIMER_SOURCE_CHECK_PASS commit=$sha (no live changes)"
  exit 0
fi

# Staging via git archive avoids accidentally deploying locally modified files.
install -d -m 0755 "$root" "$releases"
stage=$(mktemp -d "$releases/.stage.XXXXXXXX")
cleanup() { if [ -n "${stage:-}" ] && [ -d "$stage" ]; then rm -rf -- "$stage"; fi; }
trap cleanup EXIT
if [ ! -d "$release" ]; then
  git -C "$src" archive "$sha" | tar -xf - -C "$stage" || fail STAGING_FAILED
  ( cd "$stage" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund ) || fail DEPENDENCIES_FAILED
  "$nodebin/node" --check "$stage/scripts/auto-index-new-deployer.mjs" || fail JS_SYNTAX_FAILED
  ( cd "$stage" && "$nodebin/node" scripts/preflight-index-auto.mjs --check ) || fail LIVE_PREFLIGHT_FAILED
  chmod 0755 "$stage"
  mv -T -- "$stage" "$release" || fail RELEASE_COMMIT_FAILED
  stage=''
else
  [ ! -L "$release" ] && [ -f "$release/scripts/auto-index-new-deployer.mjs" ] && [ -d "$release/node_modules" ] || fail EXISTING_RELEASE_REVIEW_REQUIRED
  ( cd "$release" && "$nodebin/node" scripts/preflight-index-auto.mjs --check ) || fail LIVE_PREFLIGHT_FAILED
fi

unitdir=/etc/systemd/system
unitfile="$unitdir/$service"
timerfile="$unitdir/$timer"
service_body="[Unit]
Description=Global chain-97 signer-free history index catch-up
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=root
WorkingDirectory=$release
ExecStart=$nodebin/node $release/scripts/auto-index-new-deployer.mjs --execute
TimeoutStartSec=240
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/globaldroptrade/new-deployer-testnet-automation-v1
InaccessiblePaths=-/etc/globaldroptrade/new-deployer-testnet-v1/deployer.key
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
UMask=0077
"
timer_body="[Unit]
Description=Poll Global read-only index catch-up independently of payment

[Timer]
OnBootSec=90s
OnUnitInactiveSec=60s
AccuracySec=15s
Unit=$service

[Install]
WantedBy=timers.target
"
# Do not overwrite an existing systemd definition from another release.
for pair in "$unitfile:service_body" "$timerfile:timer_body"; do
  file=${pair%%:*}; variable=${pair#*:}
  if [ -e "$file" ] || [ -L "$file" ]; then
    [ -f "$file" ] && [ ! -L "$file" ] && diff -q "$file" <(printf '%s' "${!variable}") >/dev/null || fail EXISTING_UNIT_REVIEW_REQUIRED
  fi
done
for pair in "$unitfile:service_body" "$timerfile:timer_body"; do
  file=${pair%%:*}; variable=${pair#*:}
  if [ ! -e "$file" ]; then printf '%s' "${!variable}" | install -m 0644 /dev/stdin "$file"; fi
done
systemctl daemon-reload
systemctl enable --now "$timer" || fail TIMER_ENABLE_REVIEW_REQUIRED
systemctl is-active --quiet "$timer" || fail TIMER_INACTIVE
printf '%s\n' 'INDEX_TIMER_INSTALLED_NO_FINANCIAL_SERVICE_CHANGED' "COMMIT=$sha" "TIMER=$timer"
printf '%s\n' 'Journal index fields may advance after canonical verification; no signer or payout is opened by this timer.'