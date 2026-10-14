#!/usr/bin/env bash
# Install the reviewed testnet frontend and persistent support API; no chain writes.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
[ "$(df -Pk . | awk 'NR==2 {print $4}')" -ge 2097152 ] || { echo 'At least 2 GiB free space required'; exit 1; }
export VITE_CHAIN_ID=97
export VITE_VAULT_ADDRESS=0x7f19354B765920B9b17003d0840EEaA133883DcA
# This also bootstraps the checksum-verified Node runtime used for the build.
bash ubuntu-ip-website.sh 104.167.16.102 8961
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) exit 1;; esac
runtime="node-v22.23.3-linux-$arch"
node_root="/opt/globaldroptrade-node/$runtime"
if [ ! -x "$node_root/bin/node" ]; then
 install -d -m 755 /opt/globaldroptrade-node
 cp -a ".runtime/$runtime" "$node_root"
 chmod -R a+rX "$node_root"
fi
export PATH="$node_root/bin:$PATH"
install -d -m 700 /etc/globaldroptrade
if [ ! -f /etc/globaldroptrade/trades.env ]; then install -m 600 server/trades.env.example /etc/globaldroptrade/trades.env; fi
python3 - <<'PY'
from pathlib import Path
p=Path('/etc/globaldroptrade/trades.env');content=p.read_text();values={}
for line in content.splitlines():
 if '=' in line and not line.lstrip().startswith('#'):
  k,v=line.split('=',1);values[k.strip()]=v.strip().strip("\"'")
expected={'TRADES_CHAIN_ID':'97','TRADES_VAULT_ADDRESS':'0x7f19354B765920B9b17003d0840EEaA133883DcA'}
for k,v in expected.items():
 if values.get(k) and values[k].lower()!=v.lower():raise SystemExit('Existing API chain/contract differs. Stopped to preserve configuration.')
defaults={**expected,'TRADES_RPC_URL':'https://bsc-testnet-dataseed.bnbchain.org'}
missing={k:v for k,v in defaults.items() if not values.get(k)}
lines=[line for line in content.splitlines() if line.split('=',1)[0].strip() not in missing]
lines += [k+'='+v for k,v in missing.items()]
p.write_text('\n'.join(lines)+'\n');p.chmod(0o600)
PY
bash ubuntu-api.sh
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
install -d -m 755 "$stage/site"
cp -R website/dist/. "$stage/site/"
cp -R deployment-console "$stage/site/deploy"
cp scripts/install-website.sh "$stage/install.sh"
env -u GLOBAL_SITE_IP -u GLOBAL_SITE_PORT bash "$stage/install.sh"
# Preserve the existing TLS certificate; do not launch a second Certbot process.
curl -fsS --max-time 20 --resolve globaldroptrade.com:443:127.0.0.1 https://globaldroptrade.com/ -o "$stage/https.html"
cmp -s website/dist/index.html "$stage/https.html"
curl -fsS --max-time 10 http://127.0.0.1:3115/api/community/announcements
printf '\nGLOBAL_COMMUNITY_AND_FRONTEND_READY\n'
echo 'Tickets persist in /var/lib/globaldroptrade-api/community.json. No blockchain transaction was sent.'
