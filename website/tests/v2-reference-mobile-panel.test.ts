import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
const read=(file:string)=>fs.readFileSync(new URL(file,import.meta.url),'utf8');

describe('Reference mobile Global V2 account panel',()=>{
 it('retains the exact five screenshot tabs and routes to actual V2 sections',()=>{
  const app=read('../src/V2Dashboard.tsx');
  for(const label of ['Home','Positions','Team','History','Profile'])
   expect(app).toContain("label:'"+label+"'");
  expect(app).toContain('aria-current={section===id');
  expect(app).toContain('setSection(id)');
  expect(app).toContain('<V2HistoryPanel requester={wallet}');
 });
 it('preserves live-history filters, older scans and truthful RPC warnings',()=>{
  const history=read('../src/V2HistoryPanel.tsx');
  for(const label of ['All loaded events','Newest first','matching loaded events','Clear filters','Load older finance events','Deep scan older blocks','eth_getLogs support'])
   expect(history).toContain(label);
  expect(history).toContain('readV2History(walletProvider,requester,subject,offset)');
  expect(history).not.toContain('demoEvents');
 });
 it('uses the reference dark navy styling and safe-area fixed dock',()=>{
  const dock=read('../src/v2-mobile-dock.css');
  const styles=read('../src/v2-history-classic.css');
  expect(dock).toContain('position:fixed');
  expect(dock).toContain('repeat(5,minmax(0,1fr))');
  expect(dock).toContain('env(safe-area-inset-bottom)');
  expect(styles).toContain('.gv2-history-scan-buttons');
  expect(styles).toContain('.gv2-history-rpc-error');
 });
});
