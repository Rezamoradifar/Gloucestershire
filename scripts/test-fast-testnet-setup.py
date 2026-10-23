"""Exercise fast setup ordering and interrupted-phase recovery on an isolated host."""
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
service = 'globaldroptrade-zero-daily.service'
timer = 'globaldroptrade-zero-daily.timer'
prior = {
    'globaldroptrade-automation.timer': {'enabled': 'disabled', 'active': 'inactive'},
    'globaldroptrade-oracles.timer': {'enabled': 'enabled-runtime', 'active': 'active'},
    timer: {'enabled': 'enabled', 'active': 'active'},
    'globaldroptrade-automation.service': {'enabled': 'static', 'active': 'inactive'},
    'globaldroptrade-oracles.service': {'enabled': 'static', 'active': 'inactive'},
    service: {'enabled': 'static', 'active': 'active'},
}
with tempfile.TemporaryDirectory() as directory:
    host = Path(directory)
    for name in ['source', 'bin', 'state', 'etc/globaldroptrade', 'etc/systemd/system',
                 'api/releases/old', 'api/releases/fast', 'daily/releases/old', 'daily/releases/fast']:
        (host/name).mkdir(parents=True)
    source = host/'source'
    script = (repo/'ubuntu-fast-testnet.sh').read_text()
    for original, replacement in {
        '/etc/globaldroptrade': host/'etc/globaldroptrade', '/etc/systemd/system': host/'etc/systemd/system',
        '/var/lib/globaldroptrade': host/'state', '/opt/globaldroptrade-api': host/'api',
        '/opt/globaldroptrade-zero-daily': host/'daily',
    }.items():
        script = script.replace(original, str(replacement))
    (source/'ubuntu-fast-testnet.sh').write_text(script)
    workers = host/'workers.json'
    calls = host/'calls'
    envfile = host/'etc/globaldroptrade/trades.env'
    apiunit = host/'etc/systemd/system/globaldroptrade-api.service'
    dailyunit = host/'etc/systemd/system'/service
    timerunit = host/'etc/systemd/system'/timer
    secret = 'https://private.invalid/secret-do-not-print'
    env_original = 'TRADES_RPC_URL='+secret+'\nTRADES_VAULT_ADDRESS=old\n'
    state = host/'state'
    fast_deploy = state/'fresh-fast-testnet-v1'
    fast_auto = state/'fresh-fast-testnet-automation-v1'
    old_journal = state/'fresh-zero-automation-v1/journal.json'
    stage_code = f'''#!{sys.executable}
import json,os,sys
from pathlib import Path
p=Path({str(host)!r});args=sys.argv[1:];stage=args[0];mode=(p/'mode').read_text()
states=json.loads((p/'workers.json').read_text())
with (p/'calls').open('a') as f:f.write(stage+' '+' '.join(args[1:])+'\\n')
assert all(r['active'] in ['inactive','failed'] for r in states.values()),'Signer active before phase'
def write_journal(root,value):
 root.mkdir(mode=0o700,exist_ok=True);file=root/'journal.json';file.write_text(json.dumps(value));file.chmod(0o600)
def link(name,target):
 f=p/name
 if f.exists() or f.is_symlink():f.unlink()
 f.symlink_to(p/target,target_is_directory=True)
if stage=='deploy':
 assert args[1:]==['--execute','--fast-testnet']
 if mode in ['deploy-fail','unit-fail','health-fail','stop-fail']:
  if mode=='unit-fail':(p/'etc/systemd/system/{service}').write_text('unexpected-unit')
  if mode=='health-fail':(p/'bad-health').touch()
  raise SystemExit(1)
 root=p/'state/fresh-fast-testnet-v1'
 if mode=='deploy-pending':
  write_journal(root,{{'transactions':{{'fresh-deploy':{{'hash':'pending-fixture'}}}}}});raise SystemExit(1)
 marker=p/'deployed'
 if not marker.exists():
  marker.write_text('one deployment only')
  with (p/'calls').open('a') as f:f.write('new-deployment\\n')
 write_journal(root,{{'transactions':{{'fresh-deploy':{{'block':42}}}}}})
elif stage=='connect':
 assert args[1:]==['--fast-testnet']
 if mode=='connect-restored':raise SystemExit(1)
 (p/'etc/globaldroptrade/trades.env').write_text({env_original!r}.replace('ADDRESS=old','ADDRESS=fast'))
 (p/'etc/globaldroptrade/trades.env').chmod(0o600)
 (p/'config.json').write_text('{{"version":1,"chainId":97,"vaultAddress":"fast"}}')
 link('api/current','api/releases/fast')
 if mode=='connect-dirty':raise SystemExit(1)
elif stage=='enable':
 assert args[1:]==['--fast-testnet']
 if mode=='enable-fail':raise SystemExit(1)
 if mode in ['enable-dirty-new-units','enable-unloaded-active','enable-error-active']:
  (p/'etc/systemd/system/{service}').write_text('new-unit-after-failed-install')
  (p/'etc/systemd/system/{timer}').write_text('new-timer-after-failed-install')
  states[{timer!r}]={{'enabled':'enabled','active':'active'}}
  states[{service!r}]={{'enabled':'static','active':'active'}}
  if mode=='enable-unloaded-active':
   (p/'etc/systemd/system/{service}').unlink();(p/'etc/systemd/system/{timer}').unlink()
   states[{timer!r}]['load']='not-found';states[{service!r}]['load']='not-found'
  if mode=='enable-error-active':
   states[{timer!r}]['load']='error';states[{service!r}]['load']='error'
  (p/'workers.json').write_text(json.dumps(states));raise SystemExit(1)
 if mode=='seed-pending':
  write_journal(p/'state/fresh-fast-testnet-automation-v1',{{'transactions':{{'seed':{{'hash':'pending-fixture'}}}}}});raise SystemExit(1)
 (p/'etc/systemd/system/{service}').write_text('fast-unit')
 (p/'etc/systemd/system/{timer}').write_text('fast-timer')
 link('daily/current','daily/releases/fast')
 states[{timer!r}]={{'enabled':'enabled','active':'active'}}
 states[{service!r}]={{'enabled':'static','active':'inactive'}}
 (p/'workers.json').write_text(json.dumps(states))
 write_journal(p/'state/fresh-fast-testnet-automation-v1',{{'transactions':{{'seed':{{'block':48}}}}}})
 print('DAILY_PLAN_AUTOMATION_ACTIVE')
'''
    (host/'stage.py').write_text(stage_code)
    for name, stage in [('ubuntu-deploy-zero-start.sh', 'deploy'), ('ubuntu-connect-zero-start.sh', 'connect'),
                        ('ubuntu-enable-zero-daily.sh', 'enable')]:
        (source/name).write_text(f'#!/bin/bash\nexec {sys.executable} "{host}/stage.py" {stage} "$@"\n')
    systemctl_code = f'''#!{sys.executable}
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
 elif cmd=='start':row['active']='active'
 elif cmd=='disable':row['enabled']='disabled'
 elif cmd=='enable':row['enabled']='enabled-runtime' if '--runtime' in args else 'enabled'
 (p/'workers.json').write_text(json.dumps(states))
'''
    curl_code = f'''#!{sys.executable}
import shutil,sys
from pathlib import Path
p=Path({str(host)!r});args=sys.argv[1:];out=args[args.index('-o')+1];url=next(x for x in args if x.startswith('https://globaldroptrade.com/'))
if url.endswith('/api/health'):Path(out).write_text('{{"status":"bad","configured":false}}' if (p/'bad-health').exists() else '{{"status":"ok","configured":true}}')
elif url.endswith('/api/config'):shutil.copyfile(p/'config.json',out)
else:Path(out).write_text('same verified frontend')
'''
    for name, body in {'systemctl': systemctl_code, 'curl': curl_code, 'id': '#!/bin/bash\necho 0\n',
                       'npm': '#!/bin/bash\nexit 0\n'}.items():
        file = host/'bin'/name
        file.write_text(body)
        file.chmod(0o755)
    environment = {**os.environ, 'PATH': str(host/'bin')+':'+os.environ['PATH']}

    def reset(mode='success'):
        for name in ['deployed', 'bad-health']:
            (host/name).unlink(missing_ok=True)
        for name in ['fresh-fast-testnet-v1', 'fresh-fast-testnet-automation-v1', 'fast-testnet-setup-v1',
                     'fresh-zero-automation-v1']:
            shutil.rmtree(state/name, ignore_errors=True)
        (old_journal.parent).mkdir(mode=0o700)
        old_journal.write_text('{"transactions":{}}')
        old_journal.chmod(0o600)
        (host/'mode').write_text(mode)
        workers.write_text(json.dumps(prior))
        calls.write_text('')
        envfile.write_text(env_original)
        envfile.chmod(0o600)
        apiunit.write_text('same API unit')
        apiunit.chmod(0o644)
        dailyunit.write_text('old-unit')
        timerunit.write_text('old-timer')
        (host/'config.json').write_text('{"version":1,"chainId":97,"vaultAddress":"old"}')
        for name in ['api', 'daily']:
            file = host/name/'current'
            if file.exists() or file.is_symlink():
                file.unlink()
            file.symlink_to(host/name/'releases/old', target_is_directory=True)

    def run(args=('--execute',)):
        result = subprocess.run(['bash', str(source/'ubuntu-fast-testnet.sh'), *args], cwd=source,
                                env=environment, capture_output=True, text=True, timeout=30)
        assert secret not in result.stdout+result.stderr
        return result

    def stopped(result):
        assert result.returncode != 0, result.stdout+result.stderr
        assert 'FAST_TESTNET_SETUP_COMPLETE:' not in result.stdout
        assert all(row['active']=='inactive' for row in json.loads(workers.read_text()).values())
        assert 'previousWorkersRestored=0' in result.stdout

    def restored(result):
        assert result.returncode != 0, result.stdout+result.stderr
        assert json.loads(workers.read_text()) == prior
        assert 'previousWorkersRestored=1' in result.stdout
        assert envfile.read_text() == env_original

    reset()
    result = run(())
    assert result.returncode != 0 and calls.read_text() == ''
    reset()
    result = run()
    assert result.returncode == 0, result.stdout+result.stderr
    assert 'FAST_TESTNET_SETUP_COMPLETE:' in result.stdout and 'DAILY_PLAN_AUTOMATION_ACTIVE' in result.stdout
    assert calls.read_text().count('new-deployment\n') == 1
    assert json.loads(workers.read_text())[timer]['active'] == 'active'
    result = run()
    assert result.returncode == 0, result.stdout+result.stderr
    assert calls.read_text().count('new-deployment\n') == 1
    reset('deploy-fail')
    restored(run())
    reset('connect-restored')
    restored(run())
    assert (host/'deployed').exists()
    reset()
    old_journal.write_text('{"transactions":{"earlier":{"hash":"unbroadcast"}}}')
    result = run()
    restored(result)
    assert 'PENDING_SIGNED_TRANSACTION' in result.stdout+result.stderr and '\ndeploy ' not in calls.read_text()
    reset('deploy-pending')
    stopped(run())
    (host/'mode').write_text('success')
    result = run()
    assert result.returncode == 0, result.stdout+result.stderr
    for mode in ['connect-dirty', 'enable-fail', 'seed-pending', 'unit-fail', 'health-fail']:
        reset(mode)
        stopped(run())
    reset('enable-dirty-new-units')
    dailyunit.unlink()
    timerunit.unlink()
    (host/'daily/current').unlink()
    baseline = copy.deepcopy(prior)
    baseline.pop(service)
    baseline.pop(timer)
    workers.write_text(json.dumps(baseline))
    stopped(run())
    assert json.loads(workers.read_text())[timer]['enabled'] == 'disabled'
    reset('enable-unloaded-active')
    dailyunit.unlink()
    timerunit.unlink()
    (host/'daily/current').unlink()
    workers.write_text(json.dumps(baseline))
    stopped(run())
    reset('enable-error-active')
    stopped(run())
    reset('enable-fail')
    stopped(run())
    (host/'mode').write_text('success')
    result = run()
    assert result.returncode == 0, result.stdout+result.stderr
    assert calls.read_text().count('new-deployment\n') == 1
    reset('stop-fail')
    result = run()
    assert result.returncode != 0 and '\ndeploy ' not in calls.read_text()
    assert 'previousWorkersRestored=0' in result.stdout
    reset()
    lockdir = state/'fast-testnet-setup-v1'
    lockdir.mkdir(mode=0o700)
    with (lockdir/'setup.lock').open('w') as file:
        (lockdir/'setup.lock').chmod(0o600)
        fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = run()
        assert result.returncode != 0 and 'ALREADY_RUNNING' in result.stdout and calls.read_text() == ''
    reset()
    (host/'bad-health').touch()
    result = run()
    assert result.returncode != 0 and json.loads(workers.read_text()) == prior and '\ndeploy ' not in calls.read_text()
    reset()
    altered = copy.deepcopy(prior)
    altered['globaldroptrade-migration.service'] = {'enabled': 'static', 'active': 'active', 'load': 'not-found'}
    workers.write_text(json.dumps(altered))
    result = run()
    assert result.returncode != 0 and 'OTHER_DEPLOYMENT_RUNNING' in result.stdout
    assert json.loads(workers.read_text()) == altered and '\ndeploy ' not in calls.read_text()
    reset()
    envfile.write_text(env_original+'GLOBAL_AUTOMATION_STATE=/custom-private-state\n')
    result = run()
    assert result.returncode != 0 and json.loads(workers.read_text()) == prior and calls.read_text() == ''
    print('FAST_TESTNET_SETUP_ISOLATED_CHECKS_PASSED: phase ordering, retry, pending journals, recovery and locks')
