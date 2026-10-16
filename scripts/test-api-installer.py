"""Exercise API release activation, environment preservation and rollback with mocked host services."""
import os, subprocess, tempfile
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory() as directory:
    p=Path(directory);(p/'bin').mkdir();(p/'server').mkdir();(p/'etc/systemd/system').mkdir(parents=True)
    source=(root/'ubuntu-api.sh').read_text().replace('/opt/globaldroptrade-api',str(p/'opt/api')).replace('/etc/globaldroptrade',str(p/'etc/globaldroptrade')).replace('/etc/systemd/system',str(p/'etc/systemd/system'))
    (p/'ubuntu-api.sh').write_text(source)
    for name in ['trades-api.mjs','community.mjs','marketplace.mjs','trades.env.example']:(p/'server'/name).write_bytes((root/'server'/name).read_bytes())
    for name in ['package.json','package-lock.json']:(p/name).write_bytes((root/name).read_bytes())
    for name,body in {
        'node':'exit 0', 'npm':'exit 0', 'id':'if [ "$1" = "-u" ]; then echo 0; fi; exit 0', 'useradd':'exit 0', 'sleep':'exit 0',
        'systemctl':f'echo "$*" >> "{p}/calls"; exit 0',
        'curl':f'[ ! -f "{p}/unhealthy" ]'
    }.items():
        f=p/'bin'/name;f.write_text('#!/bin/bash\n'+body+'\n');f.chmod(0o755)
    env={**os.environ,'PATH':str(p/'bin')+':'+os.environ['PATH']}
    def run():return subprocess.run(['bash',str(p/'ubuntu-api.sh')],cwd=p,env=env,capture_output=True,text=True)
    result=run();assert result.returncode==0,result.stderr
    current=p/'opt/api/current';unit=p/'etc/systemd/system/globaldroptrade-api.service';envfile=p/'etc/globaldroptrade/trades.env'
    assert current.is_symlink() and (current/'server/trades-api.mjs').is_file()
    assert (current/'server/marketplace.mjs').is_file()
    assert envfile.stat().st_mode&0o777==0o600
    assert 'User=globaldroptrade-api' in unit.read_text() and 'ProtectSystem=strict' in unit.read_text()
    envfile.write_text('TRADES_RPC_URL=https://example.invalid/keep-private\n')
    first=current.resolve();result=run();assert result.returncode==0,result.stderr
    assert current.resolve()!=first and 'keep-private' in envfile.read_text()
    previous=current.resolve();old_unit=unit.read_text();(p/'unhealthy').touch();result=run();assert result.returncode!=0
    assert current.resolve()==previous and unit.read_text()==old_unit and 'keep-private' in envfile.read_text()
    assert 'keep-private' not in result.stdout+result.stderr
    print('PASS: unprivileged API install; immutable release update; environment preservation; failed health check restores previous service/release (mock services).')
