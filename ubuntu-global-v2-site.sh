#!/usr/bin/env bash
# Static Global V2-only frontend replacement. NEVER changes API, signer, journal or vault.
set +x
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "$0")"
[ "$(id -u)" -eq 0 ] || { echo "V2_SITE_ROOT_REQUIRED"; exit 1; }
[ "$#" -eq 1 ] || { echo "Usage: bash ubuntu-global-v2-site.sh --check|--install"; exit 1; }
case "$1" in --check|--install) mode="$1";; *) echo "V2_SITE_INVALID_MODE"; exit 1;; esac

expected_sha=$(printenv GLOBAL_V2_EXPECTED_SHA || true)
[[ "$expected_sha" =~ ^[0-9a-f]{40}$ ]] || { echo "V2_SITE_PINNED_SHA_REQUIRED"; exit 1; }
actual_sha=$(git rev-parse HEAD)
[ "$expected_sha" = "$actual_sha" ] || { echo "V2_SITE_RELEASE_SHA_MISMATCH"; exit 1; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo "V2_SITE_ARCH_UNSUPPORTED"; exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
if [ -x "$runtime/node" ]; then export PATH="$runtime:$PATH"; fi
for program in node npm nginx curl python3 git cmp flock realpath install find stat; do
 command -v "$program" >/dev/null || { echo "V2_SITE_TOOL_MISSING_$program"; exit 1; }
done
node -e 'if(Number(process.versions.node.split(".")[0])<22)throw Error("NODE_22_REQUIRED")'
nginx -t

# Frontend regression tests also import the repository's root test dependencies.
# Install dependencies only inside the isolated checkout, never in the running API.
npm ci --ignore-scripts --no-audit --no-fund
# Only V2 can appear in the produced site bundle. Old server assets are not modified.
npm ci --prefix website --ignore-scripts --no-audit --no-fund
# Bound Vitest worker processes on the VPS; CI can continue using its own
# parallelism. Avoid dozens of Ganache workers exhausting a small host.
npm test --prefix website -- --maxWorkers=2 --minWorkers=1
npm run build --prefix website
[ -s website/dist/index.html ] || { echo "V2_SITE_BUILD_MISSING"; exit 1; }
grep -RilF '0xA98D8d3709f5D3730BAD5d76C334731784e7CF07' website/dist/assets --include='*.js' >/dev/null || {
 echo "V2_SITE_ADDRESS_NOT_IN_BUNDLE"; exit 1;
}
if grep -RilE '0x4c0f6141b18971db4b14e45c0be8cddb09febc14|/api/trades\?limit|/api/config' website/dist/assets --include='*.js' >/dev/null; then
 echo "V2_SITE_OLD_CONTRACT_REFERENCE_DETECTED"; exit 1;
fi
echo "V2_SITE_BUILD_AND_TEST_PASS"

stage=$(mktemp -d /opt/global-v2-site-stage.XXXXXX)
chmod 700 "$stage"
trap 'rm -rf -- "$stage"' EXIT
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 https://globaldroptrade.com/ -o "$stage/served-before.html"
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 https://globaldroptrade.com/api/config -o "$stage/api-before.json"
nginx -T > "$stage/nginx.conf" 2>/dev/null
site_root=$(python3 scripts/verify-nginx-served-root.py --nginx-config "$stage/nginx.conf" --served "$stage/served-before.html")
[ -n "$site_root" ] && [ -d "$site_root" ] && [ ! -L "$site_root" ] || { echo "V2_SITE_ROOT_INVALID"; exit 1; }
[ "$(stat -c %u "$site_root")" -eq 0 ] || { echo "V2_SITE_ROOT_OWNERSHIP_INVALID"; exit 1; }
echo "V2_SITE_VERIFIED_ROOT=$site_root"
if [ "$mode" = --check ]; then
 echo "V2_SITE_PREFLIGHT_PASS"
 echo "No live site, API, timer, signer or journal was modified."
 exit 0
fi

lockdir=/var/lib/globaldroptrade/v2-site-install
install -d -m 700 "$lockdir"
exec 9>"$lockdir/installer.lock"
flock -n 9 || { echo "V2_SITE_INSTALL_LOCKED"; exit 1; }

backup="/var/backups/globaldroptrade/v2-site-$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -m 700 "$backup" "$backup/files"
cp -p "$stage/served-before.html" "$backup/index-before.html"
cp -p "$stage/api-before.json" "$backup/api-before.json"
printf '%s\n' "$site_root" > "$backup/site-root.txt"
printf '%s\n' "$actual_sha" > "$backup/sha.txt"
touch "$backup/modified.lst" "$backup/created.lst"

changed=0
rollback(){
 local result=0 rel
 while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  cp -p -- "$backup/files/$rel" "$site_root/$rel" || result=1
 done < "$backup/modified.lst"
 while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  rm -f -- "$site_root/$rel" || result=1
 done < "$backup/created.lst"
 if [ "$result" -eq 0 ]; then
  echo "V2_SITE_ROLLBACK_OK backup=$backup"
 else
  echo "V2_SITE_ROLLBACK_REVIEW_REQUIRED backup=$backup" >&2
 fi
 return "$result"
}
cleanup(){
 local status=$?
 trap - EXIT
 if [ "$changed" -eq 1 ]; then rollback || status=1; fi
 rm -rf -- "$stage"
 exit "$status"
}
trap - EXIT
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

copy_one(){
 local source="$1" relative target folder
 relative=$(realpath --relative-to=website/dist -- "$source")
 [ -n "$relative" ] && [[ "$relative" != ../* ]] || { echo "V2_SITE_UNSAFE_PATH"; return 1; }
 target="$site_root/$relative"
 folder=$(dirname "$relative")
 if [ -e "$target" ] || [ -L "$target" ]; then
  [ -f "$target" ] && [ ! -L "$target" ] || { echo "V2_SITE_UNSAFE_EXISTING_FILE"; return 1; }
  install -d -m 700 -- "$backup/files/$folder"
  cp -p -- "$target" "$backup/files/$relative"
  printf '%s\n' "$relative" >> "$backup/modified.lst"
 else
  printf '%s\n' "$relative" >> "$backup/created.lst"
 fi
 install -d -m 755 -- "$site_root/$folder"
 install -m 644 -- "$source" "$target"
}
changed=1
while IFS= read -r -d '' file; do
 [ "$file" = website/dist/index.html ] || copy_one "$file"
done < <(find website/dist -type f -print0)
copy_one website/dist/index.html

curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 'https://globaldroptrade.com/?v2-site-verify=1' -o "$stage/served-after.html"
cmp -s website/dist/index.html "$stage/served-after.html" || { echo "V2_SITE_INDEX_NOT_SERVED"; exit 1; }
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 https://globaldroptrade.com/api/config -o "$stage/api-after.json"
cmp -s "$stage/api-before.json" "$stage/api-after.json" || { echo "V2_SITE_BACKEND_CHANGED"; exit 1; }

changed=0
trap - EXIT INT TERM
rm -rf -- "$stage"
echo "V2_SITE_ONLY_INSTALLED"
echo "RELEASE_SHA=$actual_sha"
echo "BACKUP_PATH=$backup"
echo "Old vault, backend, user balances and financial journals were not deleted."
