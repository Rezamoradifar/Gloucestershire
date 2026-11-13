import {describe,it,expect} from 'vitest';
import type {V2WalletEvent} from '../src/v2-audit';
import {filterV2History,initialV2HistoryFilters,v2HistoryKind} from '../src/v2-history-filter';

const base:V2WalletEvent={
 key:'one',block:142416840,tx:'0x'+'a'.repeat(64),index:0,
 name:'DepositRouted',asset:null,amount:1000n,
 wallet:'0x1111111111111111111111111111111111111111',
 source:null,level:null,rateBps:null,proof:null,requestId:null,details:'Deposit confirmed'
};
const deposit=base;
const profit={...base,key:'two',block:142416841,index:1,tx:'0x'+'b'.repeat(64),
 name:'PersonalProfitCredited',details:'Funded profit',proof:'0x'+'1'.repeat(64)};
const withdrawal={...base,key:'three',block:142416842,index:2,
 name:'WithdrawalRequested',requestId:12,details:'Profit withdrawal request'};

describe('V2 history controls from original mobile Global dashboard',()=>{
 it('filters only loaded V2 events without fabricating data',()=>{
  expect(filterV2History([],initialV2HistoryFilters,{})).toEqual([]);
  expect(filterV2History([deposit,profit,withdrawal],{
   ...initialV2HistoryFilters,kind:'profit'
  },{}).map(row=>row.key)).toEqual(['two']);
  expect(v2HistoryKind(withdrawal)).toBe('withdrawal');
 });
 it('sorts by confirmed block number and scans proof, tx and request ID',()=>{
  const items=[deposit,withdrawal,profit];
  expect(filterV2History(items,{...initialV2HistoryFilters,order:'oldest'},{}).map(row=>row.key))
   .toEqual(['one','two','three']);
  expect(filterV2History(items,{...initialV2HistoryFilters,query:'12'},{}).map(row=>row.key))
   .toEqual(['three']);
  expect(filterV2History(items,{...initialV2HistoryFilters,query:'0x'+'1'.repeat(64)},{}).map(row=>row.key))
   .toEqual(['two']);
 });
 it('uses verified UTC block timestamps and excludes unknown dates from date filtering',()=>{
  const time=Date.parse('2026-11-13T12:10:00Z')/1000;
  const seen={[profit.block]:time};
  expect(filterV2History([deposit,profit,withdrawal],{
   ...initialV2HistoryFilters,from:'2026-11-13',to:'2026-11-13'
  },seen).map(row=>row.key)).toEqual(['two']);
  expect(filterV2History([profit],{
   ...initialV2HistoryFilters,from:'2026-11-14'
  },seen)).toEqual([]);
 });
});
