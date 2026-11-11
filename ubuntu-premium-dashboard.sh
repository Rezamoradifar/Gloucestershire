#!/usr/bin/env bash
# Install the premium frontend only. Never deploy or restart any financial worker.
# No private keys, financial journal, signer, scheduler, contract, or API updates.
set -Eeuo pipefail
set +x
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if [[ ${EUID:-$(id -u)} != 0 || $# != 0 ]]; then echo 'GLOBAL_PREMIUM_ROOT_NO_ARGS_REQUIRED'; exit 1; fi
for tool in curl python3 nginx systemctl git sha256sum tar xz; do
  command -v "$tool" >/dev/null || { echo "GLOBAL_PREMIUM_MISSING_TOOL $tool"; exit 1; }
done
if [[ $(df -Pk /var/www | awk 'NR==2 {print $4}') -lt 1048576 ]]; then echo 'GLOBAL_PREMIUM_DISK_SPACE_REQUIRED'; exit 1; fi
if [[ $(df -Pi /var/www | awk 'NR==2 {print $4}') -lt 2000 ]]; then echo 'GLOBAL_PREMIUM_FREE_INODES_REQUIRED'; exit 1; fi
nginx -t || { echo 'GLOBAL_PREMIUM_NGINX_PREFLIGHT_FAILED'; exit 1; }
systemctl is-active --quiet globaldroptrade-new-deployer-daily.timer ||
  { echo 'GLOBAL_PREMIUM_DAILY_TIMER_NOT_ACTIVE_NO_INSTALL'; exit 1; }

# Verify the production API target before running any installer.
stage=$(mktemp -d)
runtime_stage=''
cleanup(){
  rm -rf -- "$stage"
  if [[ -n "$runtime_stage" ]]; then rm -rf -- "$runtime_stage"; fi
}
trap cleanup EXIT
curl --fail --silent --show-error --max-time 15 --noproxy '*' \
  http://127.0.0.1:3115/api/config -o "$stage/api-config.json"
python3 - "$stage/api-config.json" <<'PY'
import json,sys
from pathlib import Path
value=json.loads(Path(sys.argv[1]).read_text())
target='0x4c0f6141b18971db4b14e45c0be8cddb09febc14'
if value.get('chainId')!=97 or str(value.get('vaultAddress','')).lower()!=target:
    raise SystemExit('GLOBAL_PREMIUM_UNEXPECTED_TESTNET_TARGET_NO_INSTALL')
print('GLOBAL_PREMIUM_TARGET_VERIFIED chainId=97')
PY

# The server may not expose npm on PATH. Bootstrap a *separate*, pinned,
# hash-verified Node runtime; never replace /usr/bin/node, npm, or system packages.
case "$(uname -m)" in
 x86_64) arch=x64 ;;
 aarch64|arm64) arch=arm64 ;;
 *) echo 'GLOBAL_PREMIUM_UNSUPPORTED_ARCH'; exit 1 ;;
esac
version=v22.23.3
dirname="node-$version-linux-$arch"
runtime_parent=/opt/globaldroptrade-node
runtime="$runtime_parent/$dirname"
if [[ -L "$runtime_parent" || -L "$runtime" ]]; then echo 'GLOBAL_PREMIUM_UNSAFE_RUNTIME_PATH'; exit 1; fi
install -d -m 755 "$runtime_parent"
if [[ ! -x "$runtime/bin/node" || ! -x "$runtime/bin/npm" ]]; then
  if [[ -e "$runtime" ]]; then echo 'GLOBAL_PREMIUM_INCOMPLETE_RUNTIME_NO_OVERWRITE'; exit 1; fi
  runtime_stage=$(mktemp -d "$runtime_parent/.premium-node.XXXXXXXX")
  archive="$dirname.tar.xz"
  curl --fail --silent --show-error --location --retry 2 --connect-timeout 20 \
    --max-time 300 --proto '=https' \
    "https://nodejs.org/dist/$version/$archive" -o "$runtime_stage/$archive"
  curl --fail --silent --show-error --location --retry 2 --connect-timeout 20 \
    --max-time 60 --proto '=https' \
    "https://nodejs.org/dist/$version/SHASUMS256.txt" -o "$runtime_stage/SHASUMS256.txt"
  (cd "$runtime_stage" && \
    awk -v name="$archive" '$2==name {print}' SHASUMS256.txt > selected.sha256 && \
    test -s selected.sha256 && sha256sum --check selected.sha256 && \
    tar --extract --file "$archive" --xz)
  [[ -x "$runtime_stage/$dirname/bin/node" && -x "$runtime_stage/$dirname/bin/npm" ]] ||
    { echo 'GLOBAL_PREMIUM_RUNTIME_ARCHIVE_INVALID'; exit 1; }
  [[ $("$runtime_stage/$dirname/bin/node" --version) == "$version" ]] ||
    { echo 'GLOBAL_PREMIUM_RUNTIME_VERSION_INVALID'; exit 1; }
  chmod -R a+rX "$runtime_stage/$dirname"
  [[ ! -e "$runtime" && ! -L "$runtime" ]] ||
    { echo 'GLOBAL_PREMIUM_RUNTIME_RACE_STOPPED'; exit 1; }
  mv -- "$runtime_stage/$dirname" "$runtime"
  echo 'GLOBAL_PREMIUM_NODE_INSTALLED_ISOLATED'
