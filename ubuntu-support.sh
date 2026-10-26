#!/usr/bin/env bash
# Update the public support frontend without restarting financial workers or API.
set +x
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$(id -u)" -eq 0 ] && [ "$#" -eq 0 ] || { echo 'Run as root without arguments'; exit 1; }
for tool in python3 curl nginx flock tar cmp; do command -v "$tool" >/dev/null; done
[ "$(df -Pk /var/www | awk 'NR==2 {print $4}')" -ge 131072 ] || { echo 'SUPPORT_INSTALL_REQUIRES_128_MIB_FREE'; exit 1; }
[ "$(df -Pi /var/www | awk 'NR==2 {print $4}')" -ge 2000 ] || { echo 'SUPPORT_INSTALL_REQUIRES_FREE_INODES'; exit 1; }
umask 077
backup=/var/backups/globaldroptrade/support-$(date -u +%Y%m%dT%H%M%S)-$$
python3 - "$backup" <<'PY'
import os,stat,sys
from pathlib import Path
p=Path(sys.argv[1]);p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
s=p.parent.lstat()
if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022:raise SystemExit('TRUSTED_SUPPORT_BACKUP_PARENT_REQUIRED')
p.mkdir(mode=0o700)
f=p.parent/'support.lock'
fd=os.open(f,os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600)
s=os.fstat(fd);os.close(fd)
if not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_mode&0o077:raise SystemExit('PRIVATE_SUPPORT_LOCK_REQUIRED')
PY
exec 9>/var/backups/globaldroptrade/support.lock
flock -n 9 || { echo 'SUPPORT_INSTALL_ALREADY_RUNNING'; exit 1; }
# Serialize with the existing target connection and RPC installers.
connection=/var/lib/globaldroptrade/fresh-fast-testnet-connection
python3 - "$connection" <<'PYLOCK'
import os,stat,sys
from pathlib import Path
p=Path(sys.argv[1]);s=p.lstat()
if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_mode&0o077:raise SystemExit('PRIVATE_CONNECTION_DIRECTORY_REQUIRED')
fd=os.open(p/'run.lock',os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600)
s=os.fstat(fd);os.close(fd)
if not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_mode&0o077:raise SystemExit('PRIVATE_CONNECTION_LOCK_REQUIRED')
PYLOCK
exec 8>"$connection/run.lock"
flock -n 8 || { echo 'ZERO_CONNECTION_ALREADY_RUNNING'; exit 1; }
conf=/etc/nginx/sites-available/globaldroptrade.com
snippet=/etc/nginx/snippets/globaldroptrade-api.conf
python3 - "$conf" "$snippet" "$backup" <<'PY'
import re,stat,sys
from pathlib import Path
conf,snippet,backup=map(Path,sys.argv[1:])
for p in [conf,snippet]:
 s=p.lstat()
 if not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022:raise SystemExit('MANAGED_SUPPORT_NGINX_REQUIRED')
roots=set(re.findall(r'^\s*root\s+(/var/www/globaldroptrade/releases/[^;\s]+);',conf.read_text(),re.M))
if len(roots)!=1:raise SystemExit('MANAGED_SUPPORT_SITE_ROOT_REQUIRED')
root=Path(roots.pop())
if root.is_symlink() or root.parent!=Path('/var/www/globaldroptrade/releases') or not (root/'index.html').is_file():raise SystemExit('MANAGED_SUPPORT_SITE_ROOT_REQUIRED')
(backup/'site-root').write_text(str(root))
PY
read_https(){ curl -fsS --noproxy '*' --connect-timeout 3 --max-time 15 --resolve globaldroptrade.com:443:127.0.0.1 "https://globaldroptrade.com/$1" -o "$2"; }
read_https api/config "$backup/config.json"
read_https api/community/announcements "$backup/announcements.json"
python3 - "$backup" <<'PY'
import json,sys
from pathlib import Path
p=Path(sys.argv[1]);c=json.loads((p/'config.json').read_text());a=json.loads((p/'announcements.json').read_text())
if c.get('chainId')!=97 or str(c.get('vaultAddress','')).lower()!='0x04e26fcaa198d21cef6d04e1e54f9c5f6399e522':raise SystemExit('CONNECTED_FAST_TESTNET_REQUIRED')
if not isinstance(a.get('items'),list):raise SystemExit('SUPPORT_API_REQUIRED')
PY
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
bash scripts/unpack-website.sh "$stage"
tar -xzf "$stage/website-release.tar.gz" -C "$stage"
old_root=$(cat "$backup/site-root")
# Keep the existing versioned status, wallet consoles and their local assets.
if [ -d "$old_root/deploy" ]; then cp -a "$old_root/deploy" "$stage/globaldroptrade-package/site/deploy"; fi
cp -p "$conf" "$backup/site.conf"
cp -p "$snippet" "$backup/api.conf"
rollback(){
 trap - ERR INT TERM
 set +e
 restored=1
 cp -p "$backup/site.conf" "$conf" || restored=0
 cp -p "$backup/api.conf" "$snippet" || restored=0
 nginx -t && systemctl reload nginx || restored=0
 echo "SUPPORT_INSTALL_FAILED recoveryVerified=$restored backup=$backup"
 exit 1
}
trap rollback ERR INT TERM
unset GLOBAL_SITE_IP GLOBAL_SITE_PORT
env -u GLOBAL_SITE_IP -u GLOBAL_SITE_PORT bash "$stage/globaldroptrade-package/install.sh"
healthy=0
for attempt in {1..10}; do
 if read_https "?support_release=${backup##*/}" "$backup/served.html" && cmp -s "$stage/globaldroptrade-package/site/index.html" "$backup/served.html"; then healthy=1;break;fi
 sleep 1
done
[ "$healthy" -eq 1 ] || { echo 'SUPPORT_FRONTEND_HEALTH_FAILED'; false; }
read_https api/config "$backup/config-after.json"
read_https api/community/announcements "$backup/announcements-after.json"
python3 - "$backup" <<'PY'
import json,sys
from pathlib import Path
p=Path(sys.argv[1])
if json.loads((p/'config.json').read_text())!=json.loads((p/'config-after.json').read_text()):raise SystemExit('SUPPORT_TARGET_CHANGED')
if not isinstance(json.loads((p/'announcements-after.json').read_text()).get('items'),list):raise SystemExit('SUPPORT_API_HEALTH_FAILED')
PY
trap - ERR INT TERM
echo "GLOBAL_SUPPORT_FRONTEND_READY backup=$backup"
echo 'Reload the website. Support sign-in uses a wallet message, not a transaction.'
echo 'The API, workers, contract, accounts, keys and financial journals were preserved.'
