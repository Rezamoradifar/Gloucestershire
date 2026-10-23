"""Verify current-target mock-oracle repair and failure recovery on an isolated host."""
import copy
import fcntl
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
service = 'globaldroptrade-zero-daily.service'
timer = 'globaldroptrade-zero-daily.timer'
prior = {timer: {'enabled': 'enabled-runtime', 'active': 'active'},
         service: {'enabled': 'static', 'active': 'active'}}
target = '0x04E26FcaA198d21cEf6d04e1e54f9C5f6399e522'
with tempfile.TemporaryDirectory() as directory:
    host = Path(directory)
    for name in ['source/scripts', 'bin', 'state', 'etc/globaldroptrade', 'etc/systemd/system',
                 'api/releases/current', 'daily/releases/old', 'daily/releases/new']:
        (host/name).mkdir(parents=True)
    source = host/'source'
    script = (repo/'ubuntu-zero-oracle.sh').read_text()
    replacements = {'/etc/globaldroptrade': host/'etc/globaldroptrade', '/etc/systemd/system': host/'etc/systemd/system',
                    '/var/lib/globaldroptrade': host/'state', '/opt/globaldroptrade-api': host/'api',
                    '/opt/globaldroptrade-zero-daily': host/'daily'}
    for original, replacement in replacements.items():
        script = script.replace(original, str(replacement))
    (source/'ubuntu-zero-oracle.sh').write_text(script)
    envfile = host/'etc/globaldroptrade/trades.env'
    apiunit = host/'etc/systemd/system/globaldroptrade-api.service'
    dailyunit = host/'etc/systemd/system'/service
    timerunit = host/'etc/systemd/system'/timer
    state = host/'state'
    selected = state/'fresh-fast-testnet-automation-v1'
    standard = state/'fresh-zero-automation-v1'
    secret = 'https://private.invalid/never-print-this-credential'
    baseline_env = f'TRADES_CHAIN_ID=97\nTRADES_RPC_URL={secret}\nTRADES_VAULT_ADDRESS={target}\nTRADES_ZERO_START_PROFILE=global-fresh-fast-test-v1\n'
    calls = host/'calls'
    workers = host/'workers.json'
    protected = {host/'accounts.json': '{"accounts":17,"principal":"123456"}',
                 state/'fresh-fast-testnet-v1/deployment-public.json': '{"contractAddress":"'+target+'"}',
                 selected/'daily-policy.json': '{"periodSeconds":86400,"target":"'+target+'"}',
                 host/'etc/globaldroptrade/migration-deployer.key': 'fixture-key-never-print'}
    stage = f'''#!{sys.executable}
import fcntl,json,os,sys
from pathlib import Path
p=Path({str(host)!r});stage=sys.argv[1];args=sys.argv[2:];mode=(p/'mode').read_text()
with (p/'calls').open('a') as f:f.write(stage+' '+' '.join(args)+'\\n')
states=json.loads((p/'workers.json').read_text());env=(p/'etc/globaldroptrade/trades.env').read_text()
fast='TRADES_ZERO_START_PROFILE=global-fresh-fast-test-v1' in env
root=p/'state'/('fresh-fast-testnet-automation-v1' if fast else 'fresh-zero-automation-v1')
if stage=='worker':
 assert args[:2] in [['--oracles-only','--check'],['--oracles-only','--execute']]
 assert args[2:]==(['--fast-testnet'] if fast else [])
 if args[1]=='--check':
  if mode=='proof-fail':raise SystemExit(1)
  print('ZERO_START_ORACLES_CHECKED ready=false');raise SystemExit(0)
 assert all(states.get(n,{{'active':'inactive'}})['active']=='inactive' for n in [{timer!r},{service!r}]),'Worker not stopped'
 with (root/'run.lock').open('a') as lock:
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:pass
  else:raise AssertionError('Source worker requires shared journal lock')
 if mode in ['execute-fail','restore-start-fail']:raise SystemExit(1)
 if mode=='execute-env-change':
  (p/'etc/globaldroptrade/trades.env').write_text(env+'CHANGED=1\\n');raise SystemExit(1)
 file=root/'journal.json';j=json.loads(file.read_text()) if file.exists() else {{'transactions':{{}}}}
 if any(not e.get('block') and not name.startswith('oracle-') for name,e in j.get('transactions',{{}}).items()):
  print('NON_ORACLE_PENDING_TRANSACTION');raise SystemExit(1)
 if mode=='oracle-pending':
  j['transactions']['oracle-repair']={{'hash':'fixed-pending-hash'}}
  file.write_text(json.dumps(j));file.chmod(0o600);raise SystemExit(1)
 if not (p/'oracle-confirmed').exists():
  (p/'oracle-confirmed').write_text('one target refresh')
  with (p/'calls').open('a') as f:f.write('oracle-confirmed\\n')
 j['transactions']['oracle-repair']={{'block':42,'hash':'fixed-pending-hash'}}
 file.write_text(json.dumps(j));file.chmod(0o600)
 print('ZERO_START_ORACLES_VALID')
elif stage=='install':
 expected=(['--fast-testnet'] if fast else [])+['--oracle-recovery']
 hourly=(p/'expect-hourly').exists()
 if hourly:expected+=['--hourly-test']
 assert args==expected,(args,expected)
 assert (p/'oracle-confirmed').exists(),'Install happened before quote refresh'
 with (root/'run.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 if mode=='install-fail':raise SystemExit(1)
 if mode=='install-health-fail':
  (p/'bad-health').touch();raise SystemExit(1)
 if mode=='install-pending':
  file=root/'journal.json';j=json.loads(file.read_text());j['transactions']['seed']={{'hash':'pending-seed'}}
  file.write_text(json.dumps(j));file.chmod(0o600);raise SystemExit(1)
 if mode in ['install-dirty','install-unloaded-active']:
  (p/'etc/systemd/system'/{service!r}).write_text('changed service')
  states[{timer!r}]={{'enabled':'enabled','active':'active'}}
  states[{service!r}]={{'enabled':'static','active':'active'}}
  if mode=='install-unloaded-active':
   (p/'etc/systemd/system'/{service!r}).unlink();(p/'etc/systemd/system'/{timer!r}).unlink()
   states[{timer!r}]['load']='not-found';states[{service!r}]['load']='not-found'
  (p/'workers.json').write_text(json.dumps(states));raise SystemExit(1)
 (p/'etc/systemd/system'/{service!r}).write_text('ExecStart=/usr/bin/node worker --execute'+(' --fast-testnet' if fast else '')+(' --hourly-test' if hourly else '')+'\\n')
 (p/'etc/systemd/system'/{timer!r}).write_text('repaired timer')
 current=p/'daily/current'
 if current.exists() or current.is_symlink():current.unlink()
 current.symlink_to(p/'daily/releases/new',target_is_directory=True)
 states[{timer!r}]={{'enabled':'enabled','active':'active'}}
 states[{service!r}]={{'enabled':'static','active':'inactive'}}
 (p/'workers.json').write_text(json.dumps(states));print('ZERO_START_AUTOMATION_MONITOR_INSTALLED')
'''
    (host/'stage.py').write_text(stage)
    (source/'ubuntu-enable-zero-daily.sh').write_text(f'#!/bin/bash\nexec {sys.executable} "{host}/stage.py" install "$@"\n')
    node_body = f'''#!/bin/bash
if [ "$1" = scripts/zero-start-automation.mjs ]; then
 shift
 exec {sys.executable} '{host}/stage.py' worker "$@"
fi
exec '{node}' "$@"
'''
    systemctl_body = f'''#!{sys.executable}
import json,sys
from pathlib import Path
p=Path({str(host)!r});args=sys.argv[1:];cmd=args[0];unit=args[-1]
states=json.loads((p/'workers.json').read_text());row=states.get(unit)
with (p/'calls').open('a') as f:f.write('systemctl '+' '.join(args)+'\\n')
if cmd=='show':
 prop=next((x.split('=',1)[1] for x in args if x.startswith('--property=')),'')
 print((row.get('load','loaded') if row else 'not-found') if prop=='LoadState' else (row['active'] if row else 'inactive'));raise SystemExit(0)
if cmd=='is-enabled':print(row['enabled'] if row else 'not-found');raise SystemExit(0)
if cmd=='stop' and unit=={service!r} and (p/'mode').read_text()=='stop-fail':raise SystemExit(1)
if row:
 if cmd=='stop':row['active']='inactive'
 elif cmd=='start':
  if (p/'mode').read_text()=='restore-start-fail':raise SystemExit(1)
  assert (p/'etc/globaldroptrade/trades.env').read_text()==(p/'expected-env').read_text(),'Resume before env recovery'
  assert (p/'api/current').resolve()==p/'api/releases/current','Resume before API recovery'
  assert (p/'daily/current').resolve()==p/'daily/releases/old','Resume before daily recovery'
  row['active']='active'
 elif cmd=='disable':row['enabled']='disabled'
 elif cmd=='enable':row['enabled']='enabled-runtime' if '--runtime' in args else 'enabled'
 (p/'workers.json').write_text(json.dumps(states))
'''
    curl_body = f'''#!{sys.executable}
import sys
from pathlib import Path
p=Path({str(host)!r});args=sys.argv[1:];out=args[args.index('-o')+1];url=next(x for x in args if x.startswith('https://globaldroptrade.com/'))
if url.endswith('/api/health'):Path(out).write_text('{{"status":"bad","configured":false}}' if (p/'bad-health').exists() else '{{"status":"ok","configured":true}}')
else:Path(out).write_text('{{"version":1,"chainId":97,"vaultAddress":"{target}"}}')
'''
    for name, body in {'node': node_body, 'systemctl': systemctl_body, 'curl': curl_body,
                       'id': '#!/bin/bash\necho 0\n', 'npm': f'#!/bin/bash\nprintf "npm\\n" >> "{calls}"\n'}.items():
        file = host/'bin'/name;file.write_text(body);file.chmod(0o755)
    environment = {**os.environ, 'PATH': str(host/'bin')+':'+os.environ['PATH'],
                   'TRADES_ZERO_START_PROFILE': 'untrusted-shell-override'}

    def reset(mode='success', fast=True, hourly=False):
        for name in ['bad-health', 'oracle-confirmed', 'expect-hourly']:
            (host/name).unlink(missing_ok=True)
        for name in ['zero-oracle-repair-v1', 'fresh-zero-automation-v1', 'fresh-fast-testnet-automation-v1',
                     'automation-v1', 'oracle-maintenance-v1', 'fresh-fast-testnet-v1']:
            shutil.rmtree(state/name, ignore_errors=True)
        for name in ['fresh-zero-automation-v1', 'fresh-fast-testnet-automation-v1', 'automation-v1',
                     'oracle-maintenance-v1', 'fresh-fast-testnet-v1']:
            (state/name).mkdir(mode=0o700)
        for root in [selected, standard, state/'automation-v1', state/'oracle-maintenance-v1']:
            file=root/'journal.json';file.write_text('{"transactions":{}}');file.chmod(0o600)
        for file, content in protected.items():
            file.write_text(content);file.chmod(0o600)
        if hourly:(host/'expect-hourly').touch()
        text=baseline_env if fast else baseline_env.replace('TRADES_ZERO_START_PROFILE=global-fresh-fast-test-v1\n','')
        envfile.write_text(text);envfile.chmod(0o600)
        (host/'expected-env').write_text(text)
        (host/'mode').write_text(mode)
        apiunit.write_text('same API service');apiunit.chmod(0o644)
        dailyunit.write_text('ExecStart=/usr/bin/node old-worker'+(' --hourly-test' if hourly else '')+'\n')
        timerunit.write_text('old timer')
        workers.write_text(json.dumps(prior));calls.write_text('')
        for name, path in [('api', 'api/releases/current'), ('daily', 'daily/releases/old')]:
            link=host/name/'current'
            if link.exists() or link.is_symlink():link.unlink()
            link.symlink_to(host/path, target_is_directory=True)

    def run(args=('--execute',), expect_env=True):
        result = subprocess.run(['bash', str(source/'ubuntu-zero-oracle.sh'), *args], cwd=source,
                                env=environment, capture_output=True, text=True, timeout=30)
        assert secret not in result.stdout+result.stderr and 'fixture-key-never-print' not in result.stdout+result.stderr
        if expect_env:assert envfile.read_text()==(host/'expected-env').read_text()
        for file, content in protected.items():assert file.read_text()==content, file
        return result

    def stopped(result):
        assert result.returncode!=0, result.stdout+result.stderr
        assert 'ZERO_ORACLE_REPAIR_COMPLETE:' not in result.stdout
        assert 'previousWorkersRestored=0' in result.stdout
        rows=json.loads(workers.read_text())
        assert rows[timer]['active']=='inactive' and rows[service]['active']=='inactive'

    def restored(result):
        assert result.returncode!=0, result.stdout+result.stderr
        assert json.loads(workers.read_text())==prior
        assert 'previousWorkersRestored=1' in result.stdout

    reset()
    before={p:(p.read_bytes(),p.stat().st_mode) for p in state.rglob('*') if p.is_file()}
    result=run(('--check',))
    assert result.returncode==0, result.stdout+result.stderr
    assert calls.read_text()=='worker --oracles-only --check --fast-testnet\n'
    assert not (state/'zero-oracle-repair-v1').exists()
    assert before=={p:(p.read_bytes(),p.stat().st_mode) for p in state.rglob('*') if p.is_file()}
    reset(fast=False)
    result=run(('--check',));assert result.returncode==0 and calls.read_text()=='worker --oracles-only --check\n'
    for fast in [True,False]:
        reset(fast=fast)
        result=run()
        assert result.returncode==0 and 'ZERO_ORACLE_REPAIR_COMPLETE:' in result.stdout, result.stdout+result.stderr
        log=calls.read_text();assert log.index('systemctl stop '+timer)<log.index('systemctl stop '+service)<log.index('worker --oracles-only --execute')
        assert json.loads(workers.read_text())[timer]['active']=='active'
        assert log.count('oracle-confirmed\n')==1
        assert '--fast-testnet' in log if fast else '--fast-testnet' not in log
    reset(fast=False)
    text=envfile.read_text()+'TRADES_ZERO_START_PROFILE=global-fresh-zero-v1\n'
    envfile.write_text(text);(host/'expected-env').write_text(text)
    result=run();assert result.returncode==0 and '--fast-testnet' not in calls.read_text(), result.stdout+result.stderr
    reset(hourly=True)
    result=run()
    assert result.returncode==0 and 'install --fast-testnet --oracle-recovery --hourly-test\n' in calls.read_text(), result.stdout+result.stderr
    reset()
    (host/'expect-hourly').touch()
    result=run(('--execute','--hourly-test'))
    assert result.returncode==0 and 'install --fast-testnet --oracle-recovery --hourly-test\n' in calls.read_text(), result.stdout+result.stderr
    for args in [(),('--execute','--fast-testnet'),('--check','--hourly-test'),('--execute','--execute'),('--hourly-test','--hourly-test','--execute')]:
        reset();result=run(args);assert result.returncode!=0 and calls.read_text()==''
    reset(fast=False)
    result=run(('--execute','--hourly-test'));assert result.returncode!=0 and calls.read_text()==''
    reset('proof-fail')
    result=run();assert result.returncode!=0 and json.loads(workers.read_text())==prior
    assert 'systemctl stop' not in calls.read_text()
    for unit in ['globaldroptrade-oracles.timer','globaldroptrade-migration.service']:
        reset();rows=copy.deepcopy(prior);rows[unit]={'enabled':'static','active':'active','load':'not-found'};workers.write_text(json.dumps(rows))
        result=run();assert result.returncode!=0 and json.loads(workers.read_text())==rows
        assert 'worker ' not in calls.read_text()
    reset('execute-fail');restored(run())
    reset('install-fail');restored(run());assert (host/'oracle-confirmed').exists()
    for mode in ['install-dirty','install-unloaded-active','install-health-fail','install-pending','oracle-pending','restore-start-fail']:
        reset(mode);stopped(run())
    reset('execute-env-change');stopped(run(expect_env=False))
    reset();file=selected/'journal.json';file.write_text('{"transactions":{"seed":{"hash":"unresolved"}}}')
    stopped(run());assert 'oracle-confirmed\n' not in calls.read_text()
    for root in [standard,state/'automation-v1',state/'oracle-maintenance-v1']:
        reset();file=root/'journal.json';file.write_text('{"transactions":{"old":{"hash":"unbroadcast"}}}')
        stopped(run());assert 'worker --oracles-only --execute' not in calls.read_text()
    reset()
    with (selected/'run.lock').open('w') as lock:
        (selected/'run.lock').chmod(0o600);fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        stopped(run());assert 'worker --oracles-only --execute' not in calls.read_text()
    reset();lockroot=state/'zero-oracle-repair-v1';lockroot.mkdir(mode=0o700)
    with (lockroot/'setup.lock').open('w') as lock:
        (lockroot/'setup.lock').chmod(0o600);fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        result=run();assert result.returncode!=0 and 'ALREADY_RUNNING' in result.stdout and calls.read_text()==''
    reset('oracle-pending');stopped(run());(host/'mode').write_text('success')
    result=run();assert result.returncode==0, result.stdout+result.stderr
    assert calls.read_text().count('oracle-confirmed\n')==1
    reset('stop-fail');result=run()
    assert result.returncode!=0 and 'previousWorkersRestored=0' in result.stdout and 'worker --oracles-only --execute' not in calls.read_text()
    reset();(selected/'run.lock').symlink_to(host/'accounts.json')
    result=run();assert result.returncode!=0 and 'PRIVATE_ORACLE_REPAIR_LOCK_REQUIRED' in result.stdout+result.stderr
    assert 'systemctl stop' not in calls.read_text()
    reset();envfile.chmod(0o644);result=run();assert result.returncode!=0 and calls.read_text()==''
    reset();realenv=envfile.with_suffix('.private');envfile.rename(realenv);envfile.symlink_to(realenv)
    result=run();assert result.returncode!=0 and calls.read_text()==''
    print('ZERO_ORACLE_REPAIR_HOST_CHECKS_PASSED: read-only diagnostics, selected target, shared locks, pending journals, persistent repair, hourly preservation and verified recovery')
