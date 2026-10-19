#!/usr/bin/env bash
# Installs only the testnet wallet migration console; sends no transactions.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
python3 - <<'PY'
import pathlib,re,shutil,tempfile,datetime
conf=pathlib.Path('/etc/nginx/sites-available/globaldroptrade.com')
enabled=pathlib.Path('/etc/nginx/sites-enabled/globaldroptrade.com')
if not conf.is_file() or not enabled.is_symlink() or enabled.resolve()!=conf.resolve():
    raise SystemExit('Active Global Nginx configuration not found; nothing changed')
roots=set(re.findall(r'^\s*root\s+(/var/www/globaldroptrade/releases/[^;\s]+);',conf.read_text(),re.M))
if len(roots)!=1: raise SystemExit('Expected exactly one managed web root; nothing changed')
root=pathlib.Path(roots.pop()).resolve()
if not root.is_dir() or root.parent!=pathlib.Path('/var/www/globaldroptrade/releases').resolve():
    raise SystemExit('Unexpected web root; nothing changed')
dest=root/'deploy'
if dest.is_symlink(): raise SystemExit('Unexpected deploy symlink; nothing changed')
names=['migrate.html','migrate.js','TestnetMigratedRewardsVault.json','DropshippingVault.json','ethers.js','style.css']
src=pathlib.Path('deployment-console')
for name in names:
    if not (src/name).is_file(): raise SystemExit('Missing file: '+name)
    if (dest/name).is_symlink(): raise SystemExit('Unexpected file symlink: '+name)
backup=pathlib.Path('/var/backups/globaldroptrade')/('migration-console-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S'))
backup.mkdir(parents=True,exist_ok=False)
dest.mkdir(exist_ok=True)
for name in names:
    target=dest/name
    if target.exists(): shutil.copy2(target,backup/name)
    with tempfile.NamedTemporaryFile(dir=dest,delete=False) as f:
        f.write((src/name).read_bytes());temporary=pathlib.Path(f.name)
    temporary.chmod(0o644);temporary.replace(target)
print('TESTNET_MIGRATION_CONSOLE_INSTALLED — backup: '+str(backup))
print('https://globaldroptrade.com/deploy/migrate.html')
print('No blockchain transaction sent. API and website contract address unchanged.')
PY
