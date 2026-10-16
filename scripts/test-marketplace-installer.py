"""Verify update orchestration preserves public chain config and rolls back on failure."""
import os, subprocess, tempfile
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory() as directory:
 p=Path(directory)
 for path in ['bin','scripts','server','website/dist/assets','etc/nginx','etc/globaldroptrade','etc/systemd/system','opt/globaldroptrade-api/old','opt/globaldroptrade-api/new','deployment-console']:(p/path).mkdir(parents=True,exist_ok=True)
 source=(root/'ubuntu-marketplace.sh').read_text()
 for prefix in ['/etc/','/opt/','/var/']:source=source.replace(prefix,str(p)+prefix)
 (p/'ubuntu-marketplace.sh').write_text(source)
 envfile=p/'etc/globaldroptrade/trades.env';envfile.write_text('TRADES_CHAIN_ID=56\nTRADES_VAULT_ADDRESS=0x1234567890123456789012345678901234567890\nEBAY_CLIENT_SECRET=do-not-print\n');original_env=envfile.read_text()
 unit=p/'etc/systemd/system/globaldroptrade-api.service';unit.write_text('previous service')
 conf=p/'etc/nginx/site';conf.write_text('original TLS config')
 current=p/'opt/globaldroptrade-api/current';current.symlink_to(p/'opt/globaldroptrade-api/old')
 (p/'website/dist/index.html').write_text('verified-build')
 (p/'scripts/website-assets.sh').write_text('exit 0\n')
 (p/'scripts/install-website.sh').write_text(f'echo "new TLS config" > "{conf}"\n')
 (p/'ubuntu-api.sh').write_text(f'ln -sfn "{p}/opt/globaldroptrade-api/new" "{current}"\necho new > "{unit}"\n')
 stubs={
 'id':'echo 0', 'nginx':'exit 0','systemctl':'exit 0',
 'node':'''if [[ "$*" == *readConfig* ]]; then echo '56 0x1234567890123456789012345678901234567890'; fi''',
 'npm':f'''[[ "$*" == *--omit=dev* ]] && exit 0
[ "$VITE_CHAIN_ID" = 56 ] && [ "$VITE_VAULT_ADDRESS" = 0x1234567890123456789012345678901234567890 ] || exit 8
echo checked > "{p}/build-env-checked"''',
 'curl':f'''[ ! -f "{p}/fail" ] || exit 22
while [ $# -gt 0 ]; do if [ "$1" = -o ]; then shift; target="$1"; fi; shift; done
case "$target" in *https.html) printf verified-build > "$target";; *) printf '{{"providers":[]}}' > "$target";; esac'''
 }
 for name,body in stubs.items():
  f=p/'bin'/name;f.write_text('#!/bin/bash\n'+body+'\n');f.chmod(0o755)
 env={**os.environ,'PATH':str(p/'bin')+':'+os.environ['PATH']}
 def run():return subprocess.run(['bash',str(p/'ubuntu-marketplace.sh')],env=env,capture_output=True,text=True)
 result=run();assert result.returncode==0,result.stderr
 assert (p/'build-env-checked').exists() and envfile.read_text()==original_env
 assert current.resolve()==p/'opt/globaldroptrade-api/new'
 conf.write_text('original TLS config');unit.write_text('previous service');current.unlink();current.symlink_to(p/'opt/globaldroptrade-api/old');(p/'fail').touch()
 result=run();assert result.returncode!=0
 assert conf.read_text()=='original TLS config' and unit.read_text()=='previous service'
 assert current.resolve()==p/'opt/globaldroptrade-api/old' and envfile.read_text()==original_env
 assert 'do-not-print' not in result.stdout+result.stderr
 print('PASS: current chain/address used by build; credentials preserved; failure restores API release, service and TLS config (mock services).')
