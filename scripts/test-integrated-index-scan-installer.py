import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

FILE=Path(__file__).with_name('install-integrated-index-scan.py')
spec=importlib.util.spec_from_file_location('index_installer',FILE)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
real_timer_window=module.timer_window

def read_unchecked(path): return path.read_bytes(),path.stat()

class InstallerTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();root=Path(self.tmp.name)
  self.state=root/'state';self.state.mkdir();self.journal=self.state/'journal.json';self.journal.write_bytes(b'{"financial":"preserve"}')
  self.backups=root/'backups';self.backups.mkdir();self.releases=root/'releases';self.releases.mkdir()
  self.old=self.releases/'existing';(self.old/'scripts').mkdir(parents=True)
  (self.old/'scripts/position-profit.mjs').write_bytes(b'old position')
  (self.old/'scripts/complete-rpc-logs.mjs').write_bytes(b'old log code')
  (self.old/'scripts/new-deployer-testnet-automation.mjs').write_bytes(b'old worker')
  (self.old/'scripts/daily-profit.mjs').write_bytes(b'daily dependency')
  self.repo=root/'repo';(self.repo/'scripts').mkdir(parents=True)
  (self.repo/'scripts/position-profit.mjs').write_bytes(b'new position')
  (self.repo/'scripts/complete-rpc-logs.mjs').write_bytes(b'new log code')
  self.unit=root/'worker.service';self.unit.write_text(f'[Service]\nWorkingDirectory={self.old}\nExecStart=/usr/bin/node {self.old}/scripts/new-deployer-testnet-automation.mjs --execute\n')
  self.original=self.unit.read_bytes();self.journal_before=self.journal.read_bytes();self.current=self.old
  def command(*args):
   if args[:4]==('systemctl','show',module.SERVICE,'-p') and 'WorkingDirectory' in args: return str(self.current)
   if args[:4]==('systemctl','show',module.SERVICE,'-p') and 'ExecStart' in args: return f'/usr/bin/node {self.current}/scripts/new-deployer-testnet-automation.mjs --execute'
   if args==('systemctl','daemon-reload'):
    text=self.unit.read_text();self.current=Path(next(line.split('=',1)[1] for line in text.splitlines() if line.startswith('WorkingDirectory=')))
   return ''
  changes=[patch.object(module,'STATE',self.state),patch.object(module,'BACKUPS',self.backups),patch.object(module,'RELEASES',self.releases),
   patch.object(module,'UNIT',self.unit),patch.object(module,'REPO',self.repo),
   patch.object(module,'VERSIONS',{module.digest(b'old position'):('scripts/position-profit.mjs',module.digest(b'new position'),module.digest(b'old worker'))}),
   patch.object(module,'DAILY_HASH',module.digest(b'daily dependency')),patch.object(module,'NEW_LOG_HASH',module.digest(b'new log code')),patch.object(module.os,'geteuid',return_value=0),
   patch.object(module,'root_directory'),patch.object(module,'read_file',side_effect=read_unchecked),patch.object(module,'status'),
   patch.object(module,'worker_idle'),patch.object(module,'timer_window'),patch.object(module,'identity_inputs',return_value=(b'identity',)),patch.object(module,'probe_index'),patch.object(module,'worker_location',side_effect=lambda:self.current),
   patch.object(module,'is_active',return_value=True),patch.object(module,'run',side_effect=command)]
  self.changes=changes;[item.start() for item in changes]
 def tearDown(self):
  for item in reversed(self.changes): item.stop()
  self.tmp.cleanup()
 def test_success_uses_separate_release_and_keeps_journal(self):
  module.install('--execute')
  self.assertNotEqual(self.current,self.old)
  self.assertEqual((self.old/'scripts/position-profit.mjs').read_bytes(),b'old position')
  self.assertEqual((self.current/'scripts/position-profit.mjs').read_bytes(),b'new position')
  self.assertEqual((self.current/'scripts/complete-rpc-logs.mjs').read_bytes(),b'new log code')
  self.assertEqual(self.journal.read_bytes(),self.journal_before)
  self.assertFalse((self.state/'run.lock').exists())
  self.assertEqual(next(self.backups.glob('*/worker.service')).read_bytes(),self.original)
 def test_post_switch_failure_restores_unit(self):
  with patch.object(module,'is_active',return_value=False):
   with self.assertRaisesRegex(RuntimeError,'INDEX_SCAN_TIMER_INACTIVE'): module.install('--execute')
  self.assertEqual(self.unit.read_bytes(),self.original);self.assertFalse((self.state/'run.lock').exists())
  self.assertEqual(self.journal.read_bytes(),self.journal_before)
 def test_unknown_source_fails_before_writing(self):
  (self.old/'scripts/position-profit.mjs').write_bytes(b'unknown')
  with self.assertRaisesRegex(RuntimeError,'INDEX_SCAN_VERSION_MISMATCH'): module.install('--execute')
  self.assertFalse(any(self.backups.iterdir()));self.assertEqual(self.unit.read_bytes(),self.original)
 def test_busy_lock_never_overwrites_owner(self):
  lock=self.state/'run.lock';lock.write_text('12345')
  with self.assertRaisesRegex(RuntimeError,'INDEX_SCAN_WORKER_BUSY'): module.install('--execute')
  self.assertEqual(lock.read_text(),'12345');self.assertEqual(self.unit.read_bytes(),self.original)
 def test_check_is_read_only(self):
  module.install('--check')
  self.assertFalse(any(self.backups.iterdir()));self.assertEqual(self.unit.read_bytes(),self.original)
 def test_unit_must_match_exact_release_and_command(self):
  with self.assertRaisesRegex(RuntimeError,'INDEX_SCAN_UNIT_CONTENT_MISMATCH'):
   module.render_unit(b'[Service]\nExecStart=wrong\n',self.old,self.releases/'new')
 def test_timer_window_rejects_unknown_or_near(self):
  with patch.object(module.time,'monotonic_ns',return_value=100_000_000_000),patch.object(module,'run',return_value='t 120000000'):
   with self.assertRaisesRegex(RuntimeError,'INDEX_SCAN_TIMER_WINDOW_REQUIRED'): real_timer_window()
  with patch.object(module.time,'monotonic_ns',return_value=100_000_000_000),patch.object(module,'run',return_value='t 200000000'):
   real_timer_window()
 def test_signal_after_switch_restores_unit_and_releases_lock(self):
  previous=module.run;state={'fired':False}
  def command(*args):
   if args==('systemctl','daemon-reload') and not state['fired']:
    state['fired']=True;raise SystemExit(143)
   return previous(*args)
  with patch.object(module,'run',side_effect=command):
   with self.assertRaises(SystemExit): module.install('--execute')
  self.assertEqual(self.unit.read_bytes(),self.original)
  self.assertFalse((self.state/'run.lock').exists())
  self.assertEqual(self.journal.read_bytes(),self.journal_before)
 def test_changed_identity_never_changes_unit(self):
  with patch.object(module,'identity_inputs',side_effect=[(b'a',),(b'a',),(b'b',)]):
   with self.assertRaisesRegex(RuntimeError,'INDEX_SCAN_RELEASE_CHANGED'): module.install('--execute')
  self.assertEqual(self.unit.read_bytes(),self.original)
  self.assertFalse((self.state/'run.lock').exists())

if __name__=='__main__': unittest.main()
