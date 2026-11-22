import {describe,expect,it} from 'vitest';
import {parseEther} from 'ethers';
import {renderToStaticMarkup} from 'react-dom/server';
import V3CycleCard from '../src/V3CycleCard';
import {V3_HOURLY_TEST} from '../src/v3-site-config';
import type {V3Snapshot} from '../src/v3-chain';

const base={asOf:10000,lastCheckIn:9000,eligible:true,registered:true,suspended:false,paused:false,
 capital:parseEther('1000'),vipKyc:false,dailyRateBps:70,
 positions:[{principal:parseEther('1000'),compoundedBasis:0n,lastAccruedAt:9000}]} as V3Snapshot;
const render=(overrides:Partial<V3Snapshot>={})=>renderToStaticMarkup(<V3CycleCard
 view={{...base,...overrides}} busy={false} onCheckIn={()=>{}} onPositions={()=>{}}/>);

describe('V3 cycle eligibility presentation',()=>{
 it('does not label a recent check-in as eligible when the contract reports otherwise',()=>{
  const html=render({eligible:false});
  expect(html).toContain('Eligibility not confirmed');
  expect(html).toContain('Eligibility was not confirmed at the last verified block');
  expect(html).toContain('Progress is hidden while eligibility is not confirmed');
  expect(html).not.toContain('Account eligible');
 });
 it('treats an expired check-in as ineligible even if the last snapshot was eligible',()=>{
  const html=render({asOf:100000,lastCheckIn:9000});
  expect(html).toContain('Eligibility not confirmed');
  expect(html).toContain('Check in on chain to renew the 24-hour activity window');
 });
 it('explains another unmet requirement instead of asking only for check-in',()=>{
  const html=render({eligible:false,capital:parseEther('1')});
  expect(html).toContain('A minimum of 10 USDT principal is required');
 });
 it('labels the accelerated hourly rate only for the hourly build',()=>{
  const html=render();
  expect(html).toContain('Account eligible');
  if(V3_HOURLY_TEST){
   expect(html).toContain('YOUR ONE-HOUR TEST CYCLE');
   expect(html).toContain('The full daily test rate is applied once per eligible one-hour test cycle');
  }else{
   expect(html).toContain('YOUR DAILY CYCLE');
   expect(html).not.toContain('The full daily test rate is applied once per eligible one-hour test cycle');
  }
 });
 it('derives the single-account hourly timer from its additions and labels partial coverage',()=>{
  const page={start:0,totalLots:2,lots:[
   {principal:parseEther('1000'),basis:parseEther('7'),lastAccruedAt:9000},
   {principal:parseEther('2000'),basis:0n,lastAccruedAt:9500}
  ]};
  const view={...base,capital:parseEther('3000'),dailyRateBps:90,singleCapital:true,unifiedPage:page,
   positions:[{...base.positions[0],principal:parseEther('3000'),lastAccruedAt:9999}]} as unknown as V3Snapshot;
  const html=renderToStaticMarkup(<V3CycleCard view={view} busy={false} unifiedEnabled onCheckIn={()=>{}} onPositions={()=>{}}/>);
  expect(html).toContain('YOUR ONE-HOUR TEST CYCLE');
  expect(html).toContain('Estimated time remaining 00:43:20');
  expect(html).toContain('1970-01-01 03:30:00 UTC');
  expect(html).toContain('Each addition starts its own one-hour test cycle');
  expect(html).not.toContain('loaded additions');
  const manual=renderToStaticMarkup(<V3CycleCard view={{...view,manualReinvest:true}} busy={false} unifiedEnabled onCheckIn={()=>{}} onPositions={()=>{}}/>);
  expect(manual).not.toContain('Personal compound estimate');
  const zeroBasis={...view,manualReinvest:true,unifiedPage:{...view.unifiedPage!,lots:view.unifiedPage!.lots.map(lot=>({...lot,basis:0n}))}};
  expect(manual).toEqual(renderToStaticMarkup(<V3CycleCard view={zeroBasis} busy={false} unifiedEnabled onCheckIn={()=>{}} onPositions={()=>{}}/>));
  const partial=renderToStaticMarkup(<V3CycleCard view={{...view,unifiedPage:{...page,totalLots:3}} as V3Snapshot}
   busy={false} unifiedEnabled onCheckIn={()=>{}} onPositions={()=>{}}/>);
  expect(partial).toContain('Timer and estimates cover the 2 loaded additions');
 });
});
