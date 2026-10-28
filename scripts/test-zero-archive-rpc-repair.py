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
    shutil.copy(repo/'scripts/zero-archive-candidate.mjs', source/'scripts/zero-archive-candidate.mjs')
    shutil.copy(repo/'scripts/stage-zero-log-reader.py', source/'scripts/stage-zero-log-reader.py')
    status_installer='''import json,sys
from pathlib import Path
p=Path(@HOST@)
args=sys.argv[1:]
with (p/'calls').open('a') as f:f.write('status-console '+args[0]+'\\n')
backup=Path(args[1])
if args[0]=='--backup-dir':
 backup.mkdir(parents=True,exist_ok=True,mode=0o700)
 (backup/'manifest.json').write_text(json.dumps({'previous':(p/'status-console').read_text()}));(backup/'manifest.json').chmod(0o600)
 (p/'status-console').write_text('new')
 if (p/'mode').read_text()=='status-install-fail':raise SystemExit(1)
elif args[0]=='--restore':(p/'status-console').write_text(json.loads((backup/'manifest.json').read_text())['previous'])
else:raise AssertionError(args)
'''
    (source/'scripts/install-zero-start-status.py').write_text(status_installer.replace('@HOST@',repr(str(host))))
    overlay = ['server/trades-api.mjs', 'scripts/connect-zero-start.mjs', 'scripts/daily-profit.mjs', 'scripts/position-profit.mjs', 'scripts/complete-rpc-logs.mjs',
               'scripts/zero-start-automation.mjs', 'scripts/zero-start-readiness.mjs', 'scripts/zero-start-hourly-test.mjs']
    for relative in overlay:
        (source/relative).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(repo/relative, source/relative)
    for role in ['api', 'daily']:
        release = host/role/'releases/current'
        for name in ['server', 'scripts', 'config', 'artifacts']:
            (release/name).mkdir(exist_ok=True)
            for file in (repo/name).glob('*.mjs' if name in ['server', 'scripts'] else '*.json'):
                if file.name != 'complete-rpc-logs.mjs':
                    shutil.copy(file, release/name/file.name)
        (release/'node_modules').symlink_to(repo/'node_modules', target_is_directory=True)
        (release/'unrelated-user-file.txt').write_text('Preserve this installed release file.\n')
    state = host/'state/fresh-fast-testnet-automation-v1'
    deployment = host/'state/fresh-fast-testnet-v1'
    envfile = host/'etc/globaldroptrade/trades.env'
    secret = 'https://private.invalid/never-print-this-key'
    private_url = 'https://archive.invalid/private-api-key-never-print'
    candidate_file = host/'etc/globaldroptrade/archive-rpc-url'
    original_env = f'TRADES_CHAIN_ID=97\nTRADES_RPC_URL="{secret}"\nTRADES_VAULT_ADDRESS={target}\nTRADES_ZERO_START_PROFILE=global-fresh-fast-test-v1\nGLOBAL_MIGRATION_ENABLED=false\nUNCHANGED_SETTING="preserve this value"\n'
    baseline_journal = {'transactions': {'confirmed': {'block': 42, 'hash': 'fixed-confirmed', 'maxFee': '17'}}, 'daily': {'epoch': 0}, 'millionTestRewardGrant': {'completed': True}}
    baseline_policy = {'periodSeconds': 3600, 'startTimestamp': 1000, 'testMode': True}
    template = r'''#!@PYTHON@
import fcntl,hashlib,json,os,sys
from pathlib import Path
p=Path(@HOST@);args=sys.argv[1:];mode=(p/'mode').read_text();state=p/'state/fresh-fast-testnet-automation-v1';envfile=p/'etc/globaldroptrade/trades.env';candidate=(p/'active-candidate-url').read_text() if (p/'active-candidate-url').exists() else 'https://bsc-testnet-rpc.publicnode.com';target=@TARGET@
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
 args=args[1:];log('prepare '+' '.join(args));file=None
 if '--candidate-file' in args:
  index=args.index('--candidate-file');file=Path(args[index+1]);del args[index:index+2];raw=file.read_bytes();text=raw.decode('utf8');candidate=text[:-2] if text.endswith('\r\n') else text[:-1] if text.endswith('\n') else text
  (p/'active-candidate-url').write_text(candidate);(p/'active-candidate-url').chmod(0o600)
 else:raw=None
 selected={'kind':'private' if file else 'public','sha256':hashlib.sha256(candidate.encode()).hexdigest(),'fileSha256':hashlib.sha256(raw).hexdigest() if raw is not None else None}
 with (state/'run.lock').open('a') as f:
  try:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:pass
  else:raise AssertionError('Staging requires the selected journal run lock')
 if mode in ['proof-fail','fork-fail','history-fail','logs-fail'] or (mode=='stage-proof-fail' and args[0]=='--stage'):print('ARCHIVE_PROOF_REQUIRED');raise SystemExit(1)
 if mode.startswith('member-index-') and not (p/'registry-repaired').exists():
  print('ZERO_ARCHIVE_RPC_PREPARATION_FAILED');print(json.dumps({'version':1,'kind':'fresh-zero-archive-rpc-stage-error','blocker':'INCOMPLETE_DAILY_MEMBER_INDEX','diagnostic':{'phase':'DAILY_PERIOD_PLAN'},'transactionsSent':0,'signerOpened':False}));raise SystemExit(1)
 if args==['--check','--fast-testnet']:
  if file and mode=='candidate-check-change':file.write_text(candidate+'?changed=1\n')
  if file and mode=='candidate-check-newline-change':file.write_bytes((candidate+'\r\n').encode())
  print('ARCHIVE_RPC_CHECKED');raise SystemExit(0)
 assert args[0]=='--stage' and args[2:]==['--fast-testnet']
 assert all(json.loads((p/'workers.json').read_text())[name]['active']=='inactive' for name in [@SERVICE@,@TIMER@])
 out=Path(args[1]);out.mkdir(mode=0o700);original=envfile.read_bytes();next=original if candidate.encode() in original else original+(b'' if original.endswith(b'\n') else b'\n')+('TRADES_RPC_URL="'+candidate+'"\n').encode()
 ready={'ready':True,'chainId':97,'target':target,'allocationPeriodSeconds':3600,'archive':{'fullyVerified':True,'requiredRetentionSeconds':3600}}
 c=json.loads((p/'source/config/fresh-fast-testnet.json').read_text());sha=lambda b:hashlib.sha256(b).hexdigest()
 r={'version':1,'kind':'fresh-zero-archive-rpc-stage','chainId':97,'releaseId':c['releaseId'],'target':target,'owner':c['owner'],'operator':c['deployer'],'artifactHash':c['artifactHash'],'candidate':selected,'ready':True,'transactionsSent':0,'signerOpened':False,'originalEnvSha256':sha(original),'stagedEnvSha256':sha(next),'anchor':{'block':43},'period':{'periodSeconds':3600,'epoch':0,'startTimestamp':1000}}
 for name,root,key in [('journal.json',state,'journalSha256'),('daily-policy.json',state,'policySha256'),('deployment-public.json',p/'state/fresh-fast-testnet-v1','deploymentSha256'),('connection-public.json',p/'state/fresh-fast-testnet-v1','connectionSha256')]:r[key]=sha((root/name).read_bytes())
 data=(json.dumps(ready)+'\n').encode();r['readinessSha256']=sha(data)
 if mode=='stage-hash-fail':r['originalEnvSha256']='0'*64
 if mode=='candidate-proof-fail':r['candidate']={**selected,'fileSha256':'0'*64}
 if mode=='stage-key-fail':next+=b'UNRELATED_CHANGE=1\n';r['stagedEnvSha256']=sha(next)
 if mode=='readiness-fail':ready['archive']['fullyVerified']=False;data=(json.dumps(ready)+'\n').encode();r['readinessSha256']=sha(data)
 for name,value in [('trades.env',next),('readiness.json',data),('archive-rpc-stage.json',(json.dumps(r)+'\n').encode())]:(out/name).write_bytes(value);(out/name).chmod(0o600)
 if file and mode=='candidate-stage-change':file.write_text(candidate+'?changed=1\n')
 if mode=='input-change':j=json.loads((state/'journal.json').read_text());j['externalChange']=True;(state/'journal.json').write_text(json.dumps(j))
elif args[0]=='repair':
 args=args[1:];log('repair '+' '.join(args));assert args[:4]==['--execute','--fast-testnet','--held-run-lock','6']
 with (state/'run.lock').open('a') as f:
  try:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:pass
  else:raise AssertionError('Repair requires the selected journal run lock')
 count=int((p/'repair-count').read_text())+1;(p/'repair-count').write_text(str(count))
 if mode=='member-index-fail':print('MEMBER_INDEX_REPAIR_FAILED');raise SystemExit(1)
 if mode=='member-index-timeout':
  (state/'member-index-rebuild.json').write_text(json.dumps({'pages':count}));(state/'member-index-rebuild.json').chmod(0o600);print('ZERO_MEMBER_INDEX_REBUILD_WAITING');raise SystemExit(76)
 if mode=='member-index-long' or (mode=='member-index-progress' and count<4):
  (state/'member-index-rebuild.json').write_text(json.dumps({'pages':count}));(state/'member-index-rebuild.json').chmod(0o600);print('ZERO_MEMBER_INDEX_REBUILD_IN_PROGRESS');raise SystemExit(75)
 j=json.loads((state/'journal.json').read_text());j['daily']['registry']={'through':43,'hash':'0x'+'12'*32,'members':{target:42}}
 if mode=='member-index-financial-change':j['maxTotalFee']='unexpected-change'
 if mode=='member-index-epoch-type-change':j['daily']['epoch']=False
 (state/'journal.json').write_text(json.dumps(j));(p/'registry-repaired').write_text('yes');print('ZERO_MEMBER_INDEX_REPAIRED')
elif args[0]=='systemctl':
 args=args[1:];command=args[0];unit=args[-1];log('systemctl '+' '.join(args));states=json.loads((p/'workers.json').read_text());row=states.get(unit,{'enabled':'disabled','active':'inactive'});new=candidate in envfile.read_text()
 if command=='show':print(('loaded' if unit in states else 'not-found') if '--property=LoadState' in args else row['active'])
 elif command=='is-enabled':print(row['enabled']);raise SystemExit(0 if row['enabled'].startswith('enabled') else 1)
 elif command=='is-active':raise SystemExit(0 if row['active']=='active' else 3)
 elif command=='stop':row['active']='inactive'
 elif command=='disable':row['enabled']='disabled'
 elif command=='enable':row['enabled']='enabled-runtime' if '--runtime' in args else 'enabled'
 elif command=='restart':
  count=int((p/'api-restarts').read_text())+1;(p/'api-restarts').write_text(str(count))
  if mode=='transient-502' or (mode=='rollback-transient-502' and not new):(p/'http-warmup').write_text('2')
  if mode=='permanent-502':(p/'http-warmup').write_text('99')
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
 if url.endswith('/api/config') or url.endswith('/api/health'):
  if new and url.endswith('/api/config'):log('candidate-config-read')
  left=int((p/'http-warmup').read_text())
  if left>0:(p/'http-warmup').write_text(str(left-1));print('HTTP_502_WARMING',file=sys.stderr);raise SystemExit(22)
 if url.endswith('/api/config'):data={'version':1,'chainId':97,'vaultAddress':'0x'+'11'*20 if new and mode=='wrong-target' else target}
 elif url.endswith('/api/health'):
  fail=new and (mode in ['api-health-fail','rollback-transient-502'] or (mode=='final-health-fail' and int((p/'worker-count').read_text())>0));data={'status':'bad' if fail else 'ok','configured':True}
 elif url.endswith('/deploy/zero-start-activation.json'):
  if mode=='malformed-status':out.write_text('not-json');raise SystemExit(0)
  out.write_bytes((p/'activation.json').read_bytes());raise SystemExit(0)
 else:raise AssertionError(url)
 out.write_text(json.dumps(data))
else:raise AssertionError(args)
'''
    template = template.replace('@PYTHON@', sys.executable).replace('@HOST@', repr(str(host))).replace('@TARGET@', repr(target)).replace('@SERVICE@', repr(service)).replace('@TIMER@', repr(timer))
    shim = host/'shim.py';shim.write_text(template);shim.chmod(0o755)
    (host/'bin/node').write_text(f'#!/usr/bin/env bash\nif [ "${{1:-}}" = scripts/prepare-zero-archive-rpc.mjs ];then shift;exec "{shim}" prepare "$@";fi\nif [ "${{1:-}}" = scripts/repair-zero-member-index.mjs ];then shift;exec "{shim}" repair "$@";fi\nexec "{real_node}" "$@"\n')
    for name in ['systemctl', 'curl']:(host/'bin'/name).write_text(f'#!/usr/bin/env bash\nexec "{shim}" {name} "$@"\n')
    (host/'bin/npm').write_text('#!/usr/bin/env bash\nexit 0\n');(host/'bin/sleep').write_text('#!/usr/bin/env bash\nexit 0\n')
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
        for role in ['api', 'daily']:
            current = host/role/'current'
            current.unlink()
            current.symlink_to(host/role/'releases/current', target_is_directory=True)
        envfile.write_text(original_env);envfile.chmod(0o600);(state/'journal.json').write_text(json.dumps(baseline_journal));(state/'journal.json').chmod(0o600)
        (state/'daily-policy.json').write_text(json.dumps(baseline_policy));(state/'daily-policy.json').chmod(0o600)
        for p, data in protected.items():p.write_text(json.dumps(data));p.chmod(0o600)
        (host/'workers.json').write_text(json.dumps(prior));(host/'calls').write_text('');(host/'worker-count').write_text('0');(host/'api-restarts').write_text('0');(host/'http-warmup').write_text('0');(host/'mode').write_text(mode)
        (host/'repair-count').write_text('0')
        (host/'status-console').write_text('old')
        if (host/'registry-repaired').exists():(host/'registry-repaired').unlink()
        if (host/'active-candidate-url').exists():(host/'active-candidate-url').unlink()
        for root in ['fresh-zero-automation-v1','automation-v1','oracle-maintenance-v1']:
            path=host/'state'/root
            if path.exists():shutil.rmtree(path)
    def run(mode='success', argument='--execute', private=False):
        reset(mode);extra=[]
        if private:candidate_file.write_text(private_url+'\n');candidate_file.chmod(0o600);extra=['--candidate-file',str(candidate_file)]
        r=subprocess.run(['bash',str(source/'ubuntu-zero-archive-rpc.sh'),argument,*extra],cwd=source,env=env,text=True,capture_output=True,timeout=30)
        assert secret not in r.stdout+r.stderr and private_url not in r.stdout+r.stderr,(mode,r.stdout,r.stderr)
        assert private_url not in (host/'calls').read_text(),(mode,r.stdout,r.stderr)
        return r
    r=run();assert r.returncode==0,(r.stdout,r.stderr)
    for role in ['api', 'daily']:
        installed=(host/role/'current').resolve()
        assert installed != host/role/'releases/current'
        assert (installed/'scripts/complete-rpc-logs.mjs').read_bytes() == (repo/'scripts/complete-rpc-logs.mjs').read_bytes()
        assert (installed/'unrelated-user-file.txt').read_text() == 'Preserve this installed release file.\n'
        assert not (host/role/'releases/current/scripts/complete-rpc-logs.mjs').exists()
    installed_imports=[str((host/'api/current/server/trades-api.mjs').resolve()),str((host/'daily/current/scripts/zero-start-automation.mjs').resolve())]
    imported=subprocess.run([real_node,'--input-type=module','-e','await Promise.all(process.argv.slice(2).map(file=>import(file)));','--','-',*installed_imports],cwd=repo,text=True,capture_output=True,timeout=20)
    assert imported.returncode==0,(imported.stdout,imported.stderr)
    assert envfile.read_text()==original_env+f'TRADES_RPC_URL="{candidate}"\n'
    assert json.loads((state/'journal.json').read_text())['millionTestRewardGrant']==baseline_journal['millionTestRewardGrant']
    assert json.loads((host/'workers.json').read_text())[timer]==prior[timer]
    calls=(host/'calls').read_text();assert calls.index('systemctl stop '+timer)<calls.index('systemctl stop '+service);assert int((host/'worker-count').read_text())==1
    assert (host/'status-console').read_text()=='new'
    assert calls.index('status-console --backup-dir')<calls.index('systemctl start '+timer),'The matching funding parser must be installed before worker activation'
    for mode in ['proof-fail','fork-fail','history-fail','logs-fail']:
        r=run(mode);assert r.returncode!=0,(mode,r.stdout,r.stderr);assert envfile.read_text()==original_env;assert json.loads((host/'workers.json').read_text())==prior
        assert 'systemctl stop ' not in (host/'calls').read_text() and 'systemctl restart ' not in (host/'calls').read_text(),(mode,r.stdout,r.stderr)
    installed_source=host/'daily/releases/current/scripts/daily-profit.mjs'
    saved_source=installed_source.read_bytes()
    try:
        installed_source.write_bytes(saved_source+b'\n// Unrelated local edit must not be overwritten.\n')
        r=run();assert r.returncode!=0 and 'INSTALLED_LOG_READER_SOURCE_REVIEW_REQUIRED' in r.stderr,(r.stdout,r.stderr)
        assert installed_source.read_bytes()!=saved_source and envfile.read_text()==original_env
        assert 'systemctl stop ' not in (host/'calls').read_text()
    finally:installed_source.write_bytes(saved_source)
    for mode in ['stage-proof-fail','stage-hash-fail','stage-key-fail','readiness-fail','status-install-fail','api-restart-fail','api-health-fail','rollback-transient-502','wrong-target']:
        r=run(mode);assert r.returncode!=0,(mode,r.stdout,r.stderr);assert envfile.read_text()==original_env,mode
        assert json.loads((state/'journal.json').read_text())==baseline_journal,mode
        assert json.loads((host/'workers.json').read_text())==prior,(mode,r.stdout,r.stderr)
        assert 'previousWorkersRestored=1' in r.stdout,(mode,r.stdout,r.stderr)
        assert all((host/role/'current').resolve()==host/role/'releases/current' for role in ['api','daily']),mode
        assert (host/'status-console').read_text()=='old',mode
    r=run('stage-proof-fail');assert r.returncode!=0;assert int((host/'api-restarts').read_text())==0;assert 'previousWorkersRestored=1' in r.stdout
    r=run('transient-502');assert r.returncode==0,(r.stdout,r.stderr);assert int((host/'api-restarts').read_text())==1;assert candidate in envfile.read_text();assert 'HTTP_502_WARMING' in r.stderr
    r=run('permanent-502');assert r.returncode!=0,(r.stdout,r.stderr);assert envfile.read_text()==original_env;assert 'previousWorkersRestored=0' in r.stdout
    assert all(row['active']=='inactive' for row in json.loads((host/'workers.json').read_text()).values());assert (host/'calls').read_text().count('candidate-config-read')==8
    r=run('wrong-target');assert r.returncode!=0 and (host/'calls').read_text().count('candidate-config-read')==1,(r.stdout,r.stderr)
    reset();off=copy.deepcopy(prior);off[timer]={'enabled':'disabled','active':'inactive'};off[service]['active']='inactive';(host/'workers.json').write_text(json.dumps(off))
    r=subprocess.run(['bash',str(source/'ubuntu-zero-archive-rpc.sh'),'--execute'],cwd=source,env=env,text=True,capture_output=True,timeout=30)
    assert r.returncode==0,(r.stdout,r.stderr);assert json.loads((host/'workers.json').read_text())[timer]=={'enabled':'enabled','active':'active'}
    for mode in ['worker-fail','timer-fail-after-run','final-health-fail','malformed-status']:
        r=run(mode);assert r.returncode!=0,(mode,r.stdout,r.stderr);assert candidate in envfile.read_text(),mode
        assert 'workerMayHaveRun=1' in r.stdout,(mode,r.stdout,r.stderr)
        assert all((host/role/'current').resolve()!=host/role/'releases/current' for role in ['api','daily']),mode
        assert (host/'status-console').read_text()=='new' and 'status-console --restore' not in (host/'calls').read_text(),mode
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
    r=run(private=True);assert r.returncode==0,(r.stdout,r.stderr);assert envfile.read_text()==original_env+f'TRADES_RPC_URL="{private_url}"\n'
    reports=list((host/'state/zero-oracle-repair-v1').glob('archive-rpc-*/stage/archive-rpc-stage.json'));private_reports=[json.loads(path.read_text()) for path in reports if json.loads(path.read_text()).get('candidate',{}).get('kind')=='private']
    assert private_reports and all(private_url not in json.dumps(report) for report in private_reports)
    r=run(argument='--check',private=True);assert r.returncode==0,(r.stdout,r.stderr);assert envfile.read_text()==original_env and json.loads((host/'workers.json').read_text())==prior
    for mode in ['candidate-check-change','candidate-check-newline-change','candidate-stage-change','candidate-proof-fail']:
        r=run(mode,private=True);assert r.returncode!=0,(mode,r.stdout,r.stderr);assert envfile.read_text()==original_env and json.loads((state/'journal.json').read_text())==baseline_journal
        if mode.startswith('candidate-check'):assert 'systemctl stop ' not in (host/'calls').read_text()
    for invalid in ['permissions','symlink','insecure-url']:
        reset();candidate_file.write_text(private_url+'\n');candidate_file.chmod(0o600);chosen=candidate_file
        if invalid=='permissions':candidate_file.chmod(0o644)
        if invalid=='symlink':chosen=host/'etc/globaldroptrade/archive-rpc-symlink';chosen.symlink_to(candidate_file)
        if invalid=='insecure-url':candidate_file.write_text('http://archive.invalid/private-api-key-never-print\n')
        r=subprocess.run(['bash',str(source/'ubuntu-zero-archive-rpc.sh'),'--execute','--candidate-file',str(chosen)],cwd=source,env=env,text=True,capture_output=True,timeout=30)
        assert r.returncode!=0 and envfile.read_text()==original_env and 'prepare ' not in (host/'calls').read_text()
        assert private_url not in r.stdout+r.stderr and secret not in r.stdout+r.stderr
    # A leftover private candidate file never changes the default public choice.
    r=run(argument='--check');assert r.returncode==0,(r.stdout,r.stderr);assert envfile.read_text()==original_env;assert json.loads((host/'workers.json').read_text())==prior;assert 'systemctl stop ' not in (host/'calls').read_text()
    r=run('member-index-success',private=True);assert r.returncode==0,(r.stdout,r.stderr);assert int((host/'repair-count').read_text())==1;assert json.loads((state/'journal.json').read_text())['daily']['registry']['through']==43
    assert (host/'calls').read_text().index('repair ') < (host/'calls').read_text().index('systemctl stop '+timer)
    r=run('member-index-progress',private=True);assert r.returncode==0,(r.stdout,r.stderr);assert int((host/'repair-count').read_text())==4
    for mode in ['member-index-long','member-index-fail']:
        r=run(mode,private=True);assert r.returncode==(75 if mode=='member-index-long' else 1),(mode,r.stdout,r.stderr)
        assert json.loads((state/'journal.json').read_text())==baseline_journal and envfile.read_text()==original_env
        assert 'systemctl stop ' not in (host/'calls').read_text() and json.loads((host/'workers.json').read_text())==prior
    r=run('member-index-timeout',private=True);assert r.returncode==75 and 'ZERO_MEMBER_INDEX_REBUILD_WAITING' in r.stdout,(r.stdout,r.stderr)
    assert int((host/'repair-count').read_text())==1,'An exhausted timeout must not multiply full proof/rebuild passes'
    assert (state/'member-index-rebuild.json').exists() and json.loads((state/'journal.json').read_text())==baseline_journal
    assert envfile.read_text()==original_env and 'systemctl stop ' not in (host/'calls').read_text() and json.loads((host/'workers.json').read_text())==prior
    r=run('member-index-success',argument='--check',private=True);assert r.returncode!=0 and int((host/'repair-count').read_text())==0
    r=run('member-index-financial-change',private=True);assert r.returncode!=0 and 'MEMBER_REPAIR_CHANGED_FINANCIAL_STATE' in r.stderr,(r.stdout,r.stderr)
    assert 'systemctl stop ' not in (host/'calls').read_text() and envfile.read_text()==original_env
    r=run('member-index-epoch-type-change',private=True);assert r.returncode!=0 and 'MEMBER_REPAIR_CHANGED_FINANCIAL_STATE' in r.stderr,(r.stdout,r.stderr)
    assert 'systemctl stop ' not in (host/'calls').read_text() and envfile.read_text()==original_env
    reset();envfile.write_text(original_env.replace('global-fresh-fast-test-v1','global-fresh-zero-v1'))
    r=subprocess.run(['bash',str(source/'ubuntu-zero-archive-rpc.sh'),'--execute'],cwd=source,env=env,text=True,capture_output=True,timeout=30);assert r.returncode!=0 and 'prepare ' not in (host/'calls').read_text()
    reset();states=copy.deepcopy(prior);states['globaldroptrade-automation.service']={'active':'active','enabled':'enabled'};(host/'workers.json').write_text(json.dumps(states))
    r=subprocess.run(['bash',str(source/'ubuntu-zero-archive-rpc.sh'),'--execute'],cwd=source,env=env,text=True,capture_output=True,timeout=30);assert r.returncode!=0 and envfile.read_text()==original_env;assert 'systemctl stop ' not in (host/'calls').read_text()
print('ZERO_ARCHIVE_RPC_HOST_CHECKS_PASSED: verified RPC-only change, locks, pending guards, safe rollback, timer-first uncertainty and bounded same-period indexing')
