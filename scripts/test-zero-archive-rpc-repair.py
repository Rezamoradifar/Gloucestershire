"""Exercise the RPC-only cutover on an isolated host without signing transactions."""
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
real_node = shutil.which('node')
assert real_node
service = 'globaldroptrade-zero-daily.service'
timer = 'globaldroptrade-zero-daily.timer'
target = '0x04E26FcaA198d21cEf6d04e1e54f9C5f6399e522'
candidate = 'https://bsc-testnet-rpc.publicnode.com'
prior = {service: {'enabled': 'static', 'active': 'active'}, timer: {'enabled': 'enabled-runtime', 'active': 'active'}}
with tempfile.TemporaryDirectory() as directory:
    host = Path(directory)
    for name in ['source/scripts', 'source/config', 'bin', 'state/fresh-fast-testnet-automation-v1', 'state/fresh-fast-testnet-v1',
                 'state/fresh-fast-testnet-connection', 'state/zero-oracle-repair-v1', 'etc/globaldroptrade', 'etc/systemd/system',
                 'api/releases/current', 'daily/releases/current']:
        (host/name).mkdir(parents=True)
    source = host/'source'
    script = (repo/'ubuntu-zero-archive-rpc.sh').read_text()
    for original, replacement in {'/etc/globaldroptrade': host/'etc/globaldroptrade', '/etc/systemd/system': host/'etc/systemd/system',
                                  '/var/lib/globaldroptrade': host/'state', '/opt/globaldroptrade-api': host/'api',
                                  '/opt/globaldroptrade-zero-daily': host/'daily'}.items():
        script = script.replace(original, str(replacement))
    (source/'ubuntu-zero-archive-rpc.sh').write_text(script)
    shutil.copy(repo/'config/fresh-fast-testnet.json', source/'config/fresh-fast-testnet.json')
    state = host/'state/fresh-fast-testnet-automation-v1'
    deployment = host/'state/fresh-fast-testnet-v1'
    envfile = host/'etc/globaldroptrade/trades.env'
    secret = 'https://private.invalid/never-print-this-key'
    original_env = f'TRADES_CHAIN_ID=97\nTRADES_RPC_URL="{secret}"\nTRADES_VAULT_ADDRESS={target}\nTRADES_ZERO_START_PROFILE=global-fresh-fast-test-v1\nGLOBAL_MIGRATION_ENABLED=false\nUNCHANGED_SETTING="preserve this value"\n'
    baseline_journal = {'transactions': {'confirmed': {'block': 42, 'hash': 'fixed-confirmed', 'maxFee': '17'}}, 'daily': {'epoch': 0}, 'millionTestRewardGrant': {'completed': True}}
    baseline_policy = {'periodSeconds': 3600, 'startTimestamp': 1000, 'testMode': True}
    template = r'''#!@PYTHON@
import fcntl,hashlib,json,os,sys
from pathlib import Path
p=Path(@HOST@);args=sys.argv[1:];mode=(p/'mode').read_text();state=p/'state/fresh-fast-testnet-automation-v1';envfile=p/'etc/globaldroptrade/trades.env';candidate='https://bsc-testnet-rpc.publicnode.com';target=@TARGET@
def log(value):
 with (p/'calls').open('a') as f:f.write(value+'\n')
def unlocked():
 with (state/'run.lock').open('a') as f:
  try:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise AssertionError('Run lock must be released before any full worker can start')
def pending():
 j=json.loads((state/'journal.json').read_text());j['transactions']['new-pending']={'hash':'fixed-new-pending','raw':'preserved-signed-data','maxFee':'19'};(state/'journal.json').write_text(json.dumps(j))
def activation(count):
 j=json.loads((state/'journal.json').read_text());indexing=mode.startswith('warmup') or mode=='pending-diagnostic';epoch=0
 if mode=='warmup-index' and count>=4:indexing=False;epoch=1
 if mode=='warmup-advanced':epoch=1
 if not indexing:epoch=1
 j['daily']['epoch']=epoch;(state/'journal.json').write_text(json.dumps(j))
 a={'status':'waiting' if indexing else 'scheduled','dailyStatus':'indexing' if indexing else 'ready','nextEpoch':epoch,'errors':[],'readiness':{'ready':True},'blockers':['DAILY_MEMBER_INDEX_INCOMPLETE'] if indexing else [],'dailyCredits':[] if indexing else [{'status':'credited','transactionHash':'0x'+'ab'*32}],'policy':{'periodSeconds':3600,'startTimestamp':1000,'vaultAddress':target}}
 v={'chainId':97,'releaseId':'global-fresh-fast-test-v1','target':target,'allocationPeriodSeconds':3600,'timerActive':True,'ready':True,'dailyAutomationActive':not indexing,'blockers':[],'automation':a}
 if mode=='warmup-unknown':a['policy']['periodSeconds']=86400
 if mode=='warmup-other-wait':a['dailyStatus']='waiting';v['blockers']=['OTHER_WAIT']
 if mode=='pending-diagnostic':a['diagnostic']={'pendingSignedTransaction':True,'pendingFinancialTransaction':True}
 (p/'activation.json').write_text(json.dumps(v))
if args[0]=='prepare':
 args=args[1:];log('prepare '+' '.join(args))
 with (state/'run.lock').open('a') as f:
  try:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:pass
  else:raise AssertionError('Staging requires the selected journal run lock')
 if mode in ['proof-fail','fork-fail','history-fail','logs-fail']:print('ARCHIVE_PROOF_REQUIRED');raise SystemExit(1)
 if args==['--check','--fast-testnet']:print('ARCHIVE_RPC_CHECKED');raise SystemExit(0)
 assert args[0]=='--stage' and args[2:]==['--fast-testnet']
 assert all(json.loads((p/'workers.json').read_text())[name]['active']=='inactive' for name in [@SERVICE@,@TIMER@])
 out=Path(args[1]);out.mkdir(mode=0o700);original=envfile.read_bytes();next=original if candidate.encode() in original else original+(b'' if original.endswith(b'\n') else b'\n')+('TRADES_RPC_URL="'+candidate+'"\n').encode()
 ready={'ready':True,'chainId':97,'target':target,'allocationPeriodSeconds':3600,'archive':{'fullyVerified':True,'requiredRetentionSeconds':3600}}
 c=json.loads((p/'source/config/fresh-fast-testnet.json').read_text());sha=lambda b:hashlib.sha256(b).hexdigest()
 r={'version':1,'kind':'fresh-zero-archive-rpc-stage','chainId':97,'releaseId':c['releaseId'],'target':target,'owner':c['owner'],'operator':c['deployer'],'artifactHash':c['artifactHash'],'candidateRpcUrl':candidate,'ready':True,'transactionsSent':0,'signerOpened':False,'originalEnvSha256':sha(original),'stagedEnvSha256':sha(next),'anchor':{'block':43},'period':{'periodSeconds':3600,'epoch':0,'startTimestamp':1000}}
 for name,root,key in [('journal.json',state,'journalSha256'),('daily-policy.json',state,'policySha256'),('deployment-public.json',p/'state/fresh-fast-testnet-v1','deploymentSha256'),('connection-public.json',p/'state/fresh-fast-testnet-v1','connectionSha256')]:r[key]=sha((root/name).read_bytes())
 data=(json.dumps(ready)+'\n').encode();r['readinessSha256']=sha(data)
 if mode=='stage-hash-fail':r['originalEnvSha256']='0'*64
 if mode=='stage-key-fail':next+=b'UNRELATED_CHANGE=1\n';r['stagedEnvSha256']=sha(next)
 if mode=='readiness-fail':ready['archive']['fullyVerified']=False;data=(json.dumps(ready)+'\n').encode();r['readinessSha256']=sha(data)
 for name,value in [('trades.env',next),('readiness.json',data),('archive-rpc-stage.json',(json.dumps(r)+'\n').encode())]:(out/name).write_bytes(value);(out/name).chmod(0o600)
 if mode=='input-change':j=json.loads((state/'journal.json').read_text());j['externalChange']=True;(state/'journal.json').write_text(json.dumps(j))
elif args[0]=='systemctl':
 args=args[1:];command=args[0];unit=args[-1];log('systemctl '+' '.join(args));states=json.loads((p/'workers.json').read_text());row=states.get(unit,{'enabled':'disabled','active':'inactive'});new=candidate in envfile.read_text()
 if command=='show':print(('loaded' if unit in states else 'not-found') if '--property=LoadState' in args else row['active'])
 elif command=='is-enabled':print(row['enabled']);raise SystemExit(0 if row['enabled'].startswith('enabled') else 1)
 elif command=='is-active':raise SystemExit(0 if row['active']=='active' else 3)
 elif command=='stop':row['active']='inactive'
 elif command=='disable':row['enabled']='disabled'
 elif command=='enable':row['enabled']='enabled-runtime' if '--runtime' in args else 'enabled'
 elif command=='restart':
  if new and mode=='api-restart-fail':raise SystemExit(1)
 elif command=='start':
  if unit in [@SERVICE@,@TIMER@]:unlocked()
  if new and unit==@TIMER@ and mode=='timer-fail-after-run':pending();raise SystemExit(1)
  row['active']='active'
  if new and unit==@SERVICE@:
   count=int((p/'worker-count').read_text())+1;(p/'worker-count').write_text(str(count));log('candidate-worker '+str(count))
   if mode=='worker-fail':pending();raise SystemExit(1)
   activation(count)
 else:raise AssertionError(args)
 if unit in states:states[unit]=row
 (p/'workers.json').write_text(json.dumps(states))
elif args[0]=='curl':
 args=args[1:];url=next(x for x in args if x.startswith('https://'));out=Path(args[args.index('-o')+1]);new=candidate in envfile.read_text();log('curl '+url.rsplit('/',1)[-1])
 if url.endswith('/api/config'):data={'version':1,'chainId':97,'vaultAddress':target}
 elif url.endswith('/api/health'):
  fail=new and (mode=='api-health-fail' or (mode=='final-health-fail' and int((p/'worker-count').read_text())>0));data={'status':'bad' if fail else 'ok','configured':True}
 elif url.endswith('/deploy/zero-start-activation.json'):
  if mode=='malformed-status':out.write_text('not-json');raise SystemExit(0)
  out.write_bytes((p/'activation.json').read_bytes());raise SystemExit(0)
 else:raise AssertionError(url)
 out.write_text(json.dumps(data))
else:raise AssertionError(args)
'''
    template = template.replace('@PYTHON@', sys.executable).replace('@HOST@', repr(str(host))).replace('@TARGET@', repr(target)).replace('@SERVICE@', repr(service)).replace('@TIMER@', repr(timer))
    shim = host/'shim.py';shim.write_text(template);shim.chmod(0o755)
    (host/'bin/node').write_text(f'#!/usr/bin/env bash\nif [ "${{1:-}}" = scripts/prepare-zero-archive-rpc.mjs ];then shift;exec "{shim}" prepare "$@";fi\nexec "{real_node}" "$@"\n')
    for name in ['systemctl', 'curl']:(host/'bin'/name).write_text(f'#!/usr/bin/env bash\nexec "{shim}" {name} "$@"\n')
    (host/'bin/npm').write_text('#!/usr/bin/env bash\nexit 0\n')
    for p in (host/'bin').iterdir():p.chmod(0o755)
    (host/'api/current').symlink_to(host/'api/releases/current', target_is_directory=True)
    (host/'daily/current').symlink_to(host/'daily/releases/current', target_is_directory=True)
    apiunit = host/'etc/systemd/system/globaldroptrade-api.service';apiunit.write_text('[Service]\nExecStart=managed-api\n')
    dailyunit = host/'etc/systemd/system'/service;dailyunit.write_text(f'[Service]\nExecStart=/usr/bin/flock -n {state}/run.lock /usr/bin/node {host}/daily/current/scripts/zero-start-automation.mjs --execute --fast-testnet --seed-test-rewards --hourly-test\n')
    timerunit = host/'etc/systemd/system'/timer;timerunit.write_text('[Timer]\nOnBootSec=30s\n')
    protected = {deployment/'deployment-public.json': {'hash': '0x'+'ab'*32}, deployment/'connection-public.json': {'target': target}}
    for p in (host/'state').rglob('*'):
        if p.is_dir():p.chmod(0o700)
    env = os.environ.copy();env['PATH']=str(host/'bin')+':'+env['PATH']
    def reset(mode='success'):
        envfile.write_text(original_env);envfile.chmod(0o600);(state/'journal.json').write_text(json.dumps(baseline_journal));(state/'journal.json').chmod(0o600)
        (state/'daily-policy.json').write_text(json.dumps(baseline_policy));(state/'daily-policy.json').chmod(0o600)
        for p, data in protected.items():p.write_text(json.dumps(data));p.chmod(0o600)
        (host/'workers.json').write_text(json.dumps(prior));(host/'calls').write_text('');(host/'worker-count').write_text('0');(host/'mode').write_text(mode)
        for root in ['fresh-zero-automation-v1','automation-v1','oracle-maintenance-v1']:
            path=host/'state'/root
            if path.exists():shutil.rmtree(path)
    def run(mode='success', argument='--execute'):
        reset(mode);r=subprocess.run(['bash',str(source/'ubuntu-zero-archive-rpc.sh'),argument],cwd=source,env=env,text=True,capture_output=True,timeout=30)
        assert secret not in r.stdout+r.stderr,(mode,r.stdout,r.stderr)
        return r
    r=run();assert r.returncode==0,(r.stdout,r.stderr)
    assert envfile.read_text()==original_env+f'TRADES_RPC_URL="{candidate}"\n'
    assert json.loads((state/'journal.json').read_text())['millionTestRewardGrant']==baseline_journal['millionTestRewardGrant']
    assert json.loads((host/'workers.json').read_text())[timer]==prior[timer]
    calls=(host/'calls').read_text();assert calls.index('systemctl stop '+timer)<calls.index('systemctl stop '+service);assert int((host/'worker-count').read_text())==1
    for mode in ['proof-fail','fork-fail','history-fail','logs-fail','stage-hash-fail','stage-key-fail','readiness-fail','api-restart-fail','api-health-fail']:
        r=run(mode);assert r.returncode!=0,(mode,r.stdout,r.stderr);assert envfile.read_text()==original_env,mode
        assert json.loads((state/'journal.json').read_text())==baseline_journal,mode
        assert json.loads((host/'workers.json').read_text())==prior,(mode,r.stdout,r.stderr)
        assert 'previousWorkersRestored=1' in r.stdout,(mode,r.stdout,r.stderr)
    for mode in ['worker-fail','timer-fail-after-run','final-health-fail','malformed-status']:
        r=run(mode);assert r.returncode!=0,(mode,r.stdout,r.stderr);assert candidate in envfile.read_text(),mode
        assert 'workerMayHaveRun=1' in r.stdout,(mode,r.stdout,r.stderr)
        if mode in ['worker-fail','timer-fail-after-run']:assert 'new-pending' in json.loads((state/'journal.json').read_text())['transactions']
    for mode,count in [('warmup-index',4),('warmup-long',4),('warmup-other-wait',1),('warmup-unknown',1),('warmup-advanced',1),('pending-diagnostic',1)]:
        r=run(mode);assert r.returncode==0,(mode,r.stdout,r.stderr);assert int((host/'worker-count').read_text())==count,(mode,r.stdout,r.stderr)
    r=run('input-change');assert r.returncode!=0;assert envfile.read_text()==original_env;assert json.loads((state/'journal.json').read_text())['externalChange'] is True
    for selected in [True,False]:
        reset();path=(state if selected else host/'state/automation-v1')/'journal.json';path.parent.mkdir(exist_ok=True,mode=0o700);path.write_text('{"transactions":{"pending":{"raw":"must-remain"}}}');path.chmod(0o600);saved=path.read_bytes()
        r=subprocess.run(['bash',str(source/'ubuntu-zero-archive-rpc.sh'),'--execute'],cwd=source,env=env,text=True,capture_output=True,timeout=30)
        assert r.returncode!=0 and envfile.read_text()==original_env and path.read_bytes()==saved
    for lock in [host/'state/fresh-fast-testnet-connection/run.lock',host/'state/zero-oracle-repair-v1/setup.lock',state/'setup.lock',state/'run.lock']:
        reset();lock.touch(mode=0o600);lock.chmod(0o600)
        with lock.open('a') as held:
            fcntl.flock(held,fcntl.LOCK_EX|fcntl.LOCK_NB);r=subprocess.run(['bash',str(source/'ubuntu-zero-archive-rpc.sh'),'--execute'],cwd=source,env=env,text=True,capture_output=True,timeout=30)
        assert r.returncode!=0 and envfile.read_text()==original_env,(lock,r.stdout,r.stderr)
    r=run(argument='--check');assert r.returncode==0,(r.stdout,r.stderr);assert envfile.read_text()==original_env;assert json.loads((host/'workers.json').read_text())==prior;assert 'systemctl stop ' not in (host/'calls').read_text()
    reset();envfile.write_text(original_env.replace('global-fresh-fast-test-v1','global-fresh-zero-v1'))
    r=subprocess.run(['bash',str(source/'ubuntu-zero-archive-rpc.sh'),'--execute'],cwd=source,env=env,text=True,capture_output=True,timeout=30);assert r.returncode!=0 and 'prepare ' not in (host/'calls').read_text()
    reset();states=copy.deepcopy(prior);states['globaldroptrade-automation.service']={'active':'active','enabled':'enabled'};(host/'workers.json').write_text(json.dumps(states))
    r=subprocess.run(['bash',str(source/'ubuntu-zero-archive-rpc.sh'),'--execute'],cwd=source,env=env,text=True,capture_output=True,timeout=30);assert r.returncode!=0 and envfile.read_text()==original_env;assert 'systemctl stop ' not in (host/'calls').read_text()
print('ZERO_ARCHIVE_RPC_HOST_CHECKS_PASSED: verified RPC-only change, locks, pending guards, safe rollback, timer-first uncertainty and bounded same-period indexing')
