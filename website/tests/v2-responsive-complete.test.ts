import {describe,it,expect} from 'vitest';
import fs from 'node:fs';

const src=(p:string)=>fs.readFileSync(new URL(p,import.meta.url),'utf8');

describe('Complete V2 responsive hardening',()=>{
 const css=src('../src/v2-responsive-complete.css');
 const app=src('../src/V2Dashboard.tsx');
 it('loads responsive overrides after existing desktop and mobile styles',()=>{
  expect(app).toContain("import './v2-mobile-dock.css';\nimport './v2-responsive-complete.css';");
 });
 it('retains the five real navigation sections and mobile touch navigation',()=>{
  for(const label of ['Home','Positions','Team','History','Profile'])
   expect(app).toContain("label:'"+label+"'");
  expect(app).toContain('setSection(id)');
  expect(css).toContain('touch-action:manipulation');
 });
 it('supports phone, tablet and landscape breakpoints with device safe area',()=>{
  for(const breakpoint of ['max-width:360px','max-width:600px','max-width:960px','min-width:961px','orientation:landscape'])
   expect(css).toContain(breakpoint);
  expect(css).toContain('env(safe-area-inset-bottom');
 });
 it('prevents broad input sizing from stretching checkboxes',()=>{
  expect(css).toContain('input:not([type=checkbox]):not([type=radio])');
  expect(css).toContain('input[type=checkbox]');
  expect(css).toContain('width:auto');
 });
 it('includes responsive handling for history, admin, account cards and long chain identifiers',()=>{
  for(const target of ['.gv2-history-filters','.gv2-history-pages','.gv2-admin-search','.gv2-plan-card','.gv2-summary','.gv2-break','.gv2-sidebar'])
   expect(css).toContain(target);
  expect(css).toContain('overflow-wrap:anywhere');
 });
 it('does not change wallet/network or contract semantics',()=>{
  expect(css).not.toContain('0xA98D8d');
  expect(css).not.toContain('TRADES_VAULT_ADDRESS');
  expect(css).not.toContain('deposit(');
 });
});
