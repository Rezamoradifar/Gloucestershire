import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
const read=(file:string)=>fs.readFileSync(new URL(file,import.meta.url),'utf8');

describe('Premium Global V2 customer panel',()=>{
 const app=read('../src/V2Dashboard.tsx');
 const css=read('../src/v2-premium-experience.css');
 it('loads new appearance after responsive rules without changing chain adapter',()=>{
  expect(app).toContain("import './v2-responsive-complete.css';\nimport './v2-premium-experience.css';");
  expect(app).toContain("from './v2-chain'");
  expect(app).not.toMatch(/from '\.\/chain'/);
 });
 it('shows only real V2 account fields, not invented dollar balances',()=>{
  expect(app).toContain("v2Money(snapshot.capitalUsd,18,2)");
  expect(app).toContain('snapshot.accounts.map(a=>');
  expect(app).toContain('v2Money(a.profit,a.decimals)');
  expect(app).toContain('Contract-recorded capital, not available vault cash');
  expect(app).toContain('Credited rewards · not transferred to wallet');
  expect(app).not.toContain('10000 USD starting balance');
 });
 it('includes working navigation to positions, withdrawals, network, investment and support',()=>{
  for(const target of ["setSection('positions')","setSection('withdrawals')","setSection('team')","setSection('invest')","setSection('history')","setSection('tickets')"])
   expect(app).toContain(target);
  for(const label of ['Home','Positions','Team','History','Profile'])
   expect(app).toContain("label:'"+label+"'");
 });
 it('preserves the disclosure and the contract pin',()=>{
  expect(app).toContain('Unaudited test environment');
  expect(app).toContain('Deposits are disabled');
  expect(app).toContain('v2Short(V2_ADDRESS)');
  expect(app).toContain('snapshot.block.toLocaleString');
 });
 it('supports the same mobile reference theme while honoring reduced motion',()=>{
  expect(css).toContain('.gv2-premium-board');
  expect(css).toContain('.gv2-premium-shortcut-grid');
  expect(css).toContain('.gv2-premium-welcome');
  expect(css).toContain('@media(max-width:360px)');
  expect(css).toContain('@media(max-width:600px)');
  expect(css).toContain('prefers-reduced-motion');
  expect(css).not.toContain('display:none!important');
 });
});
