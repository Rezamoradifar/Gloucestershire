"""Verify explicit fast-testnet installation, namespace isolation and rollback with fake host services."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

repo = Path(__file__).resolve().parent.parent
node = shutil.which('node')
assert node
fixture_key = '0x'+'11'*32
fixture_operator = subprocess.check_output([node, '--input-type=module', '-e',
    "import{Wallet}from'ethers';process.stdout.write(new Wallet('"+fixture_key+"').address)"], cwd=repo, text=True)
assert json.loads((repo/'config/fresh-fast-testnet.json').read_text())['deployer'] == '0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2'
service, timer = 'globaldroptrade-zero-daily.service', 'globaldroptrade-zero-daily.timer'
old_workers = {
    'globaldroptrade-automation.timer': {'enabled': 'enabled', 'active': 'active'},
    'globaldroptrade-oracles.timer': {'enabled': 'enabled-runtime', 'active': 'active'},
    'globaldroptrade-automation.service': {'enabled': 'static', 'active': 'active'},
    'globaldroptrade-oracles.service': {'enabled': 'static', 'active': 'inactive'},
    timer: {'enabled': 'enabled-runtime', 'active': 'active'},
    service: {'enabled': 'static', 'active': 'active'},
}

with tempfile.TemporaryDirectory() as directory:
    host = Path(directory)
    for name in ['source/scripts', 'source/server', 'source/artifacts', 'source/config', 'bin',
                 'etc/globaldroptrade', 'etc/systemd/system', 'runtime/releases/old', 'state/automation-v1',
                 'state/oracle-maintenance-v1', 'state/fresh-zero-automation-v1', 'state/fresh-fast-testnet-automation-v1', 'www']:
        (host/name).mkdir(parents=True)
    source, bin_dir = host/'source', host/'bin'
    (source/'node_modules').symlink_to(repo/'node_modules', target_is_directory=True)
    replacements = {'/etc/globaldroptrade': host/'etc/globaldroptrade', '/etc/systemd/system': host/'etc/systemd/system',
                    '/var/lib/globaldroptrade': host/'state', '/var/www/globaldroptrade': host/'www',
                    '/opt/globaldroptrade-zero-daily': host/'runtime', '/root/global-testnet-v071': host/'unused-old-key-root'}
    installer = (repo/'ubuntu-enable-zero-daily.sh').read_text()
    for original, replacement in replacements.items():
        installer = installer.replace(original, str(replacement))
    (source/'ubuntu-enable-zero-daily.sh').write_text(installer)
    for name in ['zero-start-automation.mjs', 'zero-start-readiness.mjs', 'zero-start-volume.mjs', 'daily-profit.mjs', 'zero-start-hourly-test.mjs',
                 'maintain-testnet-oracles.mjs', 'refresh-testnet-oracles.mjs', 'migration-journal.mjs',
                 'migration-signers.mjs', 'connect-zero-start.mjs', 'deploy-zero-start.mjs', 'zero-start-profile.mjs', 'fund-fast-test-rewards.mjs', 'fund-million-test-rewards.mjs']:
        shutil.copyfile(repo/'scripts'/name, source/'scripts'/name)
    for name in ['trades-api.mjs', 'community.mjs', 'marketplace.mjs']:
        shutil.copyfile(repo/'server'/name, source/'server'/name)
    for name in ['AutomaticGroupVault.json', 'MockFeed.json', 'FastTestnetVault.json', 'MockToken.json']:
        shutil.copyfile(repo/'artifacts'/name, source/'artifacts'/name)
    # This isolated fixture substitutes its public test operator; production remains pinned above.
    for name in ['fresh-zero-testnet.json', 'fresh-fast-testnet.json']:
        manifest = json.loads((repo/'config'/name).read_text())
        manifest['deployer'] = fixture_operator
        (source/'config'/name).write_text(json.dumps(manifest))
    for name in ['package.json', 'package-lock.json']:
        shutil.copyfile(repo/name, source/name)
    state = host/'state/fresh-fast-testnet-automation-v1'
    state.chmod(0o700)
    public = host/'www/automation-data'
    current = host/'runtime/current'
    unit_dir = host/'etc/systemd/system'
    signer_source = host/'etc/globaldroptrade/migration-deployer.key'
    signer = host/'etc/globaldroptrade/fresh-zero-automation.key'
    envfile = host/'etc/globaldroptrade/trades.env'
    env_original = 'TRADES_CHAIN_ID=97\nTRADES_RPC_URL=https://private.invalid/credential\nCUSTOM=keep\n'
    preserved = {host/'etc/globaldroptrade/daily-policy.json': 'old-policy-unchanged\n',
                 host/'state/automation-v1/journal.json': 'old-daily-journal-unchanged\n',
                 host/'state/oracle-maintenance-v1/journal.json': 'old-oracle-journal-unchanged\n',
                 host/'state/fresh-zero-automation-v1/daily-policy.json': 'previous-fresh-policy-unchanged\n',
                 host/'state/fresh-zero-automation-v1/journal.json': 'previous-fresh-journal-unchanged\n',
                 state/'daily-policy.json': 'existing-fast-policy-unchanged\n',
                 state/'journal.json': 'existing-fast-journal-unchanged\n'}
    worker_file, calls = host/'workers.json', host/'calls'
    status = {'version': 1, 'chainId': 97, 'releaseId': 'global-fresh-fast-test-v1',
              'testMode': True, 'initialServerReporter': True, 'fastTestnetVersion': 1,
              'dailyAutomationActive': False, 'automationStatus': 'waiting',
              'blockers': ['FUNDED_DAILY_REWARD_BUDGET_REQUIRED']}
    started_status = {**status, 'dailyAutomationActive': True, 'timerActive': True,
                      'automationStatus': 'scheduled', 'blockers': []}
    (source/'scripts/install-zero-start-status.py').write_text(f'''
import sys
from pathlib import Path
p=Path({str(host)!r});args=sys.argv[1:];entry=p/'status-entrypoint'
with (p/'calls').open('a') as f:f.write('install-status '+' '.join(args)+'\\n')
if args and args[0]=='--restore':
 entry.write_text((Path(args[1])/'entrypoint').read_text());raise SystemExit(0)
if args and args[0]=='--backup-dir':
 backup=Path(args[1]);backup.mkdir(mode=0o700)
 (backup/'manifest.json').write_text('{{}}');(backup/'entrypoint').write_text(entry.read_text())
entry.write_text('new-console-entrypoint')
if (p/'fail-status').exists():raise SystemExit(1)
''')
    node_body = f'''if [ "$1" = scripts/zero-start-automation.mjs ]; then
 printf '%s\\n' 'oracle-check' >> '{calls}'
 [ "$#" -eq 4 ] && [ "$2" = --oracles-only ] && [ "$3" = --check ] && [ "$4" = --fast-testnet ] || exit 1
 [ ! -f '{host}/fail-oracle-check' ] || exit 1
 printf '%s\\n' 'ZERO_START_ORACLES_CHECKED ready=true'
 exit 0
fi
if [ "$1" = scripts/zero-start-readiness.mjs ]; then
 printf '%s\\n' 'readiness-check' >> '{calls}'
 [ "$4" = --fast-testnet ] || exit 1
 [ ! -f '{host}/fail-readiness' ] || exit 1
 printf '%s' '{json.dumps(status)}' > "$3/activation.json"
 printf '%s\\n' 'ZERO_START_DAILY_READINESS ready=false'
 exit 0
fi
exec '{node}' "$@"'''
    systemctl_body = f'''#!{sys.executable}
import json,sys
from pathlib import Path
p=Path({str(host)!r});args=sys.argv[1:];command=args[0];unit=args[-1]
states=json.loads((p/'workers.json').read_text())
with (p/'calls').open('a') as f:f.write('systemctl '+' '.join(args)+'\\n')
if command=='daemon-reload':
 for name in [{service!r},{timer!r}]:
  if (p/'etc/systemd/system'/name).exists():states.setdefault(name,{{'enabled':'disabled','active':'inactive'}})
  else:states.pop(name,None)
 (p/'workers.json').write_text(json.dumps(states));raise SystemExit(0)
row=states.get(unit)
if command=='show':
 prop=next((a.split('=',1)[1] for a in args if a.startswith('--property=')),'')
 print(('loaded' if row else 'not-found') if prop=='LoadState' else (row['active'] if row else 'inactive'))
 raise SystemExit(0 if row else 1)
if command=='is-active':raise SystemExit(0 if row and row['active']=='active' else 3)
if command=='is-enabled':
 print(row['enabled'] if row else 'not-found');raise SystemExit(0 if row and row['enabled'] in ['enabled','enabled-runtime','static'] else 1)
if command in ['disable','enable','start','stop']:
 if not row:raise SystemExit(0)
 if command=='disable':
  row['enabled']='disabled'
  if '--now' in args:row['active']='inactive'
 elif command=='enable':
  row['enabled']='enabled-runtime' if '--runtime' in args else 'enabled'
  if '--now' in args:row['active']='active'
 elif command=='stop':row['active']='inactive'
 elif command=='start':
  current=(p/'runtime/current').resolve()
  if unit=={service!r} and current!=p/'runtime/releases/old':
   if (p/'expect-oracle-recovery').exists():
    staged=json.loads((p/'www/automation-data/activation.json').read_text())
    assert staged['kind']=='fresh-zero-automation-error' and staged['automationStatus']=='not-inspected'
    assert staged['dailyAutomationActive'] is False and staged['ready'] is False
    assert staged['blockers']==['DAILY_READINESS_NOT_YET_INSPECTED']
    assert 'funding' not in staged and 'reporterAuthorized' not in staged and 'archive' not in staged
   for old in ['globaldroptrade-automation.timer','globaldroptrade-oracles.timer','globaldroptrade-automation.service','globaldroptrade-oracles.service']:
    assert states[old]['active']=='inactive','Old signer still running: '+old
   assert (p/'etc/globaldroptrade/fresh-zero-automation.key').read_text().strip()=={fixture_key!r}
   assert (p/'etc/globaldroptrade/fresh-zero-automation.key').stat().st_mode&0o777==0o600
   installed=(p/'etc/systemd/system'/unit).read_text()
   assert '/usr/bin/flock -n ' in installed
   assert 'zero-start-automation.mjs --execute --fast-testnet --seed-test-rewards' in installed
   assert '--fund-test-million' not in installed
   assert 'fresh-fast-testnet-automation-v1/run.lock' in installed
   for name in ['zero-start-profile.mjs','fund-fast-test-rewards.mjs','fund-million-test-rewards.mjs','zero-start-hourly-test.mjs']:
    assert (current/'scripts'/name).is_file()
   for name in ['FastTestnetVault.json','MockToken.json']:
    assert (current/'artifacts'/name).is_file()
   for name in ['fresh-zero-testnet.json','fresh-fast-testnet.json']:
    assert (current/'config'/name).is_file()
   if (p/'fail-service').exists():raise SystemExit(1)
   (p/'www/automation-data/activation.json').write_text({json.dumps(started_status)!r})
   row['active']='inactive'
  else:
   if unit in [{service!r},{timer!r}]:
    assert current==p/'runtime/releases/old','Worker resumed before prior release restored'
    assert (p/'etc/systemd/system'/{service!r}).read_text()=='old-daily-service'
   else:
    link=p/'runtime/current'
    assert current==p/'runtime/releases/old' or (not link.exists() and not link.is_symlink()),'Legacy worker resumed before release rollback'
   row['active']='active'
 (p/'workers.json').write_text(json.dumps(states))
'''
    curl_body = f'''out=''
while [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then out=$2;shift 2;else shift;fi;done
if [ -f '{host}/fail-https' ]; then printf '%s' '{{"version":1,"chainId":56}}' > "$out";
else cp '{public}/activation.json' "$out"; fi'''
    commands = {'node': '#!/bin/bash\n'+node_body, 'systemctl': systemctl_body, 'id': '#!/bin/bash\necho 0',
                'npm': f'''#!/bin/bash
if [[ "$PWD" = '{host}/runtime/releases/'* ]]; then
 [ ! -f '{host}/fail-dependencies' ] || exit 1
 ln -s '{repo}/node_modules' "$PWD/node_modules"
fi
exit 0''', 'curl': '#!/bin/bash\n'+curl_body, 'nginx': '#!/bin/bash\nexit 0'}
    for name, body in commands.items():
        file = bin_dir/name
        file.write_text(body+'\n')
        file.chmod(0o755)
    environment = {**os.environ, 'PATH': str(bin_dir)+':'+os.environ['PATH']}

    def reset(existing=True):
        for flag in host.glob('fail-*'):
            flag.unlink()
        (host/'expect-oracle-recovery').unlink(missing_ok=True)
        envfile.write_text(env_original)
        envfile.chmod(0o600)
        signer_source.write_text(fixture_key+'\n')
        signer_source.chmod(0o600)
        signer.unlink(missing_ok=True)
        for file, value in preserved.items():
            file.write_text(value)
            file.chmod(0o600)
        if current.exists() or current.is_symlink():
            current.unlink()
        for unit in [service,timer]:
            (unit_dir/unit).unlink(missing_ok=True)
        if existing:
            current.symlink_to(host/'runtime/releases/old', target_is_directory=True)
            (unit_dir/service).write_text('old-daily-service')
            (unit_dir/timer).write_text('old-daily-timer')
        public.mkdir(exist_ok=True)
        public.chmod(0o755)
        (public/'activation.json').write_text('old-activation-status')
        (host/'status-entrypoint').write_text('old-console-entrypoint')
        worker_file.write_text(json.dumps(old_workers if existing else {k:v for k,v in old_workers.items() if k not in [service,timer]}))
        calls.write_text('')

    def run(flags=('--fast-testnet',)):
        result = subprocess.run(['bash', str(source/'ubuntu-enable-zero-daily.sh'), *flags], cwd=source,
                                env=environment, capture_output=True, text=True, timeout=30)
        assert envfile.read_text() == env_original
        assert signer_source.read_text().strip() == fixture_key
        for file, value in preserved.items():
            assert file.read_text() == value, file
        assert fixture_key not in result.stdout+result.stderr
        assert 'private.invalid' not in result.stdout+result.stderr
        return result

    def restored(result, existing=True, status_exists=True):
        assert result.returncode != 0, result.stdout+result.stderr
        assert 'ZERO_START_AUTOMATION_MONITOR_INSTALLED' not in result.stdout
        assert 'DAILY_PLAN_AUTOMATION_ACTIVE' not in result.stdout
        if existing:
            assert current.is_symlink() and current.resolve() == host/'runtime/releases/old'
            assert (unit_dir/service).read_text() == 'old-daily-service'
            assert (unit_dir/timer).read_text() == 'old-daily-timer'
        else:
            assert not current.exists() and not current.is_symlink(), 'First-install rollback left a current symlink'
            assert not (unit_dir/service).exists() and not (unit_dir/timer).exists()
        expected = old_workers if existing else {k:v for k,v in old_workers.items() if k not in [service,timer]}
        assert json.loads(worker_file.read_text()) == expected, worker_file.read_text()
        if status_exists:
            assert (public/'activation.json').read_text() == 'old-activation-status'
        else:
            assert not (public/'activation.json').exists()
        assert (host/'status-entrypoint').read_text() == 'old-console-entrypoint'

    reset()
    result = run()
    assert result.returncode == 0, result.stdout+result.stderr
    assert 'ZERO_START_AUTOMATION_MONITOR_INSTALLED' in result.stdout and 'DAILY_PLAN_AUTOMATION_ACTIVE' in result.stdout
    assert 'DAILY_PLAN_WAITING' not in result.stdout
    assert signer.read_text().strip() == fixture_key and signer.stat().st_mode&0o777 == 0o600
    assert current.resolve() != host/'runtime/releases/old'
    assert (host/'status-entrypoint').read_text() == 'new-console-entrypoint'
    installed = (unit_dir/service).read_text()
    assert 'ProtectHome=true' in installed and 'ReadWritePaths='+str(state)+' '+str(public) in installed
    assert '/usr/bin/flock -n '+str(state)+'/run.lock' in installed
    assert 'zero-start-automation.mjs --execute --fast-testnet --seed-test-rewards' in installed
    assert '--hourly-test' not in installed
    assert '--fund-test-million' not in installed
    assert (current.resolve()/'scripts/fund-million-test-rewards.mjs').read_bytes() == (repo/'scripts/fund-million-test-rewards.mjs').read_bytes()
    assert 'ReadWritePaths='+str(host/'state/fresh-zero-automation-v1') not in installed
    states = json.loads(worker_file.read_text())
    assert states[timer]['enabled'] == 'enabled' and states[timer]['active'] == 'active'
    assert all(states[name]['active'] == 'inactive' for name in old_workers if name not in [timer])
    # Hourly mode is a reviewed fast-only worker selection. It neither edits the
    # existing policy/journal at installation time nor changes the connected site.
    for flags in [('--fast-testnet', '--hourly-test'), ('--hourly-test', '--fast-testnet')]:
        reset()
        result = run(flags)
        assert result.returncode == 0, result.stdout+result.stderr
        installed = (unit_dir/service).read_text()
        assert 'zero-start-automation.mjs --execute --fast-testnet --seed-test-rewards --hourly-test' in installed
        assert installed.count('--hourly-test') == 1
        installed_helper = current.resolve()/'scripts/zero-start-hourly-test.mjs'
        assert installed_helper.read_bytes() == (repo/'scripts/zero-start-hourly-test.mjs').read_bytes()
        # Exercise the actual copied module rather than merely checking its path.
        subprocess.run([node, '--input-type=module', '-e',
                        "await import('./scripts/zero-start-hourly-test.mjs');await import('./scripts/fund-million-test-rewards.mjs');await import('./scripts/zero-start-automation.mjs')"],
                       cwd=current.resolve(), check=True, env=environment, capture_output=True, text=True)
    reset()
    (host/'fail-service').touch()
    restored(run(('--fast-testnet', '--hourly-test')))
    reset()
    (host/'expect-oracle-recovery').touch()
    (host/'fail-readiness').touch()
    result = run(('--fast-testnet', '--oracle-recovery', '--hourly-test'))
    assert result.returncode == 0, result.stdout+result.stderr
    assert 'oracle-check' in calls.read_text() and 'readiness-check' not in calls.read_text()
    installed = (unit_dir/service).read_text()
    assert '--hourly-test' in installed and '--oracle-recovery' not in installed
    reset()
    (host/'fail-oracle-check').touch()
    result = run(('--fast-testnet', '--oracle-recovery'))
    assert result.returncode != 0 and not signer.exists()
    assert json.loads(worker_file.read_text()) == old_workers
    assert current.resolve() == host/'runtime/releases/old'
    assert calls.read_text() == 'oracle-check\n', calls.read_text()
    for failure in ['readiness','dependencies','status','service','https']:
        reset()
        (host/('fail-'+failure)).touch()
        restored(run())
    reset()
    signer_source.write_text('0x'+'22'*32+'\n')
    result = subprocess.run(['bash', str(source/'ubuntu-enable-zero-daily.sh'), '--fast-testnet'], cwd=source, env=environment, capture_output=True, text=True, timeout=30)
    assert result.returncode != 0 and 'EXISTING_SERVER_OPERATOR_KEY_REQUIRED' in result.stderr
    assert not signer.exists() and current.resolve() == host/'runtime/releases/old'
    assert json.loads(worker_file.read_text()) == old_workers
    reset(existing=False)
    (host/'fail-service').touch()
    restored(run(), existing=False)
    reset(existing=False)
    (public/'activation.json').unlink()
    public.rmdir()
    (host/'fail-service').touch()
    restored(run(), existing=False, status_exists=False)
    assert public.stat().st_mode&0o777 == 0o755, 'Public status directory inherited the private umask'
    reset()
    for flags in [['--fast-testnet', '--fast-testnet'], ['--unknown'], ['--seed-test-rewards'],
                  ['--hourly-test'], ['--hourly-test', '--hourly-test', '--fast-testnet'],
                  ['--fast-testnet', '--hourly-test', '--fast-testnet'],
                  ['--fast-testnet', '--oracle-recovery', '--oracle-recovery'],
                  ['--fast-testnet', '--fund-test-million']]:
        result = subprocess.run(['bash', str(source/'ubuntu-enable-zero-daily.sh'), *flags], cwd=source, env=environment, capture_output=True, text=True, timeout=30)
        assert result.returncode != 0 and 'Usage:' in result.stdout
        assert current.resolve() == host/'runtime/releases/old' and not calls.read_text()
        assert json.loads(worker_file.read_text()) == old_workers
    print('PASS: explicit fast profile, seed and fast-only hourly flags; copied hourly module imports; minimal oracle-recovery preflight with hourly selection and honest staged status; unsafe recovery proof rejected before signer or worker changes; isolated fast policy/journal and shared serialized operator; WAIT readiness can advance after first worker; existing credentials and prior journals preserved; hourly/default failure rollbacks and first-install absence restored; wrong operator and unsupported flags rejected; public directory readable under private umask.')
