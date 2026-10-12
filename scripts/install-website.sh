#!/usr/bin/env bash
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo 'Run with sudo bash ubuntu-website.sh'; exit 1; }
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
test -s site/index.html
command -v nginx >/dev/null
nginx -t
site_host=globaldroptrade.com
server_names='globaldroptrade.com www.globaldroptrade.com'
config_name=globaldroptrade.com
if [ -n "${GLOBAL_SITE_IP:-}" ]; then
 [[ "$GLOBAL_SITE_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || { echo 'Invalid IPv4 address'; exit 1; }
 IFS=. read -r -a octets <<< "$GLOBAL_SITE_IP"
 for octet in "${octets[@]}"; do
  [ "$((10#$octet))" -le 255 ] && { [ "$octet" = 0 ] || [[ "$octet" != 0* ]]; } || { echo 'Invalid IPv4 address'; exit 1; }
 done
 site_host=$GLOBAL_SITE_IP
 server_names=$GLOBAL_SITE_IP
 config_name="globaldroptrade-ip-$GLOBAL_SITE_IP"
fi
conf="/etc/nginx/sites-available/$config_name"
link="/etc/nginx/sites-enabled/$config_name"
backup_dir=$(mktemp -d)
trap 'rm -rf -- "$backup_dir"' EXIT
nginx -T > "$backup_dir/nginx.before" 2>&1
api_snippet=/etc/nginx/snippets/globaldroptrade-api.conf
snippet_existed=0
if [ -e "$api_snippet" ]; then
 [ -f "$api_snippet" ] && [ ! -L "$api_snippet" ] && grep -q '^# Managed by Global Drop Trade' "$api_snippet" || { echo 'Unexpected API snippet; stopped to preserve it.'; exit 1; }
 cp -p "$api_snippet" "$backup_dir/api-original.conf"
 snippet_existed=1
fi
existed=0
if [ -f "$conf" ] && [ ! -L "$conf" ]; then
 grep -Fq "server_name $server_names;" "$conf" || { echo 'Unexpected site config; stopped without changing it.'; exit 1; }
 grep -Eq '^[[:space:]]*root[[:space:]]+/var/www/globaldroptrade/releases/[^;[:space:]]+;' "$conf" || { echo 'Unexpected site root; stopped without changing it.'; exit 1; }
 [ -L "$link" ] && [ "$(readlink -f "$link")" = "$conf" ] || { echo 'Unexpected enabled-site configuration; stopped.'; exit 1; }
 cp -p "$conf" "$backup_dir/original.conf"
 if grep -Eq 'location[[:space:]]+[^;{]*\/api' "$conf"; then echo 'Existing custom API location found; stopped to preserve it.'; exit 1; fi
 existed=1
elif [ -e "$conf" ] || [ -L "$conf" ] || [ -e "$link" ] || [ -L "$link" ]; then
 echo 'Unexpected config path; stopped.'; exit 1
elif awk -v host="$site_host" '$1=="server_name" {for(i=2;i<=NF;i++){name=$i;sub(/;$/,"",name);if(name==host)found=1}} END{exit !found}' "$backup_dir/nginx.before"; then
 echo 'Host is configured elsewhere; stopped to preserve it.'; exit 1
fi
release="/var/www/globaldroptrade/releases/$(date -u +%Y%m%dT%H%M%S)-$$"
install -d -m 755 "$release"
cp -R site/. "$release/"
find "$release" -type d -exec chmod 755 {} +
find "$release" -type f -exec chmod 644 {} +
if [ "$existed" -eq 1 ]; then
 sed -E "s#(^[[:space:]]*root[[:space:]]+)/var/www/globaldroptrade/releases/[^;[:space:]]+;#\1$release;#" "$backup_dir/original.conf" > "$backup_dir/new.conf"
 if ! grep -Fq "include $api_snippet;" "$backup_dir/new.conf"; then
  sed -i "/server_name /a\\    include $api_snippet;" "$backup_dir/new.conf"
 fi
else
 cat > "$backup_dir/new.conf" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $server_names;
    include $api_snippet;
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
 if [ "$snippet_existed" -eq 1 ]; then cp -p "$backup_dir/api-original.conf" "$api_snippet"; else rm -f "$api_snippet"; fi
}
install -d -m 755 /etc/nginx/snippets
cat > "$api_snippet" <<'API'
# Managed by Global Drop Trade - read-only settlement feed
location /api/ {
    proxy_pass http://127.0.0.1:3115;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 3s;
    proxy_read_timeout 15s;
    add_header Cache-Control "no-store" always;
}
API
install -m 644 "$backup_dir/new.conf" "$conf"
if [ "$existed" -eq 0 ]; then ln -s "$conf" "$link"; fi
if ! nginx -t; then restore_config; echo 'Invalid config; original configuration restored.'; exit 1; fi
if ! systemctl enable --now nginx || ! systemctl reload nginx; then
 restore_config
 nginx -t && systemctl reload nginx || true
 echo 'Reload failed; original configuration restored.'; exit 1
fi
if [ -n "${GLOBAL_SITE_IP:-}" ]; then
 if ! curl -fsS --max-time 15 -H "Host: $site_host" http://127.0.0.1/ -o "$backup_dir/served.html" || ! cmp -s site/index.html "$backup_dir/served.html"; then
  restore_config
  nginx -t && systemctl reload nginx || true
  echo 'IP site health check failed; original configuration restored.'; exit 1
 fi
 echo "SITE_READY http://$site_host"
else
 echo 'Site installed: globaldroptrade.com (existing SSL settings preserved)'
 echo 'If SSL is not enabled: sudo certbot --nginx -d globaldroptrade.com -d www.globaldroptrade.com --redirect'
fi
