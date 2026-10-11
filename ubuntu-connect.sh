#!/usr/bin/env bash
# Activate a read-only feed and matching website from a separate release checkout.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$(id -u)" -eq 0 ] || { echo 'Run as root: sudo bash ubuntu-connect.sh /root/global-bnb'; exit 1; }
source_dir=$(realpath -- "${1:-/root/global-bnb}")
[ -d "$source_dir" ] && [ "$source_dir" != "$PWD" ] || { echo 'Use a separate release checkout; pass the existing project directory as argument.'; exit 1; }
# Older Global installs keep Node under /root. Copy that existing runtime to a
# service-readable location; never move its keys, reports or deployment journal.
node_ok() { command -v node >/dev/null && command -v npm >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)||(a===20&&b>=19)?0:1)'; }
node_private=0
case "$(command -v node || true)" in /root/*) node_private=1;; esac
if ! node_ok || [ "$node_private" -eq 1 ]; then
 case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo 'Unsupported CPU'; exit 1;; esac
 runtime_name="node-v22.23.3-linux-$arch"
 runtime_source="$source_dir/.runtime/$runtime_name"
 [ -x "$runtime_source/bin/node" ] || { echo 'Install system-readable Node.js 20.19+ or 22.12+ with npm before retrying. No configuration changed.'; exit 1; }
 runtime_target="/opt/globaldroptrade-runtime/$runtime_name"
 if [ ! -e "$runtime_target" ]; then install -d -m 755 /opt/globaldroptrade-runtime; cp -a "$runtime_source" "$runtime_target"; chmod -R a+rX "$runtime_target"; fi
 export PATH="$runtime_target/bin:$PATH"
fi
node_ok || { echo 'Unsupported Node.js runtime'; exit 1; }
for tool in nginx python3 systemctl curl install; do command -v "$tool" >/dev/null || { echo "Missing dependency: $tool"; exit 1; }; done
nginx -t
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
node scripts/connect-settlement-feed.mjs "$source_dir" "$stage"
# Only public chain/address settings are passed to Vite, never the private RPC.
export VITE_CHAIN_ID VITE_VAULT_ADDRESS
VITE_CHAIN_ID=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).chainId)' "$stage/connection-public.json")
VITE_VAULT_ADDRESS=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).contractAddress)' "$stage/connection-public.json")
npm ci --ignore-scripts --no-audit --no-fund --prefix website
npm run build --prefix website
python3 scripts/package-website.py
envfile=/etc/globaldroptrade/trades.env
backup_dir="/etc/globaldroptrade/backups/$(date -u +%Y%m%dT%H%M%S)-$$"
install -d -m 700 "$backup_dir"
env_existed=0
if [ -f "$envfile" ]; then cp -p "$envfile" "$backup_dir/trades.env"; env_existed=1; fi
restore_env() {
 if [ "$env_existed" -eq 1 ]; then cp -p "$backup_dir/trades.env" "$envfile"; else rm -f "$envfile"; fi
 systemctl try-restart globaldroptrade-api >/dev/null 2>&1 || true
}
install -m 600 "$stage/trades.env" "$envfile"
if ! bash ubuntu-api.sh; then restore_env; echo 'API activation failed; previous connection settings restored.'; exit 1; fi
if ! curl -fsS --max-time 55 'http://127.0.0.1:3115/api/trades?limit=1' -o "$stage/active.json"; then
 restore_env; echo 'API live check failed; previous connection settings restored.'; exit 1
fi
node -e 'const fs=require("fs"),a=JSON.parse(fs.readFileSync(process.argv[1])),b=JSON.parse(fs.readFileSync(process.argv[2]));if(a.status!=="live"||a.chainId!==b.chainId||a.contract!==b.contractAddress)process.exit(1)' "$stage/active.json" "$stage/connection-public.json" || { restore_env; echo 'Active API target mismatch; previous settings restored.'; exit 1; }
bash ubuntu-website.sh
install -m 600 "$stage/connection-public.json" /etc/globaldroptrade/connection-public.json
# Check the actual HTTPS virtual host locally, retaining certificate validation.
curl -fsS --max-time 55 --resolve globaldroptrade.com:443:127.0.0.1 'https://globaldroptrade.com/api/trades?limit=1' -o "$stage/public.json"
node -e 'const fs=require("fs"),a=JSON.parse(fs.readFileSync(process.argv[1])),b=JSON.parse(fs.readFileSync(process.argv[2]));if(a.status!=="live"||a.chainId!==b.chainId||a.contract!==b.contractAddress)process.exit(1)' "$stage/public.json" "$stage/connection-public.json"
echo 'HTTPS_SITE_AND_READ_ONLY_FEED_CONNECTED'
cat /etc/globaldroptrade/connection-public.json
echo 'This operation sent no blockchain transactions. Check requestedPlanChecksMatch above; false means the connected contract still differs from the requested upgrade.'
