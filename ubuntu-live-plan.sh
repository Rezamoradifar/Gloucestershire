#!/usr/bin/env bash
# Run the current public testnet scenario with the existing server test deployer.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
state_dir=${1:-/root/global-testnet-v071/.testnet-server}
[ -f "$state_dir/deployer.key" ] && [ -f "$state_dir/deployment-public.json" ] || {
 echo 'Existing TEST-ONLY DEPLOYER files not found. No new wallet or contract was created.'; exit 1;
}
for tool in curl tar xz sha256sum flock python3; do command -v "$tool" >/dev/null || { echo "Missing dependency: $tool"; exit 1; }; done
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo 'Unsupported CPU'; exit 1;; esac
version=v22.23.3
node_dir="$PWD/.runtime/node-$version-linux-$arch"
if [ ! -x "$node_dir/bin/node" ]; then
 mkdir -p .runtime
 archive="node-$version-linux-$arch.tar.xz"
 curl -fL --retry 2 --connect-timeout 20 --max-time 300 --proto '=https' "https://nodejs.org/dist/$version/$archive" -o ".runtime/$archive"
 curl -fL --retry 2 --connect-timeout 20 --max-time 60 --proto '=https' "https://nodejs.org/dist/$version/SHASUMS256.txt" -o .runtime/SHASUMS256.txt
 (cd .runtime && awk -v f="$archive" '$2==f {print}' SHASUMS256.txt > selected.sha256 && test -s selected.sha256 && sha256sum -c selected.sha256 && tar -xJf "$archive")
fi
export PATH="$node_dir/bin:$PATH"
npm ci --include=dev --ignore-scripts --no-audit --no-fund
npm run compile
# The lock lives with the persistent journal, so concurrent checkouts cannot replay.
flock -n "$state_dir/live-plan.lock" node scripts/live-plan-test.mjs "$state_dir"
# Only the two public reports may enter the web root. Never copy the key directory.
python3 - "$state_dir/live-plan-v1" <<'PY'
import json,pathlib,re,sys
reports=pathlib.Path(sys.argv[1])
report=json.loads((reports/'plan-public.json').read_text())
if report.get('status')!='completed' or report.get('chainId')!=97:
    raise SystemExit('Test incomplete; no completed report published')
roots=set()
for name in ('globaldroptrade.com','globaldroptrade-ip-104.167.16.102-8961'):
    config=pathlib.Path('/etc/nginx/sites-available')/name
    enabled=pathlib.Path('/etc/nginx/sites-enabled')/name
    if not config.is_file() or not enabled.is_symlink() or enabled.resolve()!=config.resolve():
        continue
    for raw in re.findall(r'^\s*root\s+(/var/www/globaldroptrade/releases/[^;\s]+);',config.read_text(),re.M):
        root=pathlib.Path(raw)
        if root.is_dir() and root.resolve().parent==pathlib.Path('/var/www/globaldroptrade/releases').resolve():
            roots.add(root)
for root in roots:
    for source,name in [('plan-public.html','testnet-plan.html'),('plan-public.json','testnet-plan.json')]:
        target=root/name
        if target.is_symlink(): raise SystemExit('Unexpected report symlink; stopped')
        temp=root/(name+'.tmp')
        with temp.open('xb') as out: out.write((reports/source).read_bytes())
        temp.chmod(0o644);temp.replace(target)
if roots:
    print('PUBLIC_REPORT_WRITTEN /testnet-plan.html')
    print('Open https://globaldroptrade.com/testnet-plan.html or http://104.167.16.102:8961/testnet-plan.html')
else:
    print('No managed active website root found; report saved only at '+str(reports/'plan-public.html'))
PY
