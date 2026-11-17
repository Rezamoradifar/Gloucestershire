import {describe,expect,it} from 'vitest';
import {V3TransactionProgressTracker,v3TransactionProgressText} from '../src/v3-transaction-progress';

describe('V3 transaction progress',()=>{
 it('describes a wallet request without asserting a prompt appeared',()=>{
  const text=v3TransactionProgressText({action:'registration',step:'wallet_request'});
  expect(text).toContain('Sending a request to the wallet');
  expect(text).not.toContain('approved');
 });
 it('does not require wallet history for errors before sending',()=>{
  const tracker=new V3TransactionProgressTracker();
  tracker.record({action:'registration',step:'preflight'});
  tracker.record({action:'registration',step:'simulation'});
  expect(tracker.needsReview('RPC failed')).toBe(false);
 });
 it('requires review when a wallet request could have been sent',()=>{
  const tracker=new V3TransactionProgressTracker();
  tracker.record({action:'token_approval',step:'wallet_request'});
  expect(tracker.needsReview('Request outcome unknown.')).toBe(true);
  tracker.record({action:'token_approval',step:'verification',hash:'0x'+'a'.repeat(64)});
  expect(tracker.needsReview('Check its receipt before retrying.')).toBe(true);
 });
 it('does not classify a clearly declined wallet request as broadcast',()=>{
  const tracker=new V3TransactionProgressTracker();
  tracker.record({action:'registration',step:'wallet_request'});
  expect(tracker.needsReview('Registration was declined in your wallet.')).toBe(false);
 });
 it('clears uncertainty only after confirmation, and retains review if the deposit event is invalid',()=>{
  const tracker=new V3TransactionProgressTracker();
  tracker.record({action:'token_approval',step:'wallet_request'});
  tracker.record({action:'token_approval',step:'confirmed',hash:'0x'+'a'.repeat(64)});
  expect(tracker.needsReview('Simulation failed.')).toBe(false);
  tracker.record({action:'test_deposit',step:'confirmed',hash:'0x'+'b'.repeat(64)});
  expect(tracker.needsReview('Deposit event was not verified.')).toBe(true);
  tracker.record({action:'reinvestment',step:'confirmed',hash:'0x'+'c'.repeat(64)});
  expect(tracker.needsReview('Reinvestment events did not match.')).toBe(true);
  tracker.record({action:'withdrawal_request',step:'confirmed',hash:'0x'+'d'.repeat(64)});
  expect(tracker.needsReview('Withdrawal record did not match.')).toBe(true);
 });
});
