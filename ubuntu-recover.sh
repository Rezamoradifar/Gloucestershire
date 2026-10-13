#!/usr/bin/env bash
# Restore the frontend and read-only API without touching chain state.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$(id -u)" -eq 0 ] || { echo 'Run as root.'; exit 1; }
state=/root/global-testnet-v071/.testnet-server
# Keep published reports even when the private test journal is elsewhere.
python3 - <<'PY'
from pathlib import Path
import re,shutil
conf=Path('/etc/nginx/sites-available/globaldroptrade.com')
if conf.is_file():
    match=re.search(r'^\s*root\s+(/var/www/globaldroptrade/releases/[^;\s]+);',conf.read_text(),re.M)
    if match:
        for name in ('testnet-plan.json','testnet-plan.html','testnet-million.json','testnet-million.html'):
            source=Path(match.group(1))/name
            if source.is_file() and source.stat().st_size:
                shutil.copyfile(source,Path('website/public')/name)
PY
for scenario in plan million; do
 sub=live-plan-v1
 [ "$scenario" != million ] || sub=million-test-v1
 for ext in json html; do
  report="$state/$sub/$scenario-public.$ext"
  if [ -s "$report" ]; then install -m 644 "$report" "website/public/testnet-$scenario.$ext"; fi
 done
done
bash ubuntu-domain.sh
# The service runs unprivileged with ProtectHome=true, so it needs Node outside /root.
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo 'Unsupported CPU'; exit 1;; esac
runtime_name="node-v22.23.3-linux-$arch"
runtime_root=/opt/globaldroptrade-runtime
[ ! -L "$runtime_root" ] || { echo 'Unexpected runtime symlink; stopped.'; exit 1; }
install -d -m 755 "$runtime_root"
runtime="$runtime_root/$runtime_name"
[ ! -L "$runtime" ] || { echo 'Unexpected Node symlink; stopped.'; exit 1; }
if [ ! -x "$runtime/bin/node" ]; then
 stage=$(mktemp -d "$runtime_root/.stage.XXXXXXXX")
 trap 'rm -rf -- "$stage"' EXIT
 cp -R ".runtime/$runtime_name/." "$stage/"
 chmod -R a+rX "$stage"
 "$stage/bin/node" -e 'if(process.versions.node!=="22.23.3")process.exit(1)'
 [ ! -e "$runtime" ] || { echo 'Incomplete existing runtime; stopped.'; exit 1; }
 mv -- "$stage" "$runtime"
 trap - EXIT
fi
export PATH="$runtime/bin:$PATH"
bash ubuntu-api.sh
curl -fsS --noproxy '*' --max-time 10 http://127.0.0.1:3115/api/health
curl -fsS --noproxy '*' --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 \
 https://globaldroptrade.com/api/health
printf '\nGLOBAL_RECOVERY_INSTALLED\nhttps://globaldroptrade.com\n'
echo 'API health does not prove a live settlement feed; existing RPC configuration is preserved.'
