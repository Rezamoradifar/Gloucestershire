import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import React from 'react';
import {financialSeries,type LedgerEvent} from '../src/FinancialInsights';
import VIPAccountCard from '../src/VIPAccountCard';
import NetworkConstellation from '../src/NetworkConstellation';
const seconds=(value:string)=>Math.round(new Date(value).getTime()/1000);
const base={key:'e',wallet:'0x1111111111111111111111111111111111111111',fee:0n,block:100,index:0,tx:'0x'+'a'.repeat(64),position:undefined};
const event=(kind:LedgerEvent['kind'],timestamp:string,amount:bigint):LedgerEvent=>({...base,kind,amount,timestamp:seconds(timestamp)});
describe('GLOBAL V2 live data and transparent analytics',()=>{
 it('bins exact integer amounts by UTC days without turning credits into withdrawals',()=>{
  const now=new Date('2026-11-11T15:00:00Z').getTime();
  const series=financialSeries([
   event('profit','2026-11-10T22:00:00Z',25_000_000n),
   event('profit','2026-11-10T20:00:00Z',10_000_000n),
   event('deposit','2026-11-10T23:59:00Z',100_000_000n),
   event('withdrawal','2026-11-11T00:02:00Z',15_000_000n),
   event('reinvest','2026-11-11T01:00:00Z',400_000n)
  ],'week',now);
  expect(series).toHaveLength(7);
  expect(series.find(x=>x.key==='2026-11-10')).toMatchObject({profit:35_000_000n,deposit:100_000_000n,withdrawal:0n});
  expect(series.find(x=>x.key==='2026-11-11')).toMatchObject({withdrawal:15_000_000n,profit:0n});
 });
 it('groups monthly records without treating missing timestamps or old records as activity',()=>{
  const now=new Date('2026-11-11T15:00:00Z').getTime();
  const records=[event('deposit','2026-07-09T00:00:00Z',400n),{...event('profit','2026-11-01T08:00:00Z',600n),timestamp:null},event('profit','2026-11-09T10:00:00Z',800n)];
  const bins=financialSeries(records,'halfyear',now);
  expect(bins).toHaveLength(6);expect(bins.find(x=>x.key==='2026-07')?.deposit).toBe(400n);
  expect(bins.find(x=>x.key==='2026-11')?.profit).toBe(800n);
 });
 it('keeps the disconnected VIP card empty instead of fabricating yields',()=>{
  const html=renderToStaticMarkup(<VIPAccountCard data={null} asset="USDT" onViewHistory={()=>{}} onViewProfile={()=>{}}/>);
  expect(html).toContain('CONNECT WALLET TO VIEW');expect(html).toContain('not a wallet balance');expect(html).toContain('no profit is guaranteed');
 });
 it('shows only on-chain-discovered graph nodes and an explicit disclosure',()=>{
  const html=renderToStaticMarkup(<NetworkConstellation parent="0x1111111111111111111111111111111111111111"
   members={[{address:'0x2222222222222222222222222222222222222222',block:100,tx:'0x'+'a'.repeat(64)}]}
   selected={null} onSelect={()=>{}}/>);
  expect(html).toContain('Interactive preview');expect(html).toContain('1 of 1');expect(html).toContain('on-chain registration events');
 });
});
