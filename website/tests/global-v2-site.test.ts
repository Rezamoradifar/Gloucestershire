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
  expect(source).toContain('approveWithdrawal');
  expect(source).toContain('requestPrincipal');
  expect(source).toContain('reinvest');
  const actions=read('src/v2-chain.ts');
  expect(actions).not.toMatch(/case 'deposit'/);
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
  expect(dashboard).toContain('Previous positions and credits');
  const css=read('src/v2-dashboard.css');
  expect(css).toContain('.gv2-release');
  expect(css).toContain('.gv2-safety-disclosure');
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
