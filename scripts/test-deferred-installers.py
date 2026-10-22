"""Verify owner-console installation and cutover rollback without contacting a host or chain."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

repo = Path(__file__).resolve().parent.parent
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('console_installer', repo/'scripts/install-deferred-console.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    for name in ['etc/nginx/sites-available', 'etc/nginx/sites-enabled', 'var/www/globaldroptrade/releases/current/deploy']:
        (root/name).mkdir(parents=True)
    conf = root/'etc/nginx/sites-available/globaldroptrade.com'
    conf.write_text('server {\n root /var/www/globaldroptrade/releases/current;\n}\n')
    (root/'etc/nginx/sites-enabled/globaldroptrade.com').symlink_to(conf)
    deploy = root/'var/www/globaldroptrade/releases/current/deploy'
    (deploy/'index.html').write_text('existing-deployment-console')
    folder = module.install_console(repo/'deployment-console', root)
    assert (deploy/folder/'wallet-bundle/wallet-client.js').is_file()
    assert (deploy/folder/'TestnetDeferredMigrationVault.json').is_file()
    assert (deploy/folder/'deferred-migration-core.js').is_file() and (deploy/folder/'deferred-wallet-journal.js').is_file()
    assert '.mjs' not in (deploy/folder/'deferred-migration.js').read_text()
    assert (deploy/'index.html').read_text() == 'existing-deployment-console'
    assert folder in (deploy/'deferred-migration.html').read_text()
    assert module.install_console(repo/'deployment-console', root) == folder
    (deploy/folder/'deferred-migration.js').write_text('tampered')
    try:
        module.install_console(repo/'deployment-console', root)
        raise AssertionError('tampered assets accepted')
    except ValueError:
        pass
    conf.write_text('server {\n root /tmp/unmanaged;\n}\n')
    try:
        module.install_console(repo/'deployment-console', root)
        raise AssertionError('unmanaged root accepted')
    except ValueError:
        pass

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    for name in ['source/scripts', 'bin', 'etc/nginx', 'etc/globaldroptrade', 'etc/systemd/system', 'api/old', 'api/new', 'state', 'public', 'backups']:
        (root/name).mkdir(parents=True)
    source = root/'source'
    replacements = {'/etc/nginx': str(root/'etc/nginx'), '/etc/globaldroptrade': str(root/'etc/globaldroptrade'),
                    '/etc/systemd/system': str(root/'etc/systemd/system'), '/opt/globaldroptrade-api': str(root/'api'),
                    '/var/backups/globaldroptrade': str(root/'backups'), '/var/lib/globaldroptrade': str(root/'state'),
                    '/var/www/globaldroptrade/migration-data': str(root/'public')}
    script = (repo/'ubuntu-connect-migrated-deferred.sh').read_text()
    for old, new in replacements.items():
        script = script.replace(old, new)
    (source/'ubuntu-connect-migrated-deferred.sh').write_text(script)
    (source/'ubuntu-unified.sh').write_text(f'''test "$GLOBAL_SKIP_AUTOMATION" = 1 || exit 1
ln -sfn "{root}/api/new" "{root}/api/current"
printf new-nginx > "{root}/etc/nginx/site.conf"
printf new-unit > "{root}/etc/systemd/system/globaldroptrade-api.service"
''')
    target = '0x1111111111111111111111111111111111111111'
    config = {'version': 1, 'chainId': 97, 'vaultAddress': target}
    node = shutil.which('node')
    commands = {
        'node': f'''if [[ "$*" = scripts/connect-migrated-deferred.mjs* ]]; then
 mode=$2; out=$3
 [ ! -f '{root}/fail-'"$mode" ] || exit 1
 case "$mode" in
  prepare) printf '%s' 'TRADES_VAULT_ADDRESS={target}\nKEEP=private-credential\n' > "$out/trades.env"
   printf '%s' '{{"target":"{target}"}}' > "$out/deferred-connection.json";;
  publish) printf '%s' '{{"target":"{target}"}}' > '{root}/public/deferred-connection.json';;
 esac
 exit 0
fi
exec '{node}' "$@"''',
        'id': 'echo 0', 'npm': 'exit 0', 'nginx': 'exit 0', 'python3': 'exit 0', 'systemctl': 'exit 0',
        'curl': f'''out=''
while [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then out=$2; shift 2; else shift; fi; done
if [ -f '{root}/fail-target' ]; then printf '%s' '{{"version":1,"chainId":56,"approvalRequired":false,"vaultAddress":"{target}"}}' > "$out";
else printf '%s' '{json.dumps(config)}' > "$out"; fi'''
    }
    for name, body in commands.items():
        file = root/'bin'/name
        file.write_text('#!/bin/bash\n'+body+'\n')
        file.chmod(0o755)
    envfile = root/'etc/globaldroptrade/trades.env'
    unit = root/'etc/systemd/system/globaldroptrade-api.service'
    conf = root/'etc/nginx/site.conf'
    current = root/'api/current'
    marker = root/'public/deferred-connection.json'
    env = {**os.environ, 'PATH': str(root/'bin')+':'+os.environ['PATH'], 'MIGRATED_VAULT_TX': '0x'+'a'*64}
    def reset():
        envfile.write_text('OLD_TARGET=legacy\nKEEP=private-credential\n')
        unit.write_text('old-unit')
        conf.write_text('old-nginx')
        marker.write_text('old-marker')
        if current.is_symlink():
            current.unlink()
        current.symlink_to(root/'api/old', target_is_directory=True)
    def run():
        return subprocess.run(['bash', str(source/'ubuntu-connect-migrated-deferred.sh')], cwd=source, env=env, capture_output=True, text=True)
    reset()
    result = run()
    assert result.returncode == 0, result.stderr
    assert current.resolve() == root/'api/new' and target in envfile.read_text()
    assert 'MIGRATED_SITE_CONNECTED_OWNER_ACTIVATION_REQUIRED' in result.stdout
    for failure in ['prepare', 'check', 'target', 'publish']:
        reset()
        flag = root/('fail-'+failure)
        flag.touch()
        result = run()
        flag.unlink()
        assert result.returncode != 0, failure
        assert current.resolve() == root/'api/old', failure
        assert unit.read_text() == 'old-unit' and conf.read_text() == 'old-nginx', failure
        assert envfile.read_text() == 'OLD_TARGET=legacy\nKEEP=private-credential\n' and marker.read_text() == 'old-marker', failure
        assert 'MIGRATED_SITE_CONNECTED_OWNER_ACTIVATION_REQUIRED' not in result.stdout
        assert 'private-credential' not in result.stdout+result.stderr
print('PASS: content-addressed mobile console; managed-path guards; paused cutover; preflight, snapshot, HTTPS target and report failure rollback; credentials preserved.')
