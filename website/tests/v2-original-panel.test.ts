import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source=(file:string)=>fs.readFileSync(path.resolve(process.cwd(),'src',file),'utf8');
describe('Original Global mobile panel restored on V2-only data',()=>{
 it('keeps the five original mobile tabs functional and ordered',()=>{
  const page=source('V2Dashboard.tsx');
  const nav=page.slice(page.indexOf('const mobileNavItems=['),page.indexOf('const explorerAddress='));
  for(const [label,index] of [['Home',0],['Positions',1],['Team',2],['History',3],['Profile',4]] as const){
   expect(nav).toContain("label:'"+label+"'");
   if(index>0)expect(nav.indexOf("label:'"+label+"'")).toBeGreaterThan(
    nav.indexOf("label:'"+(['Home','Positions','Team','History','Profile'][index-1])+"'")
   );
  }
  expect(page).toContain('className="gv2-mobile-bottom"');
  expect(page).toContain("aria-current={section===id?'page':undefined}");
  expect(page).toContain('setSection(id)');
  expect(page).toContain("import V2HistoryPanel from './V2HistoryPanel'");
  expect(page).not.toContain("from './chain'");
  expect(page).not.toContain("import './App'");
  const css=source('v2-mobile-dock.css');
  expect(css).toContain('grid-template-columns:repeat(5,minmax(0,1fr))');
  expect(css).toContain('position:fixed');
  expect(css).toContain('env(safe-area-inset-bottom)');
 });
 it('keeps the original history form and accurate empty and RPC error states',()=>{
  const history=source('V2HistoryPanel.tsx');
  for(const text of ['All loaded events','From (UTC)','To (UTC)','Newest first',
   'matching loaded events','Clear filters','No matching events were found',
   'Need older history?','Load older finance events','Deep scan older blocks',
   'eth_getLogs support','Previous','Next'])expect(history).toContain(text);
  expect(history).toContain('readV2History(');
  expect(history).not.toContain('/api/trades');
  expect(history).not.toContain('oldVault');
  const f=source('v2-history-filter.ts');
  expect(f).toContain("import type {V2WalletEvent} from './v2-audit'");
  expect(f).toContain('new Date(timestamp*1000).toISOString()');
 });
});
