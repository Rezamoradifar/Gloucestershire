"""Verify selection decisions without contacting providers or sending transactions."""
import importlib.util
from pathlib import Path
import unittest
import contextlib,io,json,os,tempfile
from types import SimpleNamespace
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('failover',Path(__file__).resolve().parents[1]/'scripts/zero-rpc-failover.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class FailoverTests(unittest.TestCase):
 def test_unverified_endpoints_never_apply(self):
  calls=[]
  r=m.rotate(lambda u:False,lambda u:calls.append(u))
  self.assertEqual(r['status'],'no-verified-candidate');self.assertEqual(calls,[])
  self.assertEqual(len(r['attempts']),3)
 def test_next_endpoint_requires_own_proof(self):
  probed=[];applied=[]
  def probe(u):probed.append(u);return u==m.CANDIDATES[1][1]
  r=m.rotate(probe,lambda u:applied.append(u) or True)
  self.assertEqual(r['status'],'updated');self.assertEqual(len(probed),2)
  self.assertEqual(applied,[m.CANDIDATES[1][1]])
 def test_apply_failure_does_not_attempt_another_financial_transition(self):
  probed=[]
  r=m.rotate(lambda u:probed.append(u) or True,lambda u:False)
  self.assertEqual(r['status'],'apply-failed');self.assertEqual(len(probed),1)
 def test_final_candidate_can_be_selected(self):
  r=m.rotate(lambda u:u==m.CANDIDATES[-1][1],lambda u:True)
  self.assertEqual(r['selected'],m.CANDIDATES[-1][0])
 def test_success_stops_probe_sequence(self):
  calls=[]
  r=m.rotate(lambda u:calls.append(u) or True,lambda u:True)
  self.assertEqual(len(calls),1);self.assertEqual(r['status'],'updated')
 def test_healthy_and_indexing_workers_do_not_rotate(self):
  for blockers in [[],['DAILY_MEMBER_INDEX_INCOMPLETE'],['REWARD_FUNDING_REQUIRED']]:
   self.assertFalse(m.needs_rotation({'automation':{'blockers':blockers}},'0'))
 def test_rpc_wait_and_creation_failures_trigger_checks(self):
  self.assertTrue(m.needs_rotation({'automation':{'blockers':['DAILY_PERIOD_PLAN_RPC_UNAVAILABLE']}},'0'))
  self.assertTrue(m.needs_rotation({'automation':{}},'1'))
 def test_busy_flock_exit_does_not_trigger_rotation(self):
  self.assertFalse(m.needs_rotation({'automation':{}},'75'))
 def test_report_never_contains_urls(self):
  r=m.rotate(lambda u:False,lambda u:False)
  self.assertNotIn('https',str(r))
 def test_installed_service_is_independent_and_never_kills_inflight_repair(self):
  s=(Path(__file__).resolve().parents[1]/'ubuntu-install-rpc-failover.sh').read_text()
  self.assertIn('Type=oneshot',s);self.assertIn('TimeoutStartSec=infinity',s)
  self.assertIn('WantedBy=timers.target',s);self.assertIn('systemctl enable --now',s)
  self.assertIn('--no-block',s);self.assertNotIn('systemctl stop globaldroptrade-zero-daily.service',s)

class MonitorIntegrationTests(unittest.TestCase):
 def exercise(self, interrupt=False):
  with tempfile.TemporaryDirectory() as directory:
   state=Path(directory)/'state';state.mkdir(mode=0o700)
   activation=Path(directory)/'activation.json';activation.write_text(json.dumps({'automation':{'blockers':['DAILY_PERIOD_PLAN_RPC_UNAVAILABLE']}}))
   calls=[]
   def path(value):
    return activation if str(value)=='/var/www/globaldroptrade/automation-data/activation.json' else Path(value)
   def run(args,**kwargs):
    calls.append(args)
    if args[0]=='systemctl':return SimpleNamespace(stdout='inactive' if args[1]=='is-active' else '1',returncode=0)
    mode=args[2];url=Path(args[-1]).read_text().strip()
    if mode=='--check':return SimpleNamespace(returncode=0 if url==m.CANDIDATES[1][1] else 1)
    self.assertEqual(json.loads((state/'status.json').read_text())['status'],'apply-in-progress')
    if interrupt:raise OSError('private provider data')
    return SimpleNamespace(returncode=0)
   out=io.StringIO();old_mask=os.umask(0o077)
   try:
    with patch.object(m,'STATE',state),patch.object(m,'Path',side_effect=path),patch.object(m.os,'geteuid',return_value=0),patch.object(m,'trusted_directory',side_effect=lambda p:None),patch.object(m.subprocess,'run',side_effect=run),contextlib.redirect_stdout(out):
     if interrupt:
      with self.assertRaises(OSError):m.main()
      before=len(calls);m.main();self.assertEqual(len(calls),before+2)
      self.assertIn('APPLY_RECOVERY_REQUIRED',out.getvalue())
     else:
      m.main();report=json.loads((state/'status.json').read_text())
      self.assertEqual(report['status'],'updated');self.assertEqual(report['selected'],m.CANDIDATES[1][0])
      self.assertEqual((state/'status.json').stat().st_mode&0o777,0o600)
      self.assertIn('RPC_FAILOVER_UPDATED',out.getvalue())
    self.assertEqual(list(state.glob('candidate-*')),[])
    self.assertNotIn('https',out.getvalue())
   finally:os.umask(old_mask)
 def test_installed_monitor_checks_then_applies_with_private_state(self):self.exercise()
 def test_interrupted_apply_suspends_future_automatic_transitions(self):self.exercise(interrupt=True)

if __name__=='__main__':unittest.main()
