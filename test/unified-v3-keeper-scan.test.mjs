import assert from 'node:assert/strict';
import test from 'node:test';
import {parseEther} from 'ethers';
import {scanUnifiedAccrual} from '../scripts/scan-v3-unified-accrual.mjs';

const A='0x0000000000000000000000000000000000000001';
const B='0x0000000000000000000000000000000000000002';
const E=value=>parseEther(String(value));
const opts=value=>assert.deepEqual(value,{blockTag:42});
const cursor=(member=0,position=0,lot=0)=>({member,position,lot});

function fixture(){
 const state={paused:false,eligible:true,bookPrincipal:E(10),bookBasis:0n,lotReads:0};
 const lots=Array.from({length:10},()=>({principal:E(1),basis:0n,lastAccruedAt:3600n}));
 const vault={
  paused:async o=>{opts(o);return state.paused;},
  memberCount:async o=>{opts(o);return 2n;},
  memberAt:async (i,o)=>{opts(o);return [A,B][i];},
  isEligible:async (a,o)=>{opts(o);return a===A&&state.eligible;},
  positionCount:async (a,o)=>{opts(o);assert.equal(a,A);return 2n;},
  reinvestmentPositionPlusOne:async(a,o)=>{opts(o);assert.equal(a,A);return 2n;},
  effectiveDailyBps:async (a,o)=>{opts(o);assert.equal(a,A);return 70n;},
  positionOf:async(a,id,o)=>{
   opts(o);assert.equal(a,A);
   return id===0?{principal:E(1000),compoundedBasis:0n,lastAccruedAt:3600n,fromReinvestment:false}:
    {principal:E(10),compoundedBasis:0n,lastAccruedAt:7200n,fromReinvestment:true};
  }
 };
 const book={
  position:async(a,o)=>{opts(o);assert.equal(a,A);return {principal:state.bookPrincipal,basis:state.bookBasis,lots:10n};},
  lot:async(a,i,o)=>{opts(o);assert.equal(a,A);state.lotReads++;return lots[i];}
 };
 const base={vault,book,blockNumber:42,blockTimestamp:7200,maxWork:1,maxResults:1};
 return {state,lots,base};
}

test('scans ordinary and grouped positions with a fair, bounded three-part cursor',async()=>{
 const f=fixture();
 const first=await scanUnifiedAccrual({...f.base,cursor:cursor()});
 assert.equal(first.selected[0].method,'accrueDaily');
 assert.equal(first.selected[0].daily,E(7));
 assert.deepEqual(first.next,cursor(0,1,0));
 assert.deepEqual(first.selected[0].retryCursor,cursor(0,0,0));
 const middle=await scanUnifiedAccrual({...f.base,cursor:first.next});
 assert.equal(middle.selected[0].method,'accrueReinvestmentPage');
 assert.deepEqual(middle.selected[0].args,[A,0,8]);
 assert.equal(middle.selected[0].dueLots,8);
 assert.equal(middle.selected[0].daily,E('0.056'));
 assert.deepEqual(middle.next,cursor(0,1,8));
 assert.equal(f.state.lotReads,8);
 const last=await scanUnifiedAccrual({...f.base,cursor:middle.next});
 assert.deepEqual(last.selected[0].args,[A,8,8]);
 assert.equal(last.selected[0].daily,E('0.014'));
 assert.deepEqual(last.next,cursor(1,0,0));
 const end=await scanUnifiedAccrual({...f.base,cursor:last.next});
 assert.equal(end.selected.length,0);
 assert.equal(end.completed,true);
 assert.deepEqual(end.next,cursor());
 assert.equal(end.transactionSent,false);
});

test('rescanning confirmed lots does not propose an already accrued page',async()=>{
 const f=fixture();
 for(let i=0;i<8;i++)f.lots[i].lastAccruedAt=7200n;
 const result=await scanUnifiedAccrual({...f.base,cursor:cursor(0,1,0),maxWork:2,maxResults:2});
 assert.equal(result.selected.length,1);
 assert.deepEqual(result.selected[0].args,[A,8,8]);
 assert.deepEqual(result.selected[0].retryCursor,cursor(0,1,8));
});

test('pausing, ineligibility and bad or partial ledgers fail closed',async()=>{
 const f=fixture();f.state.paused=true;
 const paused=await scanUnifiedAccrual({...f.base,cursor:cursor()});
 assert.equal(paused.paused,true);assert.equal(paused.work,0);assert.equal(f.state.lotReads,0);
 f.state.paused=false;f.state.eligible=false;
 const skipped=await scanUnifiedAccrual({...f.base,cursor:cursor(0,1,0)});
 assert.equal(skipped.selected.length,0);assert.deepEqual(skipped.next,cursor(1,0,0));
 f.state.eligible=true;f.state.bookPrincipal=E(9);
 await assert.rejects(scanUnifiedAccrual({...f.base,cursor:cursor(0,1,0)}),/BOOK_LEDGER_MISMATCH/);
 await assert.rejects(scanUnifiedAccrual({...f.base,cursor:cursor(),lotPageSize:9}),/SCAN_LIMIT/);
 await assert.rejects(scanUnifiedAccrual({...f.base,cursor:cursor(0,0,1)}),/LOT_CURSOR/);
 await assert.rejects(scanUnifiedAccrual({...f.base,cursor:cursor(3,0,0)}),/MEMBER_CURSOR/);
});
