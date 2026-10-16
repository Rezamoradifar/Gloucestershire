import {describe,it,expect} from 'vitest';
import {hasDeferredRewards} from '../src/reward-mode';
import {profitAvailability} from '../src/account';
import {networkCall,rewardBlockers} from '../src/network';
describe('deferred rewards and withdrawal requests',()=>{
 const s={profit:105n,withdrawalLimit:100n,liquidBalance:0n,nextWithdrawal:0n,blockTime:10,fee:500n};
 it('allows unfunded requests only for the explicit new contract version',()=>{
  expect(profitAvailability(s).gross).toBe(0n);
  expect(profitAvailability({...s,deferredRewards:true}).gross).toBe(100n);
  expect(profitAvailability({...s,deferredRewards:true,pendingWithdrawal:true}).gross).toBe(0n);
  expect(profitAvailability({...s,deferredRewards:true,nextWithdrawal:11n}).gross).toBe(0n);
 });
 it('does not confuse RPC failure or unsupported version with legacy mode',async()=>{
  expect(await hasDeferredRewards({REWARD_ACCRUAL_VERSION:async()=>1n} as any)).toBe(true);
  expect(await hasDeferredRewards({REWARD_ACCRUAL_VERSION:async()=>{throw {code:'CALL_EXCEPTION'};}} as any)).toBe(false);
  await expect(hasDeferredRewards({REWARD_ACCRUAL_VERSION:async()=>2n} as any)).rejects.toThrow('Unsupported');
  await expect(hasDeferredRewards({REWARD_ACCRUAL_VERSION:async()=>{throw Error('RPC');}} as any)).rejects.toThrow('RPC');
 });
 it('ignores cash and budget only for accrual, while preserving stage volume and oracle guards',()=>{
  const p={paused:false,rewardBudget:0n,treasuryCash:0n,deferredRewards:true};
  const g={id:0n,stage:0,prepared:0n,eligibleUsd:500n,cursor:0n,branches:2n,claimAmount:35n,quoteError:''};
  expect(rewardBlockers(p,g,500n)).toEqual([]);
  expect(rewardBlockers({...p,deferredRewards:false},g,500n)).toHaveLength(2);
  expect(rewardBlockers(p,{...g,eligibleUsd:499n},500n)).toHaveLength(1);
  expect(rewardBlockers(p,{...g,claimAmount:null},500n)).toHaveLength(1);
 });
 it('binds a multi-stage claim to the reviewed stage and bounds the batch',()=>{
  expect(networkCall({kind:'claim',group:0n,stage:0,count:2})).toEqual({method:'claimNetworkRewards',args:[0n,0,2]});
  expect(()=>networkCall({kind:'claim',group:0n,stage:13,count:2})).toThrow();
 });
});
