import {describe,it,expect} from 'vitest';
import {parseEther,ZeroAddress} from 'ethers';
import {summarizeV2UserProfit} from '../src/v2-user-profit-summary';
import {V2_TEST_TOKEN} from '../src/v2-live-deposit';
import type {V2Snapshot,V2Account} from '../src/v2-chain';

const usdt:V2Account={
 symbol:'USDT',address:V2_TEST_TOKEN,decimals:18,
 principal:parseEther('1000'),profit:parseEther('50'),
 deposited:parseEther('800'),reinvested:parseEther('200'),
 nextRequestAt:0,requestPending:false,cap:parseEther('100'),
 contractPrincipal:parseEther('1000'),contractProfit:parseEther('50'),
 cash:parseEther('0'),unfunded:parseEther('1000')
};
const snapshot:V2Snapshot={
 wallet:'0x1111111111111111111111111111111111111111',
 block:142500000,blockHash:'0x'+'a'.repeat(64),asOf:1794600000,
 registered:true,referrer:ZeroAddress,kyc:false,suspended:false,eligible:true,
 lastCheckIn:1794599000,capitalUsd:parseEther('1000'),
 memberCount:1,positionsTotal:1,withdrawalsTotal:0,
 positions:[],withdrawals:[],token:V2_TEST_TOKEN,accounts:[usdt],
 feeBps:300,cooldownSeconds:259200,canApprove:false,canKyc:false
};

describe('V2 transparent daily / profit-on-reinvestments breakdown',()=>{
 it('uses exact deployed rate math and never double counts the compounding portion',()=>{
  const s=summarizeV2UserProfit(snapshot,usdt);
  expect(s.dailyBps).toBe(70n);
  expect(s.directDailyProjection).toBe(parseEther('5.6'));
  expect(s.reinvestmentDailyProjection).toBe(parseEther('1.4'));
  expect(s.dailyProjection).toBe(parseEther('7'));
  expect(s.dailyProjection).toBe(s.directDailyProjection+s.reinvestmentDailyProjection);
  expect(s.mode).toBe('READ_ONLY_CONDITIONAL_ESTIMATE_NOT_CREDIT');
 });
 it('profits shown as requestable come only from contract credited profit, never the daily projection',()=>{
  const s=summarizeV2UserProfit(snapshot,usdt);
  expect(s.creditedProfit).toBe(parseEther('50'));
  expect(s.contractRequestableNow).toBe(parseEther('50'));
  expect(s.dailyProjection).toBe(parseEther('7'));
  expect(s.contractRequestableNow).not.toBe(s.dailyProjection+s.creditedProfit);
  expect(summarizeV2UserProfit(snapshot,{...usdt,profit:0n}).contractRequestableNow).toBe(0n);
  expect(summarizeV2UserProfit(snapshot,{...usdt,profit:parseEther('300')}).contractRequestableNow).toBe(parseEther('100'));
 });
 it('does not create a claim while a prior withdrawal is pending or cooldown not elapsed',()=>{
  expect(summarizeV2UserProfit(snapshot,{...usdt,requestPending:true}).contractRequestableNow).toBe(0n);
  expect(summarizeV2UserProfit(snapshot,{...usdt,nextRequestAt:snapshot.asOf+5}).contractRequestableNow).toBe(0n);
  expect(summarizeV2UserProfit({...snapshot,registered:false},usdt).contractRequestableNow).toBe(0n);
 });
 it('never overcounts cumulative reinvestment records after partial redemptions',()=>{
  const s=summarizeV2UserProfit(snapshot,{...usdt,principal:parseEther('10'),reinvested:parseEther('5000')});
  expect(s.reinvestmentDailyProjection).toBe(parseEther('0.07'));
  expect(s.directDailyProjection).toBe(0n);
 });
 it('preserves an explicitly conditional yield ceiling for ineligible users, not a fake credit',()=>{
  const s=summarizeV2UserProfit({...snapshot,eligible:false},usdt);
  expect(s.eligibleNow).toBe(false);
  expect(s.dailyProjection).toBe(parseEther('7'));
  expect(s.creditedProfit).toBe(parseEther('50'));
 });
});
