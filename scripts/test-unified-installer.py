"""Verify upgrade ordering and rollback against isolated fake host services."""
import json, os, shutil, subprocess, tarfile, tempfile
from pathlib import Path
repo = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    for name in ['source/scripts', 'bin', 'etc/nginx', 'etc/globaldroptrade', 'etc/systemd/system', 'api/old', 'api/new', 'backups']:
        (root/name).mkdir(parents=True)
    source = root/'source'
    replacements = {'/etc/nginx': str(root/'etc/nginx'), '/etc/globaldroptrade': str(root/'etc/globaldroptrade'),
                    '/etc/systemd/system': str(root/'etc/systemd/system'), '/opt/globaldroptrade-api': str(root/'api'),
                    '/var/backups/globaldroptrade': str(root/'backups')}
    script = (repo/'ubuntu-unified.sh').read_text()
    for old, new in replacements.items(): script = script.replace(old, new)
    (source/'ubuntu-unified.sh').write_text(script)
    package = root/'fixture/globaldroptrade-package'
    (package/'site').mkdir(parents=True)
    (package/'site/index.html').write_text('verified-new-index')
    (package/'install.sh').write_text(f'printf new-nginx > "{root}/etc/nginx/site.conf"\n')
    archive = root/'fixture.tar.gz'
    with tarfile.open(archive, 'w:gz') as tar: tar.add(package, arcname='globaldroptrade-package')
    (source/'scripts/unpack-website.sh').write_text(f'cp "{archive}" "$1/website-release.tar.gz"\n')
    (source/'ubuntu-api.sh').write_text(f'ln -sfn "{root}/api/new" "{root}/api/current"\nprintf new-service > "{root}/etc/systemd/system/globaldroptrade-api.service"\n')
    address = '0x1111111111111111111111111111111111111111'
    expected = {'version': 1, 'chainId': 97, 'vaultAddress': address, 'approvalRequired': False}
    node = shutil.which('node')
    commands = {
        'node': f'''if [[ "$*" = *scripts/preflight-unified.mjs* ]]; then
 [ ! -f '{root}/preflight-fail' ] || exit 1
 printf '%s' '{json.dumps(expected)}' > "${{@: -1}}/connection-public.json"
 exit 0
fi
exec '{node}' "$@"''',
        'npm': 'exit 0', 'nginx': 'exit 0', 'systemctl': 'exit 0', 'sleep': 'exit 0',
        'id': 'echo 0',
        'curl': f'''out=''
while [ "$#" -gt 0 ]; do
 if [ "$1" = -o ]; then out=$2; shift 2; else shift; fi
done
case "$out" in
 */served-config.json)
  if [ -f '{root}/target-fail' ]; then printf '%s' '{{"version":1,"chainId":56,"vaultAddress":"{address}"}}' > "$out";
  else printf '%s' '{json.dumps(expected)}' > "$out"; fi;;
 *) if [ -f '{root}/https-fail' ]; then printf old-index > "$out"; else printf verified-new-index > "$out"; fi;;
esac'''
    }
    for name, body in commands.items():
        file = root/'bin'/name; file.write_text('#!/bin/bash\n'+body+'\n'); file.chmod(0o755)
    envfile = root/'etc/globaldroptrade/trades.env'
    unit = root/'etc/systemd/system/globaldroptrade-api.service'
    config = root/'etc/nginx/site.conf'
    current = root/'api/current'
    envfile.write_text('TRADES_RPC_URL=https://private.invalid/credential\nKEEP=this\n')
    env = {**os.environ, 'PATH': str(root/'bin')+':'+os.environ['PATH']}
    def reset():
        unit.write_text('old-service'); config.write_text('old-nginx')
        if current.is_symlink(): current.unlink()
        current.symlink_to(root/'api/old', target_is_directory=True)
    def run(): return subprocess.run(['bash', str(source/'ubuntu-unified.sh')], cwd=source, env=env, capture_output=True, text=True)
    reset(); result = run()
    assert result.returncode == 0, result.stderr
    assert current.resolve() == root/'api/new' and config.read_text() == 'new-nginx'
    assert 'UNIFIED_FRONTEND_API_READY' in result.stdout and 'AUTOMATION_NOT_ACTIVE' in result.stdout
    for failure in ['preflight-fail', 'https-fail', 'target-fail']:
        reset(); flag = root/failure; flag.touch(); result = run(); flag.unlink()
        assert result.returncode != 0, failure
        assert current.resolve() == root/'api/old' and unit.read_text() == 'old-service' and config.read_text() == 'old-nginx', failure
        assert 'UNIFIED_FRONTEND_API_READY' not in result.stdout
        assert 'credential' not in result.stdout+result.stderr
    assert envfile.read_text() == 'TRADES_RPC_URL=https://private.invalid/credential\nKEEP=this\n'
    print('PASS: active-target preflight; prebuilt frontend/API activation; HTTPS and target mismatch rollback; private settings preserved; legacy automation never marked active.')
