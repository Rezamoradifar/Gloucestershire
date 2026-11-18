import {describe,expect,it} from 'vitest';
import {parseEther} from 'ethers';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {planUnifiedReinvestment,readUnifiedReinvestmentPlan} from '../src/v3-reinvest-batch';
import V3UnifiedReinvestSummary from '../src/V3UnifiedReinvestSummary';
import type {V3WalletPosition} from '../src/v3-chain';
import type {UnifiedPositionPage} from '../src/v3-unified-position';

const E=(s:string)=>parseEther(s);
const position=(id:number,claim:string,group=false)=>({id,fromReinvestment:group,principal:E('100'),
 availableProfit:E(claim),availableDaily:E(claim),availableCompound:0n,compoundedBasis:E(claim)} as V3WalletPosition);
const page=(start:number,claim:string,block=50)=>({wallet:'0x0000000000000000000000000000000000000001',
 positionId:1,block,asOf:1000,start,limit:1,totalLots:2,principal:E('100'),daily:E('6'),compound:0n,
 availableProfitOnPage:E(claim),lots:[{id:start,daily:E(claim),compound:0n}]} as UnifiedPositionPage);

describe('atomic unified reinvestment planning',()=>{
 it('automatically draws one requested amount from several recorded position profits',()=>{
  const positions=[position(0,'273.683399'),position(1,'684.208498'),position(2,'2.736833')];
  const result=planUnifiedReinvestment(positions,[],E('500'));
  expect(result.total).toBe(E('960.628730'));
  expect(result.sources).toEqual([
   {positionId:0,amount:E('273.683399'),start:0,limit:0},
   {positionId:1,amount:E('226.316601'),start:0,limit:0}
  ]);
  const html=renderToStaticMarkup(createElement(V3UnifiedReinvestSummary,{positions}));
  expect(html).toContain('960.62873 USDT');
  expect(html).not.toContain('<select');
  expect(html).toContain('Referral and network rewards are separate');
 });
 it('uses verified group pages after other sources, without counting any profit twice',()=>{
  const positions=[position(0,'4'),position(1,'6',true)];
  const result=planUnifiedReinvestment(positions,[page(0,'3'),page(1,'3')],E('9'));
  expect(result.sources).toEqual([{positionId:0,amount:E('4'),start:0,limit:0},
   {positionId:1,amount:E('3'),start:0,limit:1},{positionId:1,amount:E('2'),start:1,limit:1}]);
  expect(()=>planUnifiedReinvestment(positions,[page(0,'3')],E('9'))).toThrow(/More verified/);
  expect(()=>planUnifiedReinvestment(positions,[page(0,'3'),page(0,'3')],E('9'))).toThrow(/inconsistent/);
  expect(()=>planUnifiedReinvestment(positions,[page(0,'3'),page(1,'3',51)],E('9'))).toThrow(/same verified block/);
 });
 it('can spend verified profit beyond 128 previously exhausted additions',async()=>{
  const wallet=page(0,'0').wallet,hash='0x'+'12'.repeat(32);
  const ordinary={principal:129n,compoundedBasis:1n,availableProfit:1n,reservedProfit:0n,reservedPrincipal:0n,
   cumulativeDaily:1n,cumulativeCompound:0n,openedAt:1n,lastAccruedAt:1n,fromReinvestment:true};
  const session={config:{unified:{}},vault:{positionCount:async()=>1n,reinvestmentPositionPlusOne:async()=>1n,
   positionOf:async()=>ordinary,claimableDaily:async()=>1n,claimableCompound:async()=>0n},
   options:{blockTag:50},block:{number:50,timestamp:1000,hash},provider:{send:async()=>({hash})},
   book:{position:async()=>({principal:129n,daily:1n,compound:0n,basis:1n,reservedProfit:0n,reservedPrincipal:0n,
    cumulativeDaily:1n,cumulativeCompound:0n,lots:129n}),
    lot:async(_wallet:string,id:number)=>({principal:1n,reservedPrincipal:0n,reservedProfit:0n,
     daily:id===128?1n:0n,basis:id===128?1n:0n,compound:0n,openedAt:1n,lastAccruedAt:1n})}};
  const result=await readUnifiedReinvestmentPlan(session as any,wallet,1n);
  expect(result.sources).toEqual([{positionId:0,amount:1n,start:128,limit:1}]);
  expect(result.destination).toBe(0);
 });
 it('fails closed for incomplete accounts, invalid claims or a transaction requiring too many sources',()=>{
  expect(()=>planUnifiedReinvestment([position(1,'2')],[],E('1'))).toThrow(/reconcile/);
  expect(()=>planUnifiedReinvestment([position(0,'2')],[],E('3'))).toThrow(/exceeds/);
  const invalid=position(0,'2');invalid.availableDaily=E('1');
  expect(()=>planUnifiedReinvestment([invalid],[],E('1'))).toThrow(/reconcile/);
  const many=Array.from({length:17},(_,i)=>position(i,'1'));
  expect(planUnifiedReinvestment(many,[],E('16')).sources).toHaveLength(16);
  expect(()=>planUnifiedReinvestment(many,[],E('17'))).toThrow(/more than one transaction/);
 });
});
