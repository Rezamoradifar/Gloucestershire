import {describe,expect,it} from 'vitest';
import {Interface,type Log} from 'ethers';
import {filterHistory,historyAbi,historyCsv,historyTotals,parseFinancialLog,type LedgerEvent,type HistoryFilter} from '../src/history-ledger';
import {withdrawalState} from '../src/history-queue';

const address='0x1111111111111111111111111111111111111111';
const token='0x2222222222222222222222222222222222222222';
function log(name:string,values:unknown[],block=150,index=2):Log{
 const e=historyAbi.getEvent(name)!;
 const encoded=historyAbi.encodeEventLog(e,values);
 return {topics:encoded.topics,data:encoded.data,blockNumber:block,index,transactionHash:'0x'+'a'.repeat(64)} as unknown as Log;
}
const day=(x:string)=>Math.floor(new Date(x).getTime()/1000);
function ledger(kind:LedgerEvent['kind'],amount:bigint,time:number|null,block:number,index=0):LedgerEvent{
 return {key:block+':'+index,kind,wallet:address,amount,fee:0n,block,index,tx:'0x'+'b'.repeat(64),timestamp:time};
}
const filters:HistoryFilter={kind:'all',query:'',from:'',to:'',sort:'newest'};

describe('complete, truthful financial history',()=>{
 it('parses principal vs profit withdrawal and exact fee from confirmed vault events',()=>{
  const item=parseFinancialLog(log('Withdrawal',[address,token,250_000_000n,6_250_000n,true]));
  expect(item).toMatchObject({kind:'withdrawal',principal:true,amount:250_000_000n,fee:6_250_000n,index:2});
 });
 it('preserves profit credit batch ids and deposit position/index details',()=>{
  const batch='0x'+'a'.repeat(64);
  expect(parseFinancialLog(log('ProfitCredited',[address,token,31_000_000n,batch]))).toMatchObject({kind:'profit',creditId:batch,amount:31_000_000n});
  expect(parseFinancialLog(log('Deposited',[address,token,4n,500_000_000n,500_000_000_000_000_000_000n,25_000n])))
   .toMatchObject({kind:'deposit',position:4n,amount:500_000_000n,depositUsd:500_000_000_000_000_000_000n});
 });
 it('labels network reward milestones as USD record rather than a USDT wallet transfer',()=>{
  const item=parseFinancialLog(log('NetworkRewardEarned',[address,7n,3,5_000_000_000_000_000_000_000n,120_000_000_000_000_000_000n]));
  expect(item).toMatchObject({kind:'networkReward',amount:120_000_000_000_000_000_000n,group:7n,stage:3});
  expect(item?.volumeUsd).toBe(5_000_000_000_000_000_000_000n);
 });
 it('filters UTC date range, transaction ID and type without inventing timestamps',()=>{
  const records=[
   ledger('profit',8n,day('2026-11-10T10:00:00Z'),12,1),
   ledger('withdrawal',3n,day('2026-11-11T11:00:00Z'),13),
   ledger('profit',5n,null,10),
  ];
  expect(filterHistory(records,{...filters,from:'2026-11-10',to:'2026-11-10'}).map(x=>x.key)).toEqual(['12:1']);
  expect(filterHistory(records,{...filters,kind:'profit'}).map(x=>x.key)).toEqual(['12:1','10:0']);
  expect(filterHistory(records,{...filters,sort:'oldest'}).map(x=>x.key)).toEqual(['10:0','12:1','13:0']);
  expect(filterHistory(records,{...filters,query:'#5'})).toHaveLength(0);
 });
 it('never sums USD network reward milestones into token profit, withdrawal or deposits',()=>{
  const rows=[ledger('deposit',500n,null,10),ledger('profit',12n,null,11),
   ledger('withdrawal',8n,null,12),ledger('reinvest',3n,null,13),ledger('networkReward',100_000_000_000_000_000_000n,null,14)];
  expect(historyTotals(rows)).toEqual({
   deposit:500n,profit:12n,withdrawal:8n,reinvest:3n,networkReward:100_000_000_000_000_000_000n
  });
 });
 it('exports exact 6-decimal token amounts, gross and net fees, CSV injection protection and partial coverage',()=>{
  const item={...ledger('withdrawal',1_250_001n,day('2026-11-11T15:01:00Z'),142,2),
   fee:125_001n,principal:false,wallet:'=HYPERLINK("bad")'};
  const csv=historyCsv([item],'USDT',6,97,'0x3333333333333333333333333333333333333333',false);
  expect(csv).toContain('1.250001');expect(csv).toContain('0.125001');expect(csv).toContain('1.125');
  expect(csv).toContain('2026-11-11T15:01:00.000Z');expect(csv).toContain('history_scan_complete');
  expect(csv).toContain('"no"');expect(csv).toContain("'=HYPERLINK");
  expect(csv).not.toContain('1.250001e');
 });
 it('distinguishes all four withdrawal queue statuses and derives overdue from chain time',()=>{
  expect(withdrawalState(0,100,101,true)).toContain('Overdue');
  expect(withdrawalState(0,100,99,true)).toContain('Awaiting approval');
  expect(withdrawalState(1,100,101,true)).toBe('Paid in queue');
  expect(withdrawalState(2,100,101,true)).toBe('Cancelled');
  expect(withdrawalState(3,100,101,true)).toContain('Approved');
 });
});
