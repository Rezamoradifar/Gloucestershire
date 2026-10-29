"""Exercise quiescence, source alignment and failure recovery on a fake host."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

REPO=Path(__file__).resolve().parents[1]
NAMES=('daily-profit.mjs','position-profit.mjs','zero-start-automation.mjs','complete-rpc-logs.mjs')

class SourceSyncTests(unittest.TestCase):
 def run_case(self,mode='success'):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);source=root/'source';source.mkdir();(source/'scripts').mkdir()
   (root/'bin').mkdir();worker=root/'worker/current/scripts';worker.mkdir(parents=True)
   monitor=root/'monitor/releases/new/scripts';monitor.mkdir(parents=True)
   for name in (*NAMES,'zero-rpc-failover.py'):(source/'scripts'/name).write_text('reviewed-'+name)
   journal=root/'journal.json';journal.write_text('{"paid":6,"pending":false}')
   script=(REPO/'ubuntu-sync-hourly-worker.sh').read_text().replace('/var/lib/globaldroptrade/worker-sync-v1',str(root/'state')).replace('/opt/globaldroptrade-zero-daily',str(root/'worker')).replace('/opt/globaldroptrade-rpc-failover',str(root/'monitor'))
   (source/'sync.sh').write_text(script)
   def executable(path,text):path.write_text(text);path.chmod(0o755)
   executable(root/'bin/id','#!/bin/sh\necho 0\n')
   executable(root/'bin/sleep','#!/bin/sh\nexit 0\n')
   executable(root/'bin/systemctl','''#!/usr/bin/env python3
import os,sys
from pathlib import Path
r=Path(os.environ['SYNC_FIXTURE']);args=sys.argv[1:]
with (r/'calls').open('a') as f:f.write(' '.join(args)+'\\n')
if args[0]=='is-active':print('active')
elif args[0]=='show':
 if '--property=WorkingDirectory' in args:print(r/'monitor/releases/new')
 else:
  name=args[1];file=r/('monitor-count' if 'rpc-failover' in name else 'worker-count')
  n=int(file.read_text()) if file.exists() else 0;file.write_text(str(n+1))
  print('active' if os.environ['SYNC_MODE']=='busy' or n<1 else 'inactive')
''')
   (source/'ubuntu-position-hourly.sh').write_text('''#!/bin/bash
set -eu
echo INSTALL_WORKER >> "$SYNC_FIXTURE/calls"
if [ "$SYNC_MODE" = install-failure ];then exit 1;fi
cp scripts/*.mjs "$SYNC_FIXTURE/worker/current/scripts/"
if [ "$SYNC_MODE" = mismatch ];then echo old > "$SYNC_FIXTURE/worker/current/scripts/position-profit.mjs";fi
''')
   (source/'ubuntu-install-rpc-failover.sh').write_text('''#!/bin/bash
set -eu
echo INSTALL_MONITOR >> "$SYNC_FIXTURE/calls"
cp scripts/* "$SYNC_FIXTURE/monitor/releases/new/scripts/"
''')
   (source/'ubuntu-check-hourly-payments.sh').write_text('''#!/bin/bash
echo AUDIT >> "$SYNC_FIXTURE/calls"
[ "$SYNC_MODE" != audit-failure ]
''')
   env={**os.environ,'PATH':str(root/'bin')+':'+os.environ['PATH'],'SYNC_FIXTURE':str(root),'SYNC_MODE':mode}
   result=subprocess.run(['bash',str(source/'sync.sh'),'--execute','--wallet','0x'+'12'*20],env=env,text=True,capture_output=True,timeout=20)
   calls=(root/'calls').read_text();self.assertEqual(journal.read_text(),'{"paid":6,"pending":false}')
   self.assertNotIn('stop globaldroptrade-zero-daily.service',calls)
   self.assertNotIn('stop globaldroptrade-rpc-failover.service',calls)
   return result,calls
 def test_waits_then_installs_matching_worker_and_monitor(self):
  r,c=self.run_case();self.assertEqual(r.returncode,0,r.stdout+r.stderr)
  self.assertIn('WORKER_AND_FAILOVER_SOURCES_ALIGNED',r.stdout)
  self.assertLess(c.index('INSTALL_WORKER'),c.index('INSTALL_MONITOR'));self.assertLess(c.index('INSTALL_MONITOR'),c.index('AUDIT'))
  self.assertGreaterEqual(c.count('--property=ActiveState'),4)
 def test_busy_transition_is_never_killed_and_original_timers_resume(self):
  r,c=self.run_case('busy');self.assertEqual(r.returncode,75,r.stdout+r.stderr)
  self.assertNotIn('INSTALL_WORKER',c);self.assertIn('start globaldroptrade-zero-daily.timer',c);self.assertIn('start globaldroptrade-rpc-failover.timer',c)
 def test_failed_worker_install_keeps_old_failover_paused(self):
  r,c=self.run_case('install-failure');self.assertEqual(r.returncode,1)
  self.assertNotIn('INSTALL_MONITOR',c);self.assertNotIn('start globaldroptrade-rpc-failover.timer',c)
  self.assertIn('RPC_FAILOVER_LEFT_PAUSED',r.stdout)
 def test_mismatched_worker_is_not_reported_as_aligned(self):
  r,c=self.run_case('mismatch');self.assertEqual(r.returncode,1)
  self.assertNotIn('INSTALL_MONITOR',c);self.assertIn('WORKER_SYNC_SOURCE_MISMATCH',r.stdout)
 def test_failed_read_only_audit_does_not_undo_successful_alignment(self):
  r,c=self.run_case('audit-failure');self.assertEqual(r.returncode,0)
  self.assertIn('WORKER_SYNC_COMPLETE_AUDIT_WAITING',r.stdout);self.assertNotIn('WORKER_SYNC_FAILED',r.stdout)

if __name__=='__main__':unittest.main()
