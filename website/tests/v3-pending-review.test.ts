import {describe,expect,it} from 'vitest';
import {clearV3PendingReview,readV3PendingReview,v3ReviewKey,V3PersistentTransactionTracker,type V3ReviewScope} from '../src/v3-pending-review';

const scope:V3ReviewScope={chainId:97,contract:'0x'+'1'.repeat(40),wallet:'0x'+'2'.repeat(40)};
const tx='0x'+'a'.repeat(64);
function storage(){
 const entries=new Map<string,string>();
 return {entries,getItem:(key:string)=>entries.get(key)??null,setItem:(key:string,value:string)=>{entries.set(key,value);},removeItem:(key:string)=>{entries.delete(key);}};
}
describe('pending testnet transactions survive page reload',()=>{
 it('records uncertainty before the wallet replies, and preserves the hash across a reload',()=>{
  const disk=storage(),firstPage=new V3PersistentTransactionTracker(scope,disk);
  firstPage.record({step:'wallet_request',action:'test_deposit'});
  expect(readV3PendingReview(scope,disk)).not.toBeNull();
  firstPage.record({step:'verification',action:'test_deposit',hash:tx});
  expect(firstPage.needsReview('RPC stopped while checking the receipt.')).toBe(true);
  expect(readV3PendingReview(scope,disk)?.hash).toBe(tx);
  expect(disk.entries.get(v3ReviewKey(scope))).not.toContain('RPC stopped');
 });
 it('keeps a confirmed receipt pending until business event verification succeeds',()=>{
  const disk=storage(),tracker=new V3PersistentTransactionTracker(scope,disk);
  tracker.record({step:'confirmed',action:'test_deposit',hash:tx});
  expect(readV3PendingReview(scope,disk)?.hash).toBe(tx);
  expect(tracker.needsReview('Deposit event was not verified.')).toBe(true);
  tracker.complete();
  expect(readV3PendingReview(scope,disk)).toBeNull();
 });
 it('clears a definitely declined signature but leaves an unknown result blocked',()=>{
  const disk=storage(),tracker=new V3PersistentTransactionTracker(scope,disk);
  tracker.record({step:'wallet_request',action:'test_deposit'});
  expect(tracker.needsReview('TESTNET deposit was declined in your wallet.')).toBe(false);
  expect(readV3PendingReview(scope,disk)).toBeNull();
  const nextAttempt=new V3PersistentTransactionTracker(scope,disk);
  nextAttempt.record({step:'wallet_request',action:'test_deposit'});
  expect(nextAttempt.needsReview('Wallet connection closed.')).toBe(true);
  expect(readV3PendingReview(scope,disk)).not.toBeNull();
 });
 it('does not leave a stale deposit hash after the next approval/signature request',()=>{
  const disk=storage(),tracker=new V3PersistentTransactionTracker(scope,disk);
  tracker.record({step:'confirmed',action:'token_approval',hash:tx});
  tracker.record({step:'wallet_request',action:'test_deposit'});
  expect(readV3PendingReview(scope,disk)?.hash).toBeUndefined();
  expect(tracker.needsReview('Request outcome unknown.')).toBe(true);
 });
 it('separates wallets and contracts and survives account switches until explicit review',()=>{
  const disk=storage(),tracker=new V3PersistentTransactionTracker(scope,disk);
  tracker.record({step:'wallet_request',action:'withdrawal_request'});
  expect(readV3PendingReview({...scope,wallet:'0x'+'3'.repeat(40)},disk)).toBeNull();
  expect(readV3PendingReview({...scope,contract:'0x'+'4'.repeat(40)},disk)).toBeNull();
  expect(readV3PendingReview({...scope,wallet:scope.wallet.toUpperCase().replace('0X','0x')},disk)).not.toBeNull();
  clearV3PendingReview(scope,disk);
  expect(readV3PendingReview(scope,disk)).toBeNull();
 });
 it('does not let a late earlier result erase another pending operation',()=>{
  const disk=storage(),earlier=new V3PersistentTransactionTracker(scope,disk),later=new V3PersistentTransactionTracker(scope,disk);
  earlier.record({step:'wallet_request',action:'check_in'});
  later.record({step:'wallet_request',action:'withdrawal_request'});
  const latest=readV3PendingReview(scope,disk);
  earlier.record({step:'confirmed',action:'check_in',hash:tx});
  expect(earlier.needsReview('Check-in record did not match.')).toBe(true);
  expect(readV3PendingReview(scope,disk)).toEqual(latest);
  earlier.complete();
  expect(readV3PendingReview(scope,disk)).toEqual(latest);
 });
 it('treats malformed stored status as requiring review without trusting a hash',()=>{
  const disk=storage();disk.setItem(v3ReviewKey(scope),'{bad json');
  expect(readV3PendingReview(scope,disk)).toEqual({id:'unreadable'});
  clearV3PendingReview(scope,disk);expect(readV3PendingReview(scope,disk)).toBeNull();
 });
 it('does not create a reminder for a preflight error and keeps an in-page fallback if storage throws',()=>{
  const disk=storage(),tracker=new V3PersistentTransactionTracker(scope,disk);
  tracker.record({step:'preflight',action:'test_deposit'});
  expect(tracker.needsReview('Wrong network.')).toBe(false);
  expect(readV3PendingReview(scope,disk)).toBeNull();
  const unavailable={getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');},removeItem:()=>{throw Error('blocked');}};
  const guarded=new V3PersistentTransactionTracker(scope,unavailable);
  guarded.record({step:'wallet_request',action:'reinvestment'});
  expect(readV3PendingReview(scope,unavailable)).not.toBeNull();
  guarded.complete();expect(readV3PendingReview(scope,unavailable)).toBeNull();
 });
 it('keeps the in-page reminder if only writes fail because storage is full',()=>{
  const disk={...storage(),setItem:()=>{throw Error('quota');}};
  const tracker=new V3PersistentTransactionTracker(scope,disk);
  tracker.record({step:'wallet_request',action:'test_deposit'});
  expect(disk.getItem(v3ReviewKey(scope))).toBeNull();
  expect(readV3PendingReview(scope,disk)).not.toBeNull();
  tracker.complete();expect(readV3PendingReview(scope,disk)).toBeNull();
 });
 it('honors a successful cross-tab removal instead of restoring a cached mirror',()=>{
  const disk=storage(),tracker=new V3PersistentTransactionTracker(scope,disk);
  tracker.record({step:'wallet_request',action:'test_deposit'});
  disk.removeItem(v3ReviewKey(scope));
  expect(readV3PendingReview(scope,disk)).toBeNull();
 });
 it('does not let an older volatile marker erase a newer marker saved by another tab',()=>{
  const disk=storage();let full=true;
  const limited={...disk,setItem:(key:string,value:string)=>{if(full)throw Error('quota');disk.setItem(key,value);}};
  const earlier=new V3PersistentTransactionTracker(scope,limited);
  earlier.record({step:'wallet_request',action:'test_deposit'});
  disk.setItem(v3ReviewKey(scope),JSON.stringify({version:1,id:'newer-from-other-tab',hash:tx}));
  full=false;
  earlier.record({step:'confirmed',action:'test_deposit',hash:'0x'+'b'.repeat(64)});
  earlier.complete();
  expect(readV3PendingReview(scope,limited)).toEqual({id:'newer-from-other-tab',hash:tx});
 });
});
