import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';

const root=process.cwd();
const read=(name:string)=>fs.readFileSync(path.join(root,name),'utf8');

describe('Global V2 public-site isolation',()=>{
 it('renders V2 dashboard without importing the old contract bootstrap or App',()=>{
  const source=read('src/Root.tsx');
  expect(source).toMatch(/import\('\.\/V2Dashboard'\)/);
  expect(source).not.toMatch(/import\('\.\/App'\)/);
  expect(source).not.toMatch(/<ContractConnection>/);
  expect(source).not.toMatch(/loadRuntimeConfig\(/);
 });
 it('pins the exact operator-confirmed V2 testnet address and runtime hash',()=>{
  const source=read('src/v2-chain.ts');
  expect(source).toContain('0xA98D8d3709f5D3730BAD5d76C334731784e7CF07');
  expect(source).toContain('0x3e1f99305bf7edbb12d4d9870124f84ece95bb23b6bf890470e94d06a336bf99');
  expect(source).toContain('V2_CHAIN_ID=97');
  expect(source).toContain('keccak256(code).toLowerCase()!==V2_CODE_HASH');
  expect(source).not.toMatch(/['"]\/api\/config/);
 });
 it('shows V2-only landing disclosure without reading old settlement feeds',()=>{
  const source=read('src/LiveTrades.tsx');
  expect(source).toContain('V2_ADDRESS');
  expect(source).not.toContain('/api/trades');
  expect(source).not.toContain('loadRuntimeConfig');
  const terms=read('src/LegalStatus.tsx');
  expect(terms).toContain('fee is 3%');
  expect(terms).not.toContain('fee is 5%');
 });
 it('keeps deposits hidden while showing V2 withdrawal and backing conditions',()=>{
  const source=read('src/V2Dashboard.tsx');
  expect(source).toContain('Deposits are disabled');
  expect(source).toContain('System-wide principal without vault cash');
  const admin=read('src/V2AdminConsole.tsx');
  const actions=read('src/v2-admin.ts');
  expect(admin).toContain('V2 manager control center');
  expect(admin).toContain('Manual VIP/KYC decision');
  expect(actions).toContain('Withdrawal conditions not satisfied');
  expect(actions).toContain('approveWithdrawal');
  expect(actions).toContain('setVipKyc');
  expect(source).toContain('requestPrincipal');
  expect(source).toContain('reinvest');
  const chain=read('src/v2-chain.ts');
  expect(chain).not.toMatch(/case 'deposit'/);
 });
 it('shows compact V2 identity without suppressing material safety warnings',()=>{
  const dashboard=read('src/V2Dashboard.tsx');
  expect(dashboard).toContain('gv2-release');
  expect(dashboard).toContain('Global V2 · New testnet contract');
  expect(dashboard).not.toContain('gv2-warning');
  expect(dashboard).toContain('gv2-safety-disclosure');
  expect(dashboard).toContain('not approved for real investments');
  expect(dashboard).toContain('10% + 10%');
  expect(dashboard).toContain('Deposits are disabled');
  expect(dashboard).toContain("Existing users' previous balances");
  const css=read('src/v2-dashboard.css');
  expect(css).toContain('.gv2-release');
  expect(css).toContain('.gv2-safety-disclosure');
 });
 it('restores the classic Global sidebar, breadcrumb and mobile navigation with V2-only account data',()=>{
  const dashboard=read('src/V2Dashboard.tsx');
  const css=read('src/v2-classic-shell.css');
  expect(dashboard).toContain('gv2 shell gv2-classic');
  expect(dashboard).toContain('sidebar gv2-sidebar');
  expect(dashboard).toContain('workspace gv2-workspace');
  expect(dashboard).toContain('topbar gv2-classic-topbar');
  expect(dashboard).toContain('sidebar-caption');
  expect(dashboard).toContain('navItems.filter');
  expect(dashboard).toContain('mobile-menu');
  expect(dashboard).not.toContain("from './chain'");
  expect(dashboard).not.toContain("import './App'");
  expect(css).toContain('.gv2-classic .gv2-sidebar');
  expect(css).toContain('.gv2-classic .gv2-workspace');
  expect(css).toContain('@media(max-width:960px)');
 });
 it('restores an investment plan and simulated test-deposit entry point without enabling real deposits',()=>{
  const root=read('src/V2Dashboard.tsx');
  const panel=read('src/V2Investment.tsx');
  const preview=read('src/v2-investment-preview.ts');
  const client=read('src/v2-chain.ts');
  expect(root).toContain("label:'Invest / plans'");
  expect(root).toContain("section==='invest'");
  expect(root).toContain('Preview investment plans');
  expect(panel).toContain('Run demo investment');
  expect(panel).toContain('SIMULATION · NO TRANSFERS');
  expect(panel).toContain('No real BNB/USDT is transferred');
  expect(panel).toContain('Read V2 oracle quote');
  expect(preview).toContain('SIMULATION_ONLY_NO_CHAIN_WRITES');
  expect(client).toContain('readV2InvestmentQuote');
  expect(client).not.toMatch(/case 'deposit'/);
  expect(panel).not.toContain('.deposit(');
  expect(panel).not.toContain('.approve(');
 });
 it('uses only a syntax-checked, hash-pinned, rollback-capable installer',()=>{
  const script=read('../ubuntu-global-v2-site.sh');
  expect(script).toContain('V2_SITE_PINNED_SHA_REQUIRED');
  expect(script).toContain('V2_SITE_ROLLBACK_OK');
  expect(script).not.toContain('bash ubuntu-api.sh');
  expect(script).not.toContain('TRADES_VAULT_ADDRESS=');
  execFileSync('bash',['-n','../ubuntu-global-v2-site.sh'],{cwd:root});
 });
});
