import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import {v3ParseReleaseConfig,V3_OLD_V2_ADDRESS} from '../src/v3-site-config';
import {siteRoute} from '../src/site-route';

const confirmed={
 address:'0x1234567890123456789012345678901234567890',
 runtimeHash:'0x'+'a'.repeat(64),deploymentTx:'0x'+'b'.repeat(64)
};
const file=(path:string)=>fs.readFileSync(new URL('../src/'+path,import.meta.url),'utf8');
describe('Global V3 testnet site: no unverified balances or automatic V2 migration',()=>{
 it('requires a real pinned NEW address plus exact runtime hash and deployment tx',()=>{
  expect(v3ParseReleaseConfig({})).toBe(null);
  expect(v3ParseReleaseConfig({...confirmed,address:V3_OLD_V2_ADDRESS})).toBe(null);
  expect(v3ParseReleaseConfig({...confirmed,runtimeHash:'0x123'})).toBe(null);
  expect(v3ParseReleaseConfig({...confirmed,deploymentTx:'0x000'})).toBe(null);
  expect(v3ParseReleaseConfig(confirmed)?.address).toBe(confirmed.address);
 });
 it('retires the V2 entry point in a verified V3 release',()=>{
  const root=file('Root.tsx');
  expect(root).toContain("const DashboardV2=!v3Only?lazy(()=>import('./V2Dashboard')):null");
  expect(root).toContain("const DashboardV3=lazy(()=>import('./V3Dashboard'))");
  expect(root).toContain("VITE_V3_PRIMARY_DASHBOARD==='verified-testnet'");
  const opts={v3Only:true,hourlyTest:false,landingAtRoot:true};
  expect(siteRoute('#v2-dashboard',opts)).toBe('v3');
  expect(siteRoute('#v3-dashboard',opts)).toBe('v3');
  expect(siteRoute('#dashboard',opts)).toBe('v3');
  expect(file('V3Dashboard.tsx')).not.toContain('href="#v2-dashboard"');
 });
 it('preserves the main landing and keeps the isolated hourly page on the dashboard',()=>{
  const main={v3Only:true,hourlyTest:true,landingAtRoot:true};
  const hourly={...main,landingAtRoot:false};
  expect(siteRoute('',main)).toBe('landing');
  expect(siteRoute('#',main)).toBe('landing');
  expect(siteRoute('#dashboard',main)).toBe('v3');
  expect(siteRoute('',hourly)).toBe('v3');
  expect(siteRoute('#',hourly)).toBe('v3');
  expect(siteRoute('#marketplace',hourly)).toBe('landing');
 });
 it('V3 money reads require verified bytecode and do not import old V2 contract state',()=>{
  const code=file('v3-chain.ts');
  for(const required of [
   'v3ParseReleaseConfig','v3ReadSession(walletProvider,wallet,config,Boolean(config?.unified),startReader,deadlineAt)',
   'readVerifiedV3Snapshot(session,wallet,config!',
   'const selection=readWalletSelection(walletProvider)',
   'Number(BigInt(String(chain)))!==V3_TESTNET_CHAIN_ID',
   "provider.getCode(config.address,'latest')",
   'provider.getTransactionReceipt(config.deploymentTx)',
   'V3_EXPECTED_MANAGER',
   'V3_EXPECTED_FEE_RECEIVER',
   "keccak256(code).toLowerCase()!==config.runtimeHash",
   'getAddress(asset)!==V3_TEST_TOKEN',
   'vault.users(wallet,options)',
   'vault.positionCount(wallet,options)',
   'vault.claimableDaily(wallet,id,options)',
   'vault.claimableCompound(wallet,id,options)',
   'vault.cashStatus(options)',
   'vault.profitWithdrawalCap(wallet,options)'
  ])expect(code).toContain(required);
  const walletReads=file('wallet-read.ts');
  expect(walletReads).toContain("readWalletValue(provider,'eth_accounts')");
  expect(walletReads).toContain("readWalletValue(provider,'eth_chainId')");
  expect(code).not.toContain('/api/config');
  expect(code).not.toContain('TRADES_VAULT_ADDRESS');
  expect(code).not.toContain('0x4C0F6141b18971db4b14e45c0bE8CddB09febc14');
 });
 it('uses reviewed Global theme/mobile nav while showing testnet USDT claims separately from funded payouts',()=>{
  const dashboard=file('V3Dashboard.tsx');
  expect(dashboard).toContain("import './v2-signature-dashboard.css'");
  expect(dashboard).toContain('gv2-mobile-bottom');
  expect(dashboard).toMatch(/<V3ClaimsReadout[^>]+verifiedLedger=\{view\.ledger\}/);
  expect(dashboard).toContain('Test tokens only. No monetary value.');
  expect(dashboard).toContain('This test deposit locks principal for 90 days.');
  expect(dashboard).toContain("tab==='profile'&&<V3SeparateTestAccounts");
  expect(file('V3AccountWithdrawalForm.tsx')).toContain('Requests need manager approval and actual test-token funding before payment.');
  expect(dashboard).toContain('10% to each original fee wallet');
  expect(dashboard).toContain('Unfunded total obligations');
  expect(dashboard).not.toContain('DEMO_BALANCE');
  expect(dashboard).not.toContain('localStorage.setItem');
 });
 it('V3 profit-on-profit does not require manager sign-off and payments always do',()=>{
  const actions=file('v3-actions.ts');
  expect(actions).toContain("'checkInAndAccrue'");
  expect(actions).toContain("'approveWithdrawal'");
  expect(actions).toContain('Only the authorized V3 manager');
  expect(actions).toContain('sendV3FundWithdrawal');
  expect(actions).toContain('WithdrawalPaid');
  expect(actions).toContain('getAddress(row.beneficiary)');
  expect(actions).toContain('approve(config.address,amount)');
  expect(actions).toContain('v3ReadSession(walletProvider,wallet,config)');
  expect(actions).not.toMatch(/\bmint\(/);
 });
});
