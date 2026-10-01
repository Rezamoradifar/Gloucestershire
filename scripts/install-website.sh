#!/usr/bin/env bash
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo 'Run with sudo bash ubuntu-website.sh'; exit 1; }
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
test -s site/index.html
command -v nginx >/dev/null
nginx -t
conf=/etc/nginx/sites-available/globaldroptrade.com
link=/etc/nginx/sites-enabled/globaldroptrade.com
backup_dir=$(mktemp -d)
trap 'rm -rf -- "$backup_dir"' EXIT
existed=0
if [ -f "$conf" ] && [ ! -L "$conf" ]; then
 grep -q 'server_name globaldroptrade.com www.globaldroptrade.com;' "$conf" || { echo 'Unexpected domain config; stopped without changing it.'; exit 1; }
 grep -Eq '^[[:space:]]*root[[:space:]]+/var/www/globaldroptrade/releases/[^;[:space:]]+;' "$conf" || { echo 'Unexpected site root; stopped without changing it.'; exit 1; }
 [ -L "$link" ] && [ "$(readlink -f "$link")" = "$conf" ] || { echo 'Unexpected enabled-site configuration; stopped.'; exit 1; }
 cp -p "$conf" "$backup_dir/original.conf"
 existed=1
elif [ -e "$conf" ] || [ -L "$conf" ] || [ -e "$link" ] || [ -L "$link" ]; then
 echo 'Unexpected config path; stopped.'; exit 1
elif nginx -T 2>&1 | grep -E '^[[:space:]]*server_name[[:space:]].*globaldroptrade\.com' >/dev/null; then
 echo 'Domain is configured elsewhere; stopped to preserve it.'; exit 1
fi
release="/var/www/globaldroptrade/releases/$(date -u +%Y%m%dT%H%M%S)-$$"
install -d -m 755 "$release"
cp -R site/. "$release/"
find "$release" -type d -exec chmod 755 {} +
find "$release" -type f -exec chmod 644 {} +
if [ "$existed" -eq 1 ]; then
 sed -E "s#(^[[:space:]]*root[[:space:]]+)/var/www/globaldroptrade/releases/[^;[:space:]]+;#\1$release;#" "$backup_dir/original.conf" > "$backup_dir/new.conf"
else
 cat > "$backup_dir/new.conf" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name globaldroptrade.com www.globaldroptrade.com;
    root $release;
    index index.html;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    location / { try_files \$uri \$uri/ /index.html; }
    location /assets/ { try_files \$uri =404; expires 30d; }
    location ~ /\\. { deny all; }
}
EOF
fi
restore_config() {
 if [ "$existed" -eq 1 ]; then cp -p "$backup_dir/original.conf" "$conf"; else rm -f "$link" "$conf"; fi
}
install -m 644 "$backup_dir/new.conf" "$conf"
if [ "$existed" -eq 0 ]; then ln -s "$conf" "$link"; fi
if ! nginx -t; then restore_config; echo 'Invalid config; original configuration restored.'; exit 1; fi
if ! systemctl enable --now nginx || ! systemctl reload nginx; then
 restore_config
 nginx -t && systemctl reload nginx || true
 echo 'Reload failed; original configuration restored.'; exit 1
fi
echo 'Site installed: globaldroptrade.com (existing SSL settings preserved)'
echo 'If SSL is not enabled: sudo certbot --nginx -d globaldroptrade.com -d www.globaldroptrade.com --redirect'