fi
export PATH="$runtime/bin:$PATH"
[[ $(node --version) == "$version" ]] || { echo 'GLOBAL_PREMIUM_NODE_VERSION_INVALID'; exit 1; }
npm --version >/dev/null || { echo 'GLOBAL_PREMIUM_NPM_UNAVAILABLE'; exit 1; }

# Preserve a previously configured *public* WalletConnect/Reown project ID.
# Never publish a new frontend that silently disables working mobile wallet login.
# The current production bundle is only read; no private key or credential is read.
if [[ -z "${VITE_WALLETCONNECT_PROJECT_ID:-}" ]]; then
  conf=/etc/nginx/sites-available/globaldroptrade.com
  [[ -f "$conf" && ! -L "$conf" ]] ||
    { echo 'GLOBAL_PREMIUM_MANAGED_SITE_CONFIG_REQUIRED'; exit 1; }
  current_root=$(python3 - "$conf" <<'PYROOT'
import re,sys
from pathlib import Path
contents=Path(sys.argv[1]).read_text()
roots=re.findall(r'^\s*root\s+(/var/www/globaldroptrade/releases/[^;\s]+);',contents,re.M)
if len(set(roots))!=1:raise SystemExit('GLOBAL_PREMIUM_MANAGED_SITE_ROOT_REQUIRED')
root=Path(roots[0])
if root.is_symlink() or root.parent!=Path('/var/www/globaldroptrade/releases') or not (root/'index.html').is_file():
    raise SystemExit('GLOBAL_PREMIUM_MANAGED_SITE_ROOT_REQUIRED')
print(root)
PYROOT
  )
  VITE_WALLETCONNECT_PROJECT_ID=$(node --input-type=module - "$current_root" <<'JSWALLET'
import fs from 'node:fs';
import path from 'node:path';
import {walletId} from './scripts/check-testnet-activity-release.mjs';
const root=process.argv[2],assets=path.join(root,'assets');
const ids=new Set();
for(const filename of fs.readdirSync(assets)){
 if(!filename.endsWith('.js'))continue;
 const file=path.join(assets,filename),stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.size>15_000_000)continue;
 const source=fs.readFileSync(file,'utf8');
 if(!source.includes('projectId'))continue;
 try{ids.add(walletId(source));}catch{}
}
if(ids.size!==1)throw Error('GLOBAL_PREMIUM_WALLETCONNECT_ID_UNVERIFIED_NO_INSTALL');
process.stdout.write([...ids][0]);
JSWALLET
  ) || { echo 'GLOBAL_PREMIUM_WALLETCONNECT_ID_UNVERIFIED_NO_INSTALL'; exit 1; }
fi
[[ "$VITE_WALLETCONNECT_PROJECT_ID" =~ ^[a-fA-F0-9]{32}$ ]] ||
  { echo 'GLOBAL_PREMIUM_WALLETCONNECT_PROJECT_ID_INVALID'; exit 1; }
export VITE_WALLETCONNECT_PROJECT_ID
echo 'GLOBAL_PREMIUM_WALLETCONNECT_PRESERVED'

# Existing guarded installer: build source, back up Nginx, switch only static site,
# health-check live HTTPS and verify the public API target has not changed.
env -u GLOBAL_ACTIVITY_TESTNET_RELEASE -u GLOBAL_SITE_IP -u GLOBAL_SITE_PORT bash ubuntu-refine-website.sh
systemctl is-active --quiet globaldroptrade-new-deployer-daily.timer ||
  { echo 'GLOBAL_PREMIUM_DAILY_TIMER_REVIEW_REQUIRED'; exit 1; }
echo 'GLOBAL_PREMIUM_WEBSITE_INSTALLED_WITH_FINANCIAL_WORKERS_UNCHANGED'
