import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('smart',Path(__file__).resolve().parents[1]/'scripts/smart-worker.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class SmartTests(unittest.TestCase):
 def test_missing_report_does_not_prevent_first_reconciliation(self):
  with patch.object(m,'read_json',side_effect=FileNotFoundError):
   self.assertEqual(m.load_worker_state('status'),{})
 def test_missing_journal_is_never_replaced_by_empty_state(self):
  with patch.object(m,'read_json',side_effect=FileNotFoundError):
   with self.assertRaises(FileNotFoundError):m.load_worker_state('journal')
 def test_corrupt_or_unsafe_report_is_not_treated_as_a_missing_report(self):
  with patch.object(m,'read_json',side_effect=ValueError('unsafe')):
   with self.assertRaises(ValueError):m.load_worker_state('status')
 def harness(self,busy=False,fail=False,advance=True,fresh=True,previous=None):
  calls=[];state={'daily':{'registry':{'through':120},'positionIndex':{'through':100},'positionScanTarget':{'number':200},'positionPaid':{},'positionQuarterPaid':{}}};status={'status':'scheduled','checkedAt':'old','dailyCredits':[{'status':'credited','transactionHash':'0x'+'ab'*32}]}
  def control(action,unit):
   calls.append((action,unit))
   if action=='active':return 'activating' if busy else 'inactive'
   if unit==m.INDEX and advance:state['daily']['positionIndex']['through']+=20
   if unit==m.PAYMENT and fresh:status['checkedAt']='new'
   return 1 if fail and unit==m.INDEX else 0
  result=m.run_cycle(control,lambda k:state if k=='journal' else dict(status),previous,clock=lambda:100)
  return result,calls
 def test_index_then_payment_and_fresh_receipts(self):
  r,c=self.harness();self.assertEqual([u for a,u in c if a=='start'],[m.INDEX,m.PAYMENT]);self.assertEqual(r['after']['positionThrough'],120);self.assertEqual(r['newCreditTransactionHashes'],['0x'+'ab'*32]);self.assertEqual(r['status'],'running')
 def test_busy_financial_service_is_never_killed_or_started_twice(self):
  r,c=self.harness(busy=True);self.assertEqual(r['blockers'],['EXISTING_SERVICE_RUNNING']);self.assertFalse(any(a=='start' for a,u in c))
 def test_failed_index_still_allows_pending_reconciliation_and_approved_withdrawals(self):
  r,c=self.harness(fail=True);self.assertIn(('start',m.PAYMENT),c);self.assertIn('SERVICE_REPORTED_FAILURE',r['blockers'])
 def test_three_unchanged_backlog_cycles_report_stall(self):
  r,_=self.harness(advance=False);r,_=self.harness(advance=False,previous=r);r,_=self.harness(advance=False,previous=r);self.assertEqual(r['stalledCycles'],3);self.assertIn('INDEX_PROGRESS_STALLED',r['blockers'])
 def test_stale_payment_status_cannot_be_reported_as_new_credit(self):
  r,_=self.harness(fresh=False);self.assertEqual(r['newCreditTransactionHashes'],[]);self.assertIn('PAYMENT_STATUS_NOT_REFRESHED',r['blockers'])
 def test_new_progress_clears_stall(self):
  r,_=self.harness(advance=False);r['stalledCycles']=9;r,_=self.harness(previous=r);self.assertEqual(r['stalledCycles'],0)
if __name__=='__main__':unittest.main()
