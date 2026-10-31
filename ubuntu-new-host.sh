#!/usr/bin/env bash
# Prepare a separate Ubuntu host; never deploy a contract or start a signer here.
set +x
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

mode=${1:-}
shift || true
target_ip=''
if [ "$#" -eq 2 ] && [ "$1" = --target-ip ]; then target_ip=$2; else
  echo 'Usage: bash ubuntu-new-host.sh --prepare|--restore|--finish-testnet --target-ip 185.114.206.44'; exit 1
fi
case "$mode" in --prepare|--restore|--finish-testnet) ;; *) echo 'HOST_INSTALL_MODE_REQUIRED'; exit 1;; esac
[ "$(id -u)" -eq 0 ] || { echo 'HOST_INSTALL_ROOT_REQUIRED'; exit 1; }
[ "$target_ip" = 185.114.206.44 ] || { echo 'HOST_INSTALL_EXPECTED_DESTINATION_REQUIRED'; exit 1; }
[ "$(hostname -s)" != vps-cosmos-8569 ] || { echo 'HOST_INSTALL_RUN_ON_NEW_SERVER'; exit 1; }
case " $(hostname -I) " in
  *" $target_ip "*) ;;
  *) echo 'HOST_INSTALL_DESTINATION_IP_NOT_LOCAL'; exit 1;;
esac
[ -f /etc/os-release ] || { echo 'HOST_INSTALL_UBUNTU_REQUIRED'; exit 1; }
# This trusted, root-owned operating-system file contains shell-compatible values.
. /etc/os-release
[ "${ID:-}" = ubuntu ] || { echo 'HOST_INSTALL_UBUNTU_REQUIRED'; exit 1; }
case "${VERSION_ID:-}" in 22.04|24.04) ;; *) echo 'HOST_INSTALL_UBUNTU_22_OR_24_REQUIRED'; exit 1;; esac
case "$(uname -m)" in x86_64|aarch64|arm64) ;; *) echo 'HOST_INSTALL_UNSUPPORTED_ARCHITECTURE'; exit 1;; esac
for tool in python3 systemctl flock; do command -v "$tool" >/dev/null || { echo "HOST_INSTALL_MISSING_TOOL=$tool"; exit 1; }; done

state=/var/lib/globaldroptrade-host-migration
python3 - "$state" <<'PY'
import os, stat, sys
from pathlib import Path
p = Path(sys.argv[1])
if p.is_symlink(): raise SystemExit('HOST_INSTALL_PRIVATE_STATE_REQUIRED')
p.mkdir(mode=0o700, exist_ok=True)
s = p.lstat()
if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o077:
    raise SystemExit('HOST_INSTALL_PRIVATE_STATE_REQUIRED')
fd = os.open(p/'prepare.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
s = os.fstat(fd); os.close(fd)
if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o077:
    raise SystemExit('HOST_INSTALL_PRIVATE_LOCK_REQUIRED')
PY
exec 9>"$state/prepare.lock"
flock -n 9 || { echo 'HOST_INSTALL_ALREADY_RUNNING'; exit 1; }

if [ "$mode" = --restore ] || [ "$mode" = --finish-testnet ]; then
  python3 scripts/host-restore.py --execute
  if [ "$mode" = --finish-testnet ]; then
    case "$(uname -m)" in x86_64) runtime_arch=x64;; aarch64|arm64) runtime_arch=arm64;; esac
    runtime="/opt/globaldroptrade-node/node-v22.23.3-linux-$runtime_arch/bin"
    [ -x "$runtime/node" ] || { echo 'HOST_INSTALL_COPIED_NODE_REQUIRED'; exit 1; }
    export PATH="$runtime:$PATH"
    # The reviewed reset validates chain, old generation, pending journals and
    # saved session before any deployment. Never replace or clear its state.
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund
    bash ubuntu-reset-fast-testnet-20261031.sh --execute
  fi
  exit
fi

python3 - "$state" "$target_ip" <<'PY'
import glob, json, os, stat, sys
from pathlib import Path
state = Path(sys.argv[1]); marker = state/'prepared.json'
if marker.exists() or marker.is_symlink():
    s = marker.lstat()
    if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o077:
        raise SystemExit('HOST_INSTALL_PRIVATE_MARKER_REQUIRED')
    m = json.loads(marker.read_text())
    if m.get('version') != 1 or m.get('destinationIp') != sys.argv[2] or m.get('phase') != 'prepared':
        raise SystemExit('HOST_INSTALL_MARKER_REVIEW_REQUIRED')
roots = ['/etc/globaldroptrade', '/var/lib/globaldroptrade', '/var/lib/globaldroptrade-api',
         '/var/www/globaldroptrade', '/var/backups/globaldroptrade']
roots += [p for p in glob.glob('/opt/globaldroptrade-*') if p != '/opt/globaldroptrade-host-bootstrap']
roots += glob.glob('/etc/systemd/system/globaldroptrade-*')
roots += glob.glob('/etc/nginx/sites-available/*globaldroptrade*')
roots += glob.glob('/etc/nginx/sites-enabled/*globaldroptrade*')
if any(os.path.lexists(p) for p in roots):
    raise SystemExit('HOST_INSTALL_EXISTING_GLOBAL_FILES_REVIEW_REQUIRED')
PY

[ "$(df -Pk /opt /var/lib /root | awk 'NR>1 {if ($4<4194304) bad=1} END {print bad+0}')" -eq 0 ] || {
  echo 'HOST_INSTALL_REQUIRES_4_GIB_FREE'; exit 1;
}
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install --no-install-recommends -y \
  ca-certificates curl git rsync xz-utils python3 nginx certbot \
  python3-certbot-nginx openssh-client iproute2 util-linux
if ! id globaldroptrade-api >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin globaldroptrade-api
fi
if command -v ufw >/dev/null && LC_ALL=C ufw status | awk 'NR==1 {active=($0=="Status: active")} END {exit !active}'; then
  ufw allow 80/tcp
  ufw allow 443/tcp
fi
python3 - "$state" "$target_ip" <<'PY'
import json, os, platform, tempfile, sys
from pathlib import Path
p = Path(sys.argv[1]); path = p/'prepared.json'
value = {'version': 1, 'destinationIp': sys.argv[2], 'phase': 'prepared',
         'destinationArchitecture': platform.machine()}
fd, name = tempfile.mkstemp(prefix='.prepared-', dir=p)
with os.fdopen(fd, 'w') as f:
    json.dump(value, f); f.flush(); os.fsync(f.fileno())
os.replace(name, path)
fd = os.open(p, os.O_DIRECTORY)
try: os.fsync(fd)
finally: os.close(fd)
PY
echo "GLOBAL_NEW_HOST_PREPARED target=$target_ip"
echo 'The destination has no active Global signing worker. Transfer existing private configuration and journals from the old server next.'
echo 'Do not run the legacy domain/community installers on this host: their historical IP and contract settings are fixed.'
