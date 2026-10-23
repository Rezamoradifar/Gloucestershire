"""Exercise fresh-site cutover, worker quiescence and rollback on an isolated fake host."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile

repo = Path(__file__).resolve().parent.parent
real_node = shutil.which('node')
assert real_node, 'Node is required for the installer validation blocks'
target = '0x1111111111111111111111111111111111111111'
old_target = '0x2222222222222222222222222222222222222222'
workers = {
    'globaldroptrade-automation.timer': {'enabled': 'enabled', 'active': 'active'},
    'globaldroptrade-oracles.timer': {'enabled': 'enabled-runtime', 'active': 'active'},
    'globaldroptrade-zero-daily.timer': {'enabled': 'enabled', 'active': 'active'},
    'globaldroptrade-automation.service': {'enabled': 'static', 'active': 'active'},
    'globaldroptrade-oracles.service': {'enabled': 'static', 'active': 'inactive'},
    'globaldroptrade-zero-daily.service': {'enabled': 'static', 'active': 'active'},
    'globaldroptrade-deferred-index.service': {'enabled': 'disabled', 'active': 'active'},
}

with tempfile.TemporaryDirectory() as directory:
    host = Path(directory)
    for name in ['source/scripts', 'bin', 'etc/nginx/sites-available', 'etc/nginx/sites-enabled',
                 'etc/nginx/snippets', 'etc/globaldroptrade', 'etc/systemd/system', 'api/old',
                 'api/new', 'state/fresh-zero-v1', 'state/fresh-zero-automation-v1', 'backups', 'old-automation']:
        (host/name).mkdir(parents=True)
    source, bin_dir = host/'source', host/'bin'
    paths = {'/etc/nginx': host/'etc/nginx', '/etc/globaldroptrade': host/'etc/globaldroptrade',
             '/etc/systemd/system': host/'etc/systemd/system', '/opt/globaldroptrade-api': host/'api',
             '/var/lib/globaldroptrade': host/'state', '/var/backups/globaldroptrade': host/'backups'}
    script = (repo/'ubuntu-connect-zero-start.sh').read_text()
    for original, replacement in paths.items():
        script = script.replace(original, str(replacement))
    (source/'ubuntu-connect-zero-start.sh').write_text(script)
    package = host/'fixture/globaldroptrade-package'
    (package/'site').mkdir(parents=True)
    (package/'site/index.html').write_text('verified-fresh-index')
    (package/'install.sh').write_text('exit 0\n')
    archive = host/'fixture.tar.gz'
    with tarfile.open(archive, 'w:gz') as tar:
        tar.add(package, arcname='globaldroptrade-package')
    (source/'scripts/unpack-website.sh').write_text(f'cp "{archive}" "$1/website-release.tar.gz"\n')
    envfile = host/'etc/globaldroptrade/trades.env'
    api_unit = host/'etc/systemd/system/globaldroptrade-api.service'
    current = host/'api/current'
    marker = host/'state/fresh-zero-v1/connection-public.json'
    deployment = host/'state/fresh-zero-v1/deployment-public.json'
    canonical = host/'etc/nginx/sites-available/globaldroptrade.com'
    enabled = host/'etc/nginx/sites-enabled/globaldroptrade.com'
    snippet = host/'etc/nginx/snippets/globaldroptrade-api.conf'
    state_file, events = host/'worker-state.json', host/'events'
    original_env = f'TRADES_VAULT_ADDRESS={old_target}\nTRADES_RPC_URL=https://private.invalid/secret\nGLOBAL_MIGRATION_ENABLED=true\nKEEP=preserved\n'
    original_policy = '{"target":"old","start":12345}\n'
    original_journal = '{"transactions":{"saved":"do-not-touch"}}\n'
    (host/'old-automation/daily-policy.json').write_text(original_policy)
    (host/'old-automation/journal.json').write_text(original_journal)
    (host/'state/fresh-zero-automation-v1/daily-policy.json').write_text(original_policy)
    (host/'state/fresh-zero-automation-v1/journal.json').write_text(original_journal)
    deployment.write_text('{"verified":true}\n')
    deployment.chmod(0o600)
    (source/'scripts/repair-global-nginx.py').write_text(f'''
from pathlib import Path
p=Path({str(host)!r})
with (p/'events').open('a') as f:f.write('repair\\n')
if (p/'fail-repair').exists():raise SystemExit(1)
print('GLOBAL_NGINX_REPAIR_READY')
''')
    (source/'ubuntu-unified.sh').write_text(f'''set -Eeuo pipefail
test "$GLOBAL_SKIP_AUTOMATION" = 1
"{sys.executable}" - <<'PY'
import json
from pathlib import Path
p=Path({str(host)!r});state=json.loads((p/'worker-state.json').read_text())
for name,row in state.items():
 if name.endswith('.timer'):assert row['enabled']=='disabled'
 assert row['active']=='inactive',name
assert 'TRADES_VAULT_ADDRESS={target}' in (p/'etc/globaldroptrade/trades.env').read_text()
assert 'GLOBAL_MIGRATION_ENABLED=false' in (p/'etc/globaldroptrade/trades.env').read_text()
with (p/'events').open('a') as f:f.write('install-new-target\\n')
PY
ln -sfn '{host}/api/new' '{current}'
printf new-api-unit > '{api_unit}'
printf new-nginx > '{canonical}'
printf new-snippet > '{snippet}'
[ ! -f '{host}/fail-unified' ]
''')
    node_body = f'''if [[ "$*" = scripts/connect-zero-start.mjs* ]]; then
 mode=$2; stage=$3
 printf '%s\\n' "$mode" >> '{events}'
 [ ! -f '{host}/fail-'"$mode" ] || exit 1
 case "$mode" in
  prepare)
   printf '%s\\n' 'TRADES_VAULT_ADDRESS={target}' 'TRADES_RPC_URL=https://private.invalid/secret' 'GLOBAL_MIGRATION_ENABLED=false' 'KEEP=preserved' > "$stage/trades.env"
   printf '%s' '{{"target":"{target}"}}' > "$stage/zero-start-connection.json";;
  publish)
   test -s "$stage/frontend-check.json"
   printf '%s' '{{"target":"{target}","connected":true}}' > '{marker}'
   [ ! -f '{host}/fail-publish-after-write' ] || exit 1;;
 esac
 exit 0
fi
exec '{real_node}' "$@"'''
    systemctl_body = f'''#!{sys.executable}
import json,sys
from pathlib import Path
p=Path({str(host)!r});args=sys.argv[1:];command=args[0];unit=args[-1]
state=json.loads((p/'worker-state.json').read_text());row=state.get(unit)
with (p/'events').open('a') as f:f.write('systemctl '+' '.join(args)+'\\n')
if command=='show':
 prop=next((a.split('=',1)[1] for a in args if a.startswith('--property=')),'')
 print(('loaded' if row else 'not-found') if prop=='LoadState' else (row['active'] if row else 'inactive'))
 raise SystemExit(0 if row else 1)
if command=='is-active':raise SystemExit(0 if row and row['active']=='active' else 3)
if command=='is-enabled':
 print(row['enabled'] if row else 'not-found');raise SystemExit(0 if row and row['enabled'] in ['enabled','enabled-runtime','static'] else 1)
if command in ['disable','enable','start','stop'] and row:
 if command=='disable':
  row['enabled']='disabled'
  if '--now' in args:row['active']='inactive'
 elif command=='enable':row['enabled']='enabled-runtime' if '--runtime' in args else 'enabled'
 elif command=='stop':
  if unit=='globaldroptrade-automation.service' and (p/'fail-stop').exists():
   (p/'fail-stop').unlink();raise SystemExit(1)
  row['active']='inactive'
 elif command=='start':
  assert 'TRADES_VAULT_ADDRESS={old_target}' in (p/'etc/globaldroptrade/trades.env').read_text(),'Worker restarted against new target'
  assert (p/'api/current').resolve()==p/'api/old','Worker restarted before API rollback'
  assert (p/'etc/nginx/sites-available/globaldroptrade.com').read_text()=='old-nginx-with-tls','Worker restarted before Nginx rollback'
  if unit=='globaldroptrade-deferred-index.service' and (p/'fail-worker-resume').exists():raise SystemExit(1)
  row['active']='active'
 (p/'worker-state.json').write_text(json.dumps(state))
if command=='restart' and unit=='globaldroptrade-api' and (p/'fail-api-restore').exists():raise SystemExit(1)
'''
    curl_body = f'''out=''; url=''
while [ "$#" -gt 0 ]; do
 case "$1" in -o) out=$2; shift 2;; http*) url=$1; shift;; *) shift;; esac
done
case "$url" in
 */api/config)
  if [ "$(readlink -f '{current}')" = '{host}/api/old' ] || [ -f '{host}/fail-target' ]; then printf '%s' '{{"version":1,"chainId":97,"vaultAddress":"{old_target}"}}' > "$out";
  else printf '%s' '{{"version":1,"chainId":97,"vaultAddress":"{target}"}}' > "$out"; fi;;
 */api/health)
  if [ -f '{host}/fail-health' ] && [ "$(readlink -f '{current}')" = '{host}/api/new' ]; then printf '%s' '{{"status":"failed","configured":false}}' > "$out";
  else printf '%s' '{{"status":"ok","configured":true}}' > "$out"; fi;;
 *) if [ "$(readlink -f '{current}')" = '{host}/api/old' ]; then printf old-site-index > "$out";
    elif [ -f '{host}/fail-html' ]; then printf wrong-index > "$out"; else printf verified-fresh-index > "$out"; fi;;
esac'''
    commands = {'node': '#!/bin/bash\n'+node_body, 'systemctl': systemctl_body,
                'id': '#!/bin/bash\necho 0', 'npm': '#!/bin/bash\nexit 0',
                'nginx': '#!/bin/bash\nexit 0', 'curl': '#!/bin/bash\n'+curl_body,
                'sleep': '#!/bin/bash\nexit 0'}
    for name, body in commands.items():
        path = bin_dir/name
        path.write_text(body+'\n')
        path.chmod(0o755)
    environment = {**os.environ, 'PATH': str(bin_dir)+':'+os.environ['PATH']}

    def reset(marker_exists=True):
        for path in host.glob('fail-*'):
            path.unlink()
        envfile.write_text(original_env)
        envfile.chmod(0o600)
        api_unit.write_text('old-api-unit')
        canonical.write_text('old-nginx-with-tls')
        if enabled.exists() or enabled.is_symlink():
            enabled.unlink()
        enabled.symlink_to(canonical)
        snippet.unlink(missing_ok=True)
        if current.is_symlink():
            current.unlink()
        current.symlink_to(host/'api/old', target_is_directory=True)
        marker.unlink(missing_ok=True)
        if marker_exists:
            marker.write_text('old-connection-marker')
            marker.chmod(0o600)
        state_file.write_text(json.dumps(workers))
        events.write_text('')

    def run():
        result = subprocess.run(['bash', str(source/'ubuntu-connect-zero-start.sh')], cwd=source,
                                env=environment, capture_output=True, text=True, timeout=30)
        assert 'private.invalid' not in result.stdout+result.stderr, result.stdout+result.stderr
        assert (host/'old-automation/daily-policy.json').read_text() == original_policy
        assert (host/'old-automation/journal.json').read_text() == original_journal
        assert (host/'state/fresh-zero-automation-v1/daily-policy.json').read_text() == original_policy
        assert (host/'state/fresh-zero-automation-v1/journal.json').read_text() == original_journal
        return result

    def restored(result, marker_exists=True):
        assert result.returncode != 0, result.stdout+result.stderr
        assert 'FRESH_ZERO_SITE_CONNECTED' not in result.stdout
        assert envfile.read_text() == original_env
        assert api_unit.read_text() == 'old-api-unit'
        assert current.resolve() == host/'api/old'
        assert canonical.read_text() == 'old-nginx-with-tls'
        assert enabled.is_symlink() and enabled.resolve() == canonical
        assert not snippet.exists(), 'New API snippet was not removed'
        assert marker.read_text() == 'old-connection-marker' if marker_exists else not marker.exists()
        assert json.loads(state_file.read_text()) == workers

    reset()
    result = run()
    assert result.returncode == 0, result.stdout+result.stderr
    assert 'FRESH_ZERO_SITE_CONNECTED' in result.stdout and 'DAILY_AUTOMATION_ACTIVE=false' in result.stdout
    assert current.resolve() == host/'api/new' and target in envfile.read_text()
    assert 'GLOBAL_MIGRATION_ENABLED=false' in envfile.read_text()
    assert canonical.read_text() == 'new-nginx' and json.loads(marker.read_text())['target'] == target
    state = json.loads(state_file.read_text())
    assert all(row['active'] == 'inactive' for row in state.values())
    assert all(state[name]['enabled'] == 'disabled' for name in state if name.endswith('.timer'))
    log = events.read_text()
    assert log.index('prepare\n') < log.index('repair\n') < log.index('install-new-target\n') < log.index('publish\n')
    for failure in ['prepare', 'repair', 'check', 'stop', 'unified', 'target', 'html', 'health', 'publish-after-write']:
        reset()
        (host/('fail-'+failure)).touch()
        result = run()
        restored(result)
    reset(marker_exists=False)
    (host/'fail-publish-after-write').touch()
    restored(run(), marker_exists=False)
    reset()
    (host/'fail-unified').touch()
    (host/'fail-api-restore').touch()
    result = run()
    assert result.returncode != 0
    assert 'FRESH_ZERO_SITE_CONNECTED' not in result.stdout
    assert 'FRESH_CONNECTION_FAILED_PREVIOUS_SITE_RESTORED' not in result.stdout
    assert 'RECOVERY_REQUIRED' in result.stdout
    state = json.loads(state_file.read_text())
    assert all(row['active'] == 'inactive' for row in state.values())
    assert all(state[name]['enabled'] == 'disabled' for name in state if name.endswith('.timer'))
    assert not any('systemctl start '+name in events.read_text() for name in workers)
    assert envfile.read_text() == original_env
    assert current.resolve() == host/'api/old'
    reset()
    (host/'fail-unified').touch()
    (host/'fail-worker-resume').touch()
    result = run()
    assert result.returncode != 0 and 'RECOVERY_REQUIRED' in result.stdout
    assert 'FRESH_CONNECTION_FAILED_PREVIOUS_SITE_RESTORED' not in result.stdout
    state = json.loads(state_file.read_text())
    assert all(row['active'] == 'inactive' for row in state.values()), 'Partial worker restart was not quiesced again'
    assert all(state[name]['enabled'] == 'disabled' for name in state if name.endswith('.timer'))
    print('PASS: exact fresh-target activation; timers/services stopped before target switch; old policy/journal preserved; API/Nginx/env/report and worker-state rollback across nine failures; partial new marker removed; failed API recovery and partial worker restart keep financial workers stopped; credentials never printed.')
