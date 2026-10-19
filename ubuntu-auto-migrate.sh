#!/usr/bin/env bash
# Testnet-only automated migration. Keep the persistent journal across retries.
set +x
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
for tool in systemd-run systemctl flock python3; do command -v "$tool" >/dev/null || { echo "Missing $tool"; exit 1; }; done
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo 'Unsupported CPU'; exit 1;; esac
runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$arch/bin"
[ -x "$runtime/node" ] || { echo "Existing Node runtime missing: $runtime"; exit 1; }
export PATH="$runtime:$PATH"
[ -f /etc/globaldroptrade/trades.env ] || { echo 'Existing API environment missing'; exit 1; }
if systemctl is-active --quiet globaldroptrade-migration.service; then
 echo 'Migration is already running. Use: journalctl -u globaldroptrade-migration -n 30 --no-pager'; exit 0
fi
umask 077
install -d -m 700 /var/lib/globaldroptrade/migration-v1
exec 9>/var/lib/globaldroptrade/migration-v1/setup.lock
flock -n 9 || { echo 'Another setup is running'; exit 1; }
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
# Use a distinct existing test deployer. Never reinterpret a wrong owner key.
if [ ! -f /etc/globaldroptrade/migration-deployer.key ] && [ ! -f /root/global-testnet-v071/.testnet-server/deployer.key ]; then
 echo 'DEPLOYER_KEY_NOT_FOUND: put the existing deployer key in /etc/globaldroptrade/migration-deployer.key (root-only mode 600).'; exit 1
fi
# Node checks the existing file's owner, permissions and wallet address before signing.
systemctl reset-failed globaldroptrade-migration.service 2>/dev/null || true
systemd-run --unit=globaldroptrade-migration --collect \
 --property=Type=exec --property=UMask=0077 \
 --property="WorkingDirectory=$PWD" \
 /usr/bin/flock -n /var/lib/globaldroptrade/migration-v1/run.lock \
 "$runtime/node" --env-file=/etc/globaldroptrade/trades.env \
 "$PWD/scripts/migrate-testnet-server.mjs"
echo 'Started. Only BNB Testnet 97; maximum combined transaction fee budget: 0.1 test BNB.'
echo 'Status: journalctl -u globaldroptrade-migration -n 40 --no-pager'
echo 'Report: /var/lib/globaldroptrade/migration-v1/report.json'
echo 'Keep this checkout and journal until the migration completes. Website/API are not switched by this command.'
