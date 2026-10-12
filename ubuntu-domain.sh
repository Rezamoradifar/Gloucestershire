#!/usr/bin/env bash
# Publish the verified testnet frontend on the requested domain and keep port 8961.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$(id -u)" -eq 0 ] || { echo 'Run as root: sudo bash ubuntu-domain.sh'; exit 1; }
for tool in python3 nginx certbot curl systemctl; do command -v "$tool" >/dev/null || { echo "Missing dependency: $tool"; exit 1; }; done
target_ip=104.167.16.102
target_port=8961
python3 - "$target_ip" <<'PY'
import socket,sys
for host in ('globaldroptrade.com','www.globaldroptrade.com'):
    addresses={row[4][0] for row in socket.getaddrinfo(host,80,socket.AF_INET,socket.SOCK_STREAM)}
    if addresses!={sys.argv[1]}:
        raise SystemExit(f'DNS mismatch for {host}; expected only {sys.argv[1]}. No Nginx configuration changed.')
print('DNS matches the requested server for the domain and www.')
PY
backup_dir="/var/backups/globaldroptrade/nginx-$(date -u +%Y%m%dT%H%M%S)-$$"
install -d -m 700 "$backup_dir"
cp -a /etc/nginx "$backup_dir/nginx"
echo "Nginx backup: $backup_dir/nginx"
export VITE_CHAIN_ID=97
export VITE_VAULT_ADDRESS=0x7f19354B765920B9b17003d0840EEaA133883DcA
bash ubuntu-ip-website.sh "$target_ip" "$target_port"
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
install -d -m 755 "$stage/site"
cp -R website/dist/. "$stage/site/"
cp -R deployment-console "$stage/site/deploy"
cp scripts/install-website.sh "$stage/install.sh"
# Select the domain virtual host, independent of the temporary IP:port host.
env -u GLOBAL_SITE_IP -u GLOBAL_SITE_PORT bash "$stage/install.sh"
if command -v ufw >/dev/null && LC_ALL=C ufw status | grep -q '^Status: active'; then
 ufw allow 80/tcp
 ufw allow 443/tcp
 ufw allow "$target_port/tcp"
fi
contact=(--register-unsafely-without-email)
if [ -n "${CERTBOT_EMAIL:-}" ]; then contact=(--email "$CERTBOT_EMAIL"); fi
if ! certbot --nginx --non-interactive --agree-tos --redirect --keep-until-expiring \
 "${contact[@]}" -d globaldroptrade.com -d www.globaldroptrade.com; then
 echo "Certificate setup failed. Nginx backup: $backup_dir/nginx"
 echo 'HTTPS has not been confirmed. Check certificate output and port 80 reachability before retrying.'
 exit 1
fi
nginx -t
systemctl reload nginx
systemctl enable --now certbot.timer
for domain in globaldroptrade.com www.globaldroptrade.com; do
 curl -fsSL --max-time 20 --resolve globaldroptrade.com:443:127.0.0.1 \
  --resolve www.globaldroptrade.com:443:127.0.0.1 "https://$domain/" -o "$stage/https.html"
 cmp -s website/dist/index.html "$stage/https.html" || { echo 'HTTPS content mismatch; installation is not confirmed.'; exit 1; }
done
echo 'HTTPS_READY https://globaldroptrade.com'
echo 'WWW_READY https://www.globaldroptrade.com'
echo "IP_SITE_PRESERVED http://$target_ip:$target_port"
echo 'Contract address configured on BNB Testnet. No blockchain transaction was sent.'
