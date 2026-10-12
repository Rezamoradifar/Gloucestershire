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
site_port=${GLOBAL_SITE_PORT:-80}
[[ "$site_port" =~ ^[1-9][0-9]{0,4}$ ]] && [ "$site_port" -le 65535 ] || { echo 'Invalid HTTP port'; exit 1; }
if [ -z "${GLOBAL_SITE_IP:-}" ] && [ "$site_port" != 80 ]; then echo 'Custom HTTP ports require GLOBAL_SITE_IP'; exit 1; fi
if [ -n "${GLOBAL_SITE_IP:-}" ]; then
 [[ "$GLOBAL_SITE_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || { echo 'Invalid IPv4 address'; exit 1; }
 IFS=. read -r -a octets <<< "$GLOBAL_SITE_IP"
 for octet in "${octets[@]}"; do
  [ "$((10#$octet))" -le 255 ] && { [ "$octet" = 0 ] || [[ "$octet" != 0* ]]; } || { echo 'Invalid IPv4 address'; exit 1; }
 done
 site_host=$GLOBAL_SITE_IP
 server_names=$GLOBAL_SITE_IP
 config_name="globaldroptrade-ip-$GLOBAL_SITE_IP"
 if [ "$site_port" != 80 ]; then config_name="$config_name-$site_port"; fi
fi
site_url="http://$site_host"
if [ "$site_port" != 80 ]; then site_url="$site_url:$site_port"; fi
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
elif [ "$site_port" = 80 ] && awk -v host="$site_host" '$1=="server_name" {for(i=2;i<=NF;i++){name=$i;sub(/;$/,"",name);if(name==host)found=1}} END{exit !found}' "$backup_dir/nginx.before"; then
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
    listen $site_port;
    listen [::]:$site_port;
    server_name $server_names;
    include $api_snippet;
    root $release;
    index index.html;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    location / { try_files \$uri \$uri/ /index.html; }
    location /assets/ { try_files \$uri =404; expires 30d; }
    location ~ \\.mjs\$ { types { text/javascript mjs; } try_files \$uri =404; }
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
if ! nginx -t > "$backup_dir/nginx-check" 2>&1 || grep -Fq "conflicting server name \"$site_host\"" "$backup_dir/nginx-check"; then
 cat "$backup_dir/nginx-check"
 restore_config; echo 'Invalid or conflicting config; original configuration restored.'; exit 1
fi
cat "$backup_dir/nginx-check"
if ! systemctl enable --now nginx || ! systemctl reload nginx; then
 restore_config
 nginx -t && systemctl reload nginx || true
 echo 'Reload failed; original configuration restored.'; exit 1
fi
if [ -n "${GLOBAL_SITE_IP:-}" ]; then
 # nginx reload returns before new workers necessarily serve requests. Poll for
 # the exact release, bypassing shell proxies and caches, before rolling back.
 healthy=0
 for attempt in {1..10}; do
  rm -f "$backup_dir/served.html"
  if curl -fsS --noproxy '*' --connect-timeout 2 --max-time 3 \
   -H "Host: $site_host:$site_port" -H 'Cache-Control: no-cache' -H 'Connection: close' \
   "http://127.0.0.1:$site_port/?global_release=${release##*/}" \
   -D "$backup_dir/served.headers" -w '%{http_code}' -o "$backup_dir/served.html" \
   > "$backup_dir/http-status" 2> "$backup_dir/curl-error" \
   && cmp -s site/index.html "$backup_dir/served.html"; then
   healthy=1; break
  fi
  if [ "$attempt" -eq 1 ]; then echo "Waiting for the new frontend on port $site_port..."; fi
  if [ "$attempt" -lt 10 ]; then sleep 1; fi
 done
 if [ "$healthy" -ne 1 ]; then
  diagnostic_dir="/var/log/globaldroptrade/install-failure-$(date -u +%Y%m%dT%H%M%S)-$$"
  # Reporting must never prevent rollback if the log filesystem is full.
  if install -d -m 700 "$diagnostic_dir"; then
   cp "$conf" "$diagnostic_dir/site.conf" || true
   cp site/index.html "$diagnostic_dir/expected.html" || true
   for file in served.html served.headers http-status curl-error; do
    if [ -f "$backup_dir/$file" ]; then cp "$backup_dir/$file" "$diagnostic_dir/$file" || true; fi
   done
   echo "Diagnostics: $diagnostic_dir"
  fi
  echo "Health check failed after 10 attempts. Host: $site_host:$site_port"
  printf 'Last HTTP status: '; cat "$backup_dir/http-status" || true; echo
  printf 'Expected HTML: '; sha256sum site/index.html || true
  if [ -f "$backup_dir/served.html" ]; then printf 'Received HTML: '; sha256sum "$backup_dir/served.html" || true; fi
  if [ -s "$backup_dir/curl-error" ]; then cat "$backup_dir/curl-error" || true; fi
  restore_config
  nginx -t && systemctl reload nginx || true
  echo 'IP site health check failed; original configuration restored.'; exit 1
 fi
 echo "SITE_READY $site_url"
else
 echo 'Site installed: globaldroptrade.com (existing SSL settings preserved)'
 echo 'If SSL is not enabled: sudo certbot --nginx -d globaldroptrade.com -d www.globaldroptrade.com --redirect'
fi
