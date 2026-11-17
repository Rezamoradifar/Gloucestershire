import {describe,expect,it} from 'vitest';
import {parseEther} from 'ethers';
import {renderToStaticMarkup} from 'react-dom/server';
import V3UnifiedPositionPage from '../src/V3UnifiedPositionPage';
import V3CycleCard from '../src/V3CycleCard';
import type {V3Snapshot} from '../src/v3-chain';
import {prepareUnifiedPageAction,readUnifiedPositionPage,type UnifiedBookReader,type UnifiedVaultReader} from '../src/v3-unified-position';

const wallet='0x0000000000000000000000000000000000000001';
const E=(value:string)=>parseEther(value);
const time=1000+90*86400+1;
function fixture(){
 const state={principal:E('30'),basis:E('6'),group:2n};
 const options=(value:{blockTag:number})=>expect(value).toEqual({blockTag:50});
 const vault:UnifiedVaultReader={
  reinvestmentPositionPlusOne:async(_w,o)=>{options(o);return state.group;},
  positionOf:async(_w,_i,o)=>{options(o);return {principal:state.principal,compoundedBasis:E('6'),
   availableProfit:E('6'),reservedProfit:E('1'),reservedPrincipal:E('2'),
   cumulativeDaily:E('8'),cumulativeCompound:E('3'),fromReinvestment:true};},
  claimableDaily:async(_w,_i,o)=>{options(o);return E('5');},
  claimableCompound:async(_w,_i,o)=>{options(o);return E('1');}
 };
 const lots=[
  {principal:E('10'),reservedPrincipal:E('2'),daily:E('2'),compound:E('1'),basis:E('3'),reservedProfit:E('1'),openedAt:1000n,lastAccruedAt:1500n},
  {principal:E('10'),reservedPrincipal:0n,daily:E('1'),compound:0n,basis:E('1'),reservedProfit:0n,openedAt:2000n,lastAccruedAt:2500n},
  {principal:E('10'),reservedPrincipal:0n,daily:E('2'),compound:0n,basis:E('2'),reservedProfit:0n,openedAt:3000n,lastAccruedAt:3500n}
 ];
 const book:UnifiedBookReader={
  position:async(_w,o)=>{options(o);return {principal:E('30'),reservedPrincipal:E('2'),daily:E('5'),compound:E('1'),
   basis:state.basis,reservedProfit:E('1'),cumulativeDaily:E('8'),cumulativeCompound:E('3'),lots:3n};},
  lot:async(_w,i,o)=>{options(o);return lots[i];}
 };
 return {vault,book,state,lots};
}
const account={registered:true,suspended:false,paused:false,pendingWithdrawal:false,nextRequestAt:0,requestCap:E('2')};

describe('unified reinvestment position',()=>{
 it('reads one position at a confirmed block while preserving per-addition unlock times',async()=>{
  const f=fixture(),page=await readUnifiedPositionPage(f.vault,f.book,wallet,1,50,time,0,2);
  expect(page.principal).toBe(E('30'));
  expect(page.availableProfitOnPage).toBe(E('4'));
  expect(page.maturedPrincipalOnPage).toBe(E('8'));
  expect(page.lots.map(lot=>lot.unlockAt)).toEqual([1000+90*86400,2000+90*86400]);
  const html=renderToStaticMarkup(<V3UnifiedPositionPage page={page} onPrevious={()=>{}} onNext={()=>{}}/>);
  expect(html).toContain('One reinvestment position');
  expect(html).toContain('Showing additions 1–2 of 3');
  expect(html).toContain('Addition #1');expect(html).toContain('Addition #2');
  expect(html).not.toContain('separate on-chain positions');
 });
 it('prepares only page-backed amounts and enforces cooldown and the profit cap',async()=>{
  const f=fixture(),page=await readUnifiedPositionPage(f.vault,f.book,wallet,1,50,time,0,2);
  expect(prepareUnifiedPageAction(page,account,'reinvest',E('4'))).toEqual({method:'reinvestFromPage',args:[1,E('4'),0,2]});
  expect(prepareUnifiedPageAction(page,account,'profit',E('2'))).toEqual({method:'requestProfitFromPage',args:[1,E('2'),0,2]});
  expect(prepareUnifiedPageAction(page,account,'principal',E('8'))).toEqual({method:'requestPrincipalFromPage',args:[1,E('8'),0,2]});
  expect(()=>prepareUnifiedPageAction(page,account,'principal',E('8.01'))).toThrow(/unlocked principal/);
  expect(()=>prepareUnifiedPageAction(page,account,'profit',E('2.01'))).toThrow(/profit cap/);
  expect(()=>prepareUnifiedPageAction(page,{...account,pendingWithdrawal:true},'profit',E('1'))).toThrow(/pending/);
  expect(()=>prepareUnifiedPageAction(page,account,'reinvest',E('4.01'))).toThrow(/recorded profit/);
 });
 it('rejects a mismatched parent, book, group or future lot',async()=>{
  const f=fixture();f.state.principal=E('31');
  await expect(readUnifiedPositionPage(f.vault,f.book,wallet,1,50,time,0,2)).rejects.toThrow(/reconcile/);
  f.state.principal=E('30');f.state.basis=E('7');
  await expect(readUnifiedPositionPage(f.vault,f.book,wallet,1,50,time,0,2)).rejects.toThrow(/reconcile/);
  f.state.basis=E('6');f.state.group=3n;
  await expect(readUnifiedPositionPage(f.vault,f.book,wallet,1,50,time,0,2)).rejects.toThrow(/not the verified/);
  f.state.group=2n;f.lots[0].lastAccruedAt=BigInt(time+1);
  await expect(readUnifiedPositionPage(f.vault,f.book,wallet,1,50,time,0,2)).rejects.toThrow(/inconsistent/);
 });
 it('does not use one aggregate timestamp to claim an exact group-wide cycle',()=>{
  const view={asOf:time,unifiedPage:null} as V3Snapshot;
  const html=renderToStaticMarkup(<V3CycleCard view={view} busy={false} onCheckIn={()=>{}} onPositions={()=>{}}/>);
  expect(html).toContain('Each addition has its own cycle');
  expect(html).toContain('read-only preview');
  expect(html).not.toContain('LIVE ESTIMATED PROGRESS');
 });
});
