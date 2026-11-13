import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import {v3ParseReleaseConfig,V3_OLD_V2_ADDRESS} from '../src/v3-site-config';

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
 it('always keeps original V2 dashboard available, and gates new primary V3 route',()=>{
  const root=file('Root.tsx');
  expect(root).toContain("const DashboardV2=lazy(()=>import('./V2Dashboard'))");
  expect(root).toContain("const DashboardV3=lazy(()=>import('./V3Dashboard'))");
  expect(root).toContain("location.hash==='#v2-dashboard'");
  expect(root).toContain("location.hash==='#v3-dashboard'");
  expect(root).toContain("VITE_V3_PRIMARY_DASHBOARD==='verified-testnet'");
  expect(root).toContain("if(location.hash==='#dashboard')return v3Primary?'v3':'v2'");
 });
 it('V3 money reads require verified bytecode and do not import old V2 contract state',()=>{
  const code=file('v3-chain.ts');
  for(const required of [
   'v3ParseReleaseConfig','v3ReadSession(walletProvider,wallet,config)',
   "provider.getCode(config.address,'latest')",
   "keccak256(code).toLowerCase()!==config.runtimeHash",
   'getAddress(asset)!==V3_TEST_TOKEN',
   'vault.users(wallet,options)',
   'vault.positionCount(wallet,options)',
   'vault.claimableDaily(wallet,id,options)',
   'vault.claimableCompound(wallet,id,options)',
   'vault.cashStatus(options)',
   'vault.profitWithdrawalCap(wallet,options)'
  ])expect(code).toContain(required);
  expect(code).not.toContain('/api/config');
  expect(code).not.toContain('TRADES_VAULT_ADDRESS');
  expect(code).not.toContain('0x4C0F6141b18971db4b14e45c0bE8CddB09febc14');
 });
 it('uses reviewed Global theme/mobile nav while showing TEST claims separately from funded payouts',()=>{
  const dashboard=file('V3Dashboard.tsx');
  expect(dashboard).toContain("import './v2-signature-dashboard.css'");
  expect(dashboard).toContain('gv2-mobile-bottom');
  expect(dashboard).toContain('<V3ClaimsReadout verifiedLedger={view.ledger}/>');
  expect(dashboard).toContain('manager-approved');
  expect(dashboard).toContain('NO 10/10/80 routing');
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
