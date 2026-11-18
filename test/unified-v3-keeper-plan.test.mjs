import assert from 'node:assert/strict';
import test from 'node:test';
import {ZeroAddress,parseEther} from 'ethers';
import {planUnifiedLotPage} from '../scripts/plan-v3-unified-accrual.mjs';

const wallet='0x0000000000000000000000000000000000000001';
const E=value=>parseEther(String(value));
const lot=(id,principal,basis,lastAccruedAt)=>({id,principal,basis,lastAccruedAt});

test('plans only due, nonzero lots with per-lot rounding and a bounded cursor',()=>{
 const lots=[lot(8,E(2),E('0.3'),100),lot(9,E(3),0n,200),lot(10,1n,0n,100)];
 const page=planUnifiedLotPage({wallet,start:8,totalLots:11,lots,now:3700,rateBps:70,eligible:true,paused:false});
 assert.equal(page.dueLots,1);
 assert.equal(page.daily,E('0.014'));
 assert.equal(page.compound,E('0.0021'));
 assert.equal(page.next,11);
 assert.deepEqual(page.proposal,{method:'accrueReinvestmentPage',args:[wallet,8,8]});
 assert.equal(page.transactionSent,false);
});

test('an inactive or paused account never produces a transaction proposal',()=>{
 const args={wallet,start:0,totalLots:1,lots:[lot(0,E(1),0n,0)],now:3600,rateBps:70};
 assert.equal(planUnifiedLotPage({...args,eligible:false,paused:false}).proposal,null);
 assert.equal(planUnifiedLotPage({...args,eligible:true,paused:true}).proposal,null);
});

test('rejects partial, reordered, oversized and unsafe data',()=>{
 const args={wallet,start:0,totalLots:2,lots:[lot(0,E(1),0n,0),lot(1,E(1),0n,0)],now:3600,rateBps:70,eligible:true,paused:false};
 assert.throws(()=>planUnifiedLotPage({...args,lots:args.lots.slice(0,1)}),/INCOMPLETE/);
 assert.throws(()=>planUnifiedLotPage({...args,lots:[args.lots[1],args.lots[0]]}),/LOT_ID/);
 assert.throws(()=>planUnifiedLotPage({...args,limit:9}),/INVALID_UNIFIED_PAGE/);
 assert.throws(()=>planUnifiedLotPage({...args,wallet:ZeroAddress}),/INVALID_UNIFIED_PAGE/);
 assert.throws(()=>planUnifiedLotPage({...args,lots:[lot(0,-1n,0n,0),args.lots[1]]}),/LOT_PRINCIPAL/);
 assert.throws(()=>planUnifiedLotPage({...args,lots:[lot(0,1n,0n,Number.MAX_SAFE_INTEGER),args.lots[1]]}),/LOT_TIME/);
 assert.throws(()=>planUnifiedLotPage({...args,rateBps:10001}),/INVALID_UNIFIED_PAGE/);
});
