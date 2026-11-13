import {describe,it,expect} from 'vitest';
import {parseEther} from 'ethers';
import {v3PrepareUserClaims,type V3ClaimLedger} from '../src/v3-claim-balance';

const to=(n:string)=>parseEther(n);
const ledger:V3ClaimLedger={
 chainId:97,runtimeVerified:true,block:142610000,
 asOf:1794600000,nextRequestAt:0,registered:true,suspended:false,
 pendingWithdrawal:false,requestCap:to('100'),
 referralAvailable:to('1.2'),principalLiability:to('1000'),
 profitLiability:to('15.249'),cash:to('1000'),escrow:0n,
 positions:[{id:0,principal:to('1000'),availableProfit:to('14.049'),
  availableDaily:to('14'),availableCompound:to('0.049'),
  cumulativeDaily:to('14'),cumulativeCompound:to('0.049'),reservedProfit:0n}]
};
describe('V3 actual accrued claim presentation, awaiting secure deployment',()=>{
 it('separates claimable daily, compound, referral and overall unfunded cash',()=>{
  const view=v3PrepareUserClaims(ledger);
  expect(view.outstandingDaily).toBe(to('14'));
  expect(view.outstandingCompound).toBe(to('0.049'));
  expect(view.outstandingPersonal).toBe(to('14.049'));
  expect(view.outstandingReferral).toBe(to('1.2'));
  expect(view.overallUnfundedLiability).toBe(to('15.249'));
  expect(view.maxSingleRequest).toBe(to('14.049'));
  expect(view.managerCashPayoutConfirmed).toBe(false);
 });
 it('blocks requests during pending or 72-hour cooldown, while displaying exact recorded claims',()=>{
  expect(v3PrepareUserClaims({...ledger,pendingWithdrawal:true}).maxSingleRequest).toBe(0n);
  expect(v3PrepareUserClaims({...ledger,nextRequestAt:ledger.asOf+1}).maxSingleRequest).toBe(0n);
  expect(v3PrepareUserClaims({...ledger,suspended:true}).maxSingleRequest).toBe(0n);
  expect(v3PrepareUserClaims({...ledger,requestCap:to('5')}).maxSingleRequest).toBe(to('5'));
 });
 it('refuses unverified or inconsistent on-chain data rather than fabricating payable balances',()=>{
  expect(()=>v3PrepareUserClaims({...ledger,chainId:56})).toThrow();
  expect(()=>v3PrepareUserClaims({...ledger,runtimeVerified:false})).toThrow();
  expect(()=>v3PrepareUserClaims({...ledger,cash:0n,escrow:1n})).toThrow();
  expect(()=>v3PrepareUserClaims({...ledger,positions:[
   {...ledger.positions[0],availableCompound:to('2')}
  ]})).toThrow();
  expect(()=>v3PrepareUserClaims({...ledger,positions:[ledger.positions[0],ledger.positions[0]]})).toThrow();
 });
});
