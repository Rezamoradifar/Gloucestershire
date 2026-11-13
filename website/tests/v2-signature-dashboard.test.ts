import {describe,it,expect} from 'vitest';
import fs from 'node:fs';

const read=(path:string)=>fs.readFileSync(new URL(path,import.meta.url),'utf8');
describe('Global V2 signature dashboard',()=>{
 const ui=read('../src/V2Dashboard.tsx');
 const css=read('../src/v2-signature-dashboard.css');
 it('applies signature design as the final visual layer after existing responsive rules',()=>{
  expect(ui).toContain("import './v2-premium-experience.css';\nimport './v2-signature-dashboard.css';");
  expect(css).toContain('.gv2-signature-ledger-surface');
  expect(css).toContain('.gv2-signature-position-tile');
 });
 it('renders finance totals solely from the V2 contract snapshot, with truthful liquidity language',()=>{
  expect(ui).toContain('v2Money(snapshot.capitalUsd,18,2)');
  expect(ui).toContain('v2Money(account.principal,account.decimals)');
  expect(ui).toContain('v2Money(account.unfunded,account.decimals)');
  expect(ui).toContain('v2Money(account.cap,account.decimals)');
  expect(ui).toContain('System-wide principal without vault cash');
  expect(ui).not.toContain('10000 USD starting balance');
 });
 it('switches between chain-verified USDT and BNB without summing token units',()=>{
  expect(ui).toContain("(['USDT','BNB'] as V2Asset[]).map");
  expect(ui).toContain('aria-pressed={symbol===item}');
  expect(ui).toContain('onClick={()=>setSymbol(item)}');
  expect(ui).toContain('account&&<div className="gv2-signature-ledger-surface">');
 });
 it('shows actual position data and a correct no-positions fallback',()=>{
  expect(ui).toContain('snapshot.positions.slice(0,2).map');
  expect(ui).toContain('v2Money(p.principal,decimalsFor(p.asset))');
  expect(ui).toContain('v2Date(p.openedAt+90*86400)');
  expect(ui).toContain('No V2 positions recorded');
  expect(ui).toContain("onClick={()=>setSection('positions')}");
 });
 it('does not repeat four overview summary cards on every secondary page',()=>{
  expect(ui).toContain("{section==='overview'&&<div className=\"gv2-summary\">");
 });
 it('keeps reference navigation, security states, breakpoints and reduced motion',()=>{
  for(const label of ['Home','Positions','Team','History','Profile'])
   expect(ui).toContain("label:'"+label+"'");
  expect(ui).toContain("import './v2-mobile-dock.css';");
  expect(ui).toContain('V2_CODE_HASH');
  expect(ui).toContain('Unaudited test environment');
  for(const breakpoint of ['max-width:720px','max-width:420px','max-width:350px'])
   expect(css).toContain(breakpoint);
  expect(css).toContain('prefers-reduced-motion');
 });
});