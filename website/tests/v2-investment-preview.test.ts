import {describe,it,expect} from 'vitest';
import {parseEther,parseUnits} from 'ethers';
import {previewV2Investment,tierFromRecordedUsd,V2_PLAN_NAMES,V2_REFERRAL_BPS} from '../src/v2-investment-preview';

describe('Global V2 user-friendly investment simulation matches deployed rate and routing math',()=>{
 it('shows exact gross 1000 mock USDT principal, 10/10/80 routing and funded referral caps',()=>{
  const q=previewV2Investment({asset:'USDT',amount:'1000',decimals:18,assumedPriceUsd:'1'});
  expect(q.mode).toBe('SIMULATION_ONLY_NO_CHAIN_WRITES');
  expect(q.recordedPrincipal).toBe(parseEther('1000'));
  expect(q.usdValue).toBe(parseEther('1000'));
  expect(q.plan).toBe('Basic');
  expect(q.dailyCapBps).toBe(70n);
  expect(q.hypotheticalDailyCap).toBe(parseEther('7'));
  expect(q.feeWallet1).toBe(parseEther('100'));
  expect(q.feeWallet2).toBe(parseEther('100'));
  expect(q.operations).toBe(parseEther('800'));
  expect(q.liquidPrincipalInVaultFromThisDeposit).toBe(0n);
  expect(q.estimatedGrossPrincipalShortfall).toBe(parseEther('1000'));
  expect(q.referralLevels.map(x=>x.maximumForEligibleUpline)).toEqual([
   parseEther('0.7'),parseEther('0.35'),parseEther('0.21'),0n
  ]);
  expect(q.liveTransferPerformed).toBe(false);
  expect(q.realUsdtCredited).toBe(false);
  expect(q.noGuaranteedProfit).toBe(true);
 });
 it('respects exact strict on-chain tier thresholds instead of rounding to the next tier',()=>{
  expect(tierFromRecordedUsd(parseEther('500'))).toBe(0);
  expect(tierFromRecordedUsd(parseEther('500.000000000000000001'))).toBe(1);
  expect(tierFromRecordedUsd(parseEther('2500'))).toBe(1);
  expect(tierFromRecordedUsd(parseEther('2500.000000000000000001'))).toBe(2);
  expect(tierFromRecordedUsd(parseEther('10000'))).toBe(2);
  expect(tierFromRecordedUsd(parseEther('10000.000000000000000001'))).toBe(3);
  expect(tierFromRecordedUsd(parseEther('50000'))).toBe(3);
  expect(tierFromRecordedUsd(parseEther('50000.000000000000000001'))).toBe(4);
  expect(V2_PLAN_NAMES).toHaveLength(5);
  expect(V2_REFERRAL_BPS[4]).toEqual([1600n,800n,600n,400n]);
 });
 it('previews VIP >50000 requiring separate manager KYC without pretending the KYC was granted',()=>{
  const q=previewV2Investment({asset:'USDT',amount:'50001',decimals:18,assumedPriceUsd:'1'});
  expect(q.plan).toBe('VIP');
  expect(q.requiresAdminVipKyc).toBe(true);
  expect(q.referralLevels[3].bps).toBe(400n);
  const k=previewV2Investment({asset:'USDT',amount:'50001',decimals:18,assumedPriceUsd:'1',kycVerified:true});
  expect(k.requiresAdminVipKyc).toBe(false);
 });
 it('supports token with 6 decimals and illustrative BNB decimal conversion without live price claims',()=>{
  const token=previewV2Investment({asset:'USDT',amount:'1000.5',decimals:6,assumedPriceUsd:'1'});
  expect(token.recordedPrincipal).toBe(parseUnits('1000.5',6));
  expect(token.feeWallet1).toBe(parseUnits('100.05',6));
  const bnb=previewV2Investment({asset:'BNB',amount:'0.1',decimals:18,assumedPriceUsd:'100'});
  expect(bnb.usdValue).toBe(parseEther('10'));
  expect(bnb.tier).toBe(0);
  expect(bnb.feeWallet1).toBe(parseEther('0.01'));
  expect(bnb.feeWallet2).toBe(parseEther('0.01'));
  expect(bnb.operations).toBe(parseEther('0.08'));
 });
 it('rejects unsafe or malformed numbers and sub-minimum deposits, without signatures',()=>{
  for(const amount of ['0','9','-1','100,00','1e9','0.5'] ){
   expect(()=>previewV2Investment({asset:'USDT',amount,decimals:18,assumedPriceUsd:'1'})).toThrow();
  }
  expect(()=>previewV2Investment({asset:'BNB',amount:'1',decimals:18,assumedPriceUsd:'0'})).toThrow();
  expect(()=>previewV2Investment({asset:'USDT',amount:'10.1234567',decimals:6,assumedPriceUsd:'1'})).toThrow();
 });
});
