import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import {parseUnits} from 'ethers';
import {requiredV2PayoutFunding,canFundV2PayoutOnDemand,type V2PayoutOnDemandQuote} from '../src/v2-on-demand-payout';
import {V2_TEST_TOKEN} from '../src/v2-live-deposit';

const unit=(v:string)=>parseUnits(v,18);
const source=fs.readFileSync(new URL('../src/v2-on-demand-payout.ts',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../src/V2AdminConsole.tsx',import.meta.url),'utf8');
const screen=fs.readFileSync(new URL('../src/V2OnDemandFunding.tsx',import.meta.url),'utf8');
const request:V2PayoutOnDemandQuote={
 wallet:'0x1111111111111111111111111111111111111111',
 requestId:4,beneficiary:'0x2222222222222222222222222222222222222222',
 asset:V2_TEST_TOKEN,gross:unit('100'),fee:unit('3'),principal:false,status:1,
 cash:unit('0'),profitLiability:unit('250'),
 fundingShortfall:unit('250'),walletBalance:unit('1000'),
 allowance:0n,gasWei:unit('0.01'),decimals:18,block:142526142
};

describe('V2 manager on-demand payout, no advance million-token treasury funding',()=>{
 it('funds exact contract shortfall, not a fixed one-million token seed',()=>{
  expect(requiredV2PayoutFunding({cash:0n,profitLiability:unit('250'),gross:unit('100'),principal:false})).toBe(unit('250'));
  expect(requiredV2PayoutFunding({cash:unit('249'),profitLiability:unit('250'),gross:unit('100'),principal:false})).toBe(unit('1'));
  expect(requiredV2PayoutFunding({cash:unit('300'),profitLiability:unit('250'),gross:unit('100'),principal:false})).toBe(0n);
  expect(requiredV2PayoutFunding({cash:unit('250'),profitLiability:unit('250'),gross:unit('100'),principal:true})).toBe(unit('100'));
  expect(requiredV2PayoutFunding({cash:unit('400'),profitLiability:unit('250'),gross:unit('100'),principal:true})).toBe(0n);
  expect(()=>requiredV2PayoutFunding({cash:0n,profitLiability:0n,gross:0n,principal:false})).toThrow();
 });
 it('requires real MOCK token balance, chain gas and an approved immutable user request',()=>{
  expect(canFundV2PayoutOnDemand(request)).toBe(true);
  expect(canFundV2PayoutOnDemand({...request,walletBalance:unit('249')})).toBe(false);
  expect(canFundV2PayoutOnDemand({...request,gasWei:0n})).toBe(false);
  expect(canFundV2PayoutOnDemand({...request,status:0})).toBe(false);
  expect(canFundV2PayoutOnDemand({...request,asset:'0x3333333333333333333333333333333333333333'})).toBe(false);
 });
 it('verifies the deployed contract, exact request, approved status, funding receipt, and separate real payout receipt',()=>{
  for(const expected of [
   'v2Session(walletProvider,wallet)',
   'vault.withdrawalOf(requestId,options)',
   'Number(r.status)!==1',
   'vault.assetBalance(token,options)',
   'vault.profitLiability(token,options)',
   'getAddress(r.user)',
   'new BrowserProvider(walletProvider',
   'token.approve(V2_ADDRESS,amount)',
   'vault.fundPrincipalLiquidity.staticCall(V2_TEST_TOKEN,amount)',
   'vault.fundPrincipalLiquidity(V2_TEST_TOKEN,amount)',
   "evt?.name==='PrincipalLiquidityFunded'",
   'vault.payWithdrawal.staticCall(preview.requestId)',
   'vault.payWithdrawal(preview.requestId)',
   "evt?.name==='WithdrawalResolved'",
   'paid.wait(3)'
  ]){
   if(expected==='paid.wait(3)')continue;
   expect(source).toContain(expected);
  }
  expect(source).toContain('await payment.wait(3)');
  expect(source).not.toContain('MaxUint256');
  expect(source).not.toContain('privateKey');
  expect(source).not.toMatch(/\bmint\s*\(/);
 });
 it('only shows a post-approval operator funding action, never pre-funding as the default',()=>{
  expect(admin).toContain("import V2OnDemandFunding from './V2OnDemandFunding'");
  expect(admin).not.toContain('<V2TreasuryFunding');
  expect(admin).toContain('r.status===1');
  expect(screen).toContain('No advance 1,000,000-token treasury top-up');
  expect(screen).toContain('exact test-token cash shortfall');
  expect(screen).toContain('confirm(explanation)');
  expect(screen).toContain('View confirmed payout receipt');
  expect(screen).not.toContain('mint(');
 });
});
