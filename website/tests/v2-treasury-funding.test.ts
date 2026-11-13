import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import {parseUnits} from 'ethers';
import {V2_TREASURY_TEST_AMOUNT,v2TreasuryHasTestFunds,type V2TreasuryFundingQuote} from '../src/v2-treasury-funding';
import {V2_TEST_TOKEN} from '../src/v2-live-deposit';

const amount=parseUnits('1000000',18);
const data:V2TreasuryFundingQuote={
 wallet:'0x1111111111111111111111111111111111111111',
 token:V2_TEST_TOKEN,decimals:18,amount,
 walletBalance:amount,allowance:0n,vaultCash:0n,
 principalLiability:parseUnits('100',18),profitLiability:0n,block:142526142
};
const source=fs.readFileSync(new URL('../src/v2-treasury-funding.ts',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../src/V2AdminConsole.tsx',import.meta.url),'utf8');
const screen=fs.readFileSync(new URL('../src/V2TreasuryFunding.tsx',import.meta.url),'utf8');

describe('Explicit 1,000,000 MOCK USDT testnet treasury funding',()=>{
 it('pins exact test-token quantity, identity and 18 decimals',()=>{
  expect(V2_TREASURY_TEST_AMOUNT).toBe('1000000');
  expect(v2TreasuryHasTestFunds(data)).toBe(true);
  expect(v2TreasuryHasTestFunds({...data,walletBalance:amount-1n})).toBe(false);
  expect(v2TreasuryHasTestFunds({...data,token:'0x2222222222222222222222222222222222222222'})).toBe(false);
  expect(v2TreasuryHasTestFunds({...data,amount:amount-1n})).toBe(false);
  expect(v2TreasuryHasTestFunds({...data,decimals:6})).toBe(false);
 });
 it('checks live V2 code, chain 97, token address, wallet cash and allowance',()=>{
  expect(source).toContain('v2Session(walletProvider,wallet)');
  expect(source).toContain('V2_TEST_TOKEN');
  expect(source).toContain('vault.assetBalance(token,options)');
  expect(source).toContain('testToken.balanceOf(wallet,options)');
  expect(source).toContain('testToken.allowance(wallet,V2_ADDRESS,options)');
  expect(source).toContain('parseUnits(V2_TREASURY_TEST_AMOUNT,decimals)');
  expect(source).not.toContain('TRADES_VAULT_ADDRESS');
 });
 it('uses user-signed exact allowance, separate funding transaction and verified receipt',()=>{
  expect(source).toContain('new BrowserProvider(walletProvider');
  expect(source).toContain('await token.approve(V2_ADDRESS,fresh.amount)');
  expect(source).toContain('await vault.fundPrincipalLiquidity.staticCall');
  expect(source).toContain('await vault.fundPrincipalLiquidity(V2_TEST_TOKEN,fresh.amount)');
  expect(source).toContain('await tx.wait(3)');
  expect(source).toContain("parsed?.name==='PrincipalLiquidityFunded'");
  expect(source).not.toMatch(/\bmint\s*\(/);
  expect(source).not.toContain('MaxUint256');
  expect(source).not.toContain('privateKey');
 });
 it('does not pretend this is real USDT, an earnings payment or an instant database credit',()=>{
  expect(screen).toContain('not 1,000,000 real Tether');
  expect(screen).toContain('does not create real USDT or guarantee user withdrawals');
  expect(screen).toContain('wallet will ask you to confirm approval');
  expect(screen).toContain('1,000,000 TEST USDT');
  expect(screen).toContain('v2TreasuryHasTestFunds(quote)');
  expect(screen).toContain('getWalletProvider()');
  expect(screen).toContain('View confirmed TESTNET funding receipt');
 });
 it('keeps treasury funding accessible only inside V2 admin console',()=>{
  expect(admin).toContain("import V2TreasuryFunding from './V2TreasuryFunding'");
  expect(admin).toContain('<V2TreasuryFunding wallet={wallet} onChanged={onChanged}/>');
  const dashboard=fs.readFileSync(new URL('../src/V2Dashboard.tsx',import.meta.url),'utf8');
  expect(dashboard).toContain("section==='admin'&&canManage&&<V2AdminConsole");
 });
});
