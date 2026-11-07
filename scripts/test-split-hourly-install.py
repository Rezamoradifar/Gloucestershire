"""Fake-host rollout: preserve journals, serialize services, retain safe failure state."""
from pathlib import Path
import os,subprocess,tempfile,unittest
REPO=Path(__file__).resolve().parents[1]
NAMES=('daily-profit.mjs','position-profit.mjs','zero-start-automation.mjs','zero-start-readiness.mjs','complete-rpc-logs.mjs','index-zero-positions.mjs','daily-activity-worker.mjs','daily-activity.mjs','smart-worker.py')
class SplitInstallTests(unittest.TestCase):
 def case(self,mode='success',quarter=False):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);source=root/'source';(source/'scripts').mkdir(parents=True);(source/'server').mkdir();(root/'bin').mkdir()
   for name in NAMES:(source/'scripts'/name).write_text('reviewed '+name)
   (source/'server/daily-activity.mjs').write_text('reviewed activity API')
   runtime=root/'opt/globaldroptrade-node/node-v22.23.3-linux-x64/bin';runtime.mkdir(parents=True)
   old=root/'opt/globaldroptrade-zero-daily/releases/old';(old/'scripts').mkdir(parents=True)
   for name in NAMES:(old/'scripts'/name).write_text('old '+name)
   (old.parent.parent/'current').symlink_to(old,target_is_directory=True)
   state=root/'var/lib/globaldroptrade/fresh-fast-testnet-automation-v1';state.mkdir(parents=True,mode=0o700)
   journal=state/'journal.json';journal.write_text('{"transactions":{"saved":{"raw":"preserve-signed-bytes","block":123}},"daily":{"positionPaid":{"a:0":11}}}');journal.chmod(0o600);before=journal.read_bytes()
   (root/'etc/systemd/system').mkdir(parents=True)
   script=(REPO/'ubuntu-split-hourly-worker.sh').read_text().replace('[[ $# = 1 && $1 = --execute && $EUID = 0 ]]','[[ $# = 1 && $1 = --execute ]]').replace('/var/lib/globaldroptrade',str(root/'var/lib/globaldroptrade')).replace('/opt/globaldroptrade',str(root/'opt/globaldroptrade')).replace('/etc/systemd/system',str(root/'etc/systemd/system'))
   (source/'install.sh').write_text(script)
   def executable(path,text):path.write_text(text);path.chmod(0o755)
   executable(runtime/'node',"#!/bin/bash\necho NODE \"$@\" >> \"$SPLIT_FIXTURE/calls\"\nif [[ $SPLIT_MODE = preflight-failure && $1 = scripts/zero-start-automation.mjs ]];then exit 1;fi\nexit 0\n")
   executable(root/'bin/npm','#!/bin/sh\nexit 0\n');executable(root/'bin/sleep','#!/bin/sh\nexit 0\n');executable(root/'bin/uname','#!/bin/sh\necho x86_64\n')
   executable(root/'bin/df','#!/bin/sh\necho "Filesystem 1024-blocks Used Available Capacity Mounted"\necho "/dev/mock 2000000 1000 1000000 1% /opt"\n')
   executable(root/'bin/systemctl','''#!/usr/bin/env python3
import os,sys
from pathlib import Path
r=Path(os.environ['SPLIT_FIXTURE']);a=sys.argv[1:]
with (r/'calls').open('a') as f:f.write(' '.join(a)+'\\n')
smart=any('smart-worker' in v for v in a);smart_mode=os.environ['SPLIT_MODE']=='smart'
if a[0]=='is-active':print('active' if not smart or smart_mode else 'inactive')
elif a[0]=='is-enabled':print('enabled' if smart and smart_mode else 'disabled')
elif a[0]=='show' and '--property=LoadState' in a:print('not-found' if (smart and not smart_mode) or (not smart and os.environ['SPLIT_MODE']=='missing-rpc-timer') else 'loaded')
elif a[0]=='show':print('active' if os.environ['SPLIT_MODE']=='busy' else 'inactive')
''')
   (source/'ubuntu-install-rpc-failover.sh').write_text('''#!/bin/bash
echo INSTALL_RPC >> "$SPLIT_FIXTURE/calls"
[[ $SPLIT_MODE != rpc-install-failure ]]
''')
   (root/'calls').write_text('')
   env={**os.environ,'PATH':str(root/'bin')+':'+os.environ['PATH'],'SPLIT_FIXTURE':str(root),'SPLIT_MODE':mode}
   result=subprocess.run(['bash',str(source/'install.sh'),'--execute']+(['--quarter-test'] if quarter else []),env=env,text=True,capture_output=True,timeout=30)
   calls=(root/'calls').read_text();self.assertEqual(journal.read_bytes(),before)
   self.assertNotIn('stop globaldroptrade-zero-daily.service',calls);self.assertNotIn('stop globaldroptrade-rpc-failover.service',calls)
   if mode in ('success','missing-rpc-timer','smart'):
    self.assertEqual(result.returncode,0,result.stdout+result.stderr)
    new=(old.parent.parent/'current').resolve();self.assertNotEqual(new,old)
    for name in NAMES:self.assertEqual((new/'scripts'/name).read_text(),'reviewed '+name)
    self.assertIn('--indexed-payments',(root/'etc/systemd/system/globaldroptrade-zero-daily.service.d/split-index.conf').read_text())
    index=(root/'etc/systemd/system/globaldroptrade-position-index.service').read_text();self.assertIn('index-zero-positions.mjs --execute --fast-testnet',index);self.assertIn('InaccessiblePaths=',index)
    self.assertIn('SPLIT_HOURLY_WORKER_INSTALLED',result.stdout)
    if mode!='missing-rpc-timer':self.assertLess(calls.index('--oracles-only --check'),calls.index('stop globaldroptrade-rpc-failover.timer'))
    else:self.assertNotIn('stop globaldroptrade-rpc-failover.timer',calls)
   if quarter:self.assertIn('scripts/install-quarter-policy.mjs --execute --locked-fd 9',calls)
   return result,calls
 def test_success_preserves_paid_journal_and_uses_signer_free_index_and_serialized_payments(self):self.case()
 def test_smart_mode_preserves_single_coordinator(self):
  r,c=self.case('smart');self.assertEqual(r.returncode,0,r.stdout+r.stderr)
  self.assertIn('enable --now globaldroptrade-smart-worker.timer',c)
  self.assertNotIn('start --no-block globaldroptrade-zero-daily.service',c)
  self.assertNotIn('enable --now globaldroptrade-position-index.timer',c)
  self.assertNotIn('stop globaldroptrade-smart-worker.service',c)
 def test_new_host_missing_rpc_timer_installs_without_losing_journal(self):self.case('missing-rpc-timer')
 def test_quarter_install_uses_the_held_financial_lock(self):self.case(quarter=True)
 def test_preflight_failure_changes_no_timers(self):
  r,c=self.case('preflight-failure');self.assertNotEqual(r.returncode,0);self.assertNotIn('stop ',c)
 def test_busy_worker_is_not_killed_and_prior_timers_resume(self):
  r,c=self.case('busy');self.assertEqual(r.returncode,75);self.assertIn('start globaldroptrade-zero-daily.timer',c);self.assertNotIn('INSTALL_RPC',c)
 def test_failure_after_source_switch_never_restores_old_financial_state_or_starts_payments(self):
  r,c=self.case('rpc-install-failure');self.assertNotEqual(r.returncode,0);self.assertIn('SPLIT_REVIEW_REQUIRED',r.stdout);self.assertNotIn('start --no-block globaldroptrade-zero-daily.service',c)
if __name__=='__main__':unittest.main()
