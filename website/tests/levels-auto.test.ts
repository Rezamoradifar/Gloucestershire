import {describe,it,expect} from 'vitest';
import {readLevelVolumes} from '../src/levels';
import {suggestRewardBranches} from '../src/auto-reward';
import {needsReferrerWarning} from '../src/referrer';
const zero='0x'+'0'.repeat(40),options={blockTag:123};
function fixture(){const tree:Record<string,string[]>={root:['a','b'],a:['c'],c:['d'],d:['e']},vol:Record<string,bigint>={a:100n,b:20n,c:70n,d:40n,e:10n};return {volumeJobCount:async()=>1n,volumeJobs:async()=>({ancestor:zero}),networkBranchCount:async(who:string,o:unknown)=>{expect(o).toEqual(options);return BigInt(tree[who]?.length||0);},networkBranch:async(who:string,i:number)=>tree[who][i],branchVolumeUsd:async(_:string,child:string)=>vol[child]};}
describe('referrer warning and exact level volume',()=>{
 it('requires acknowledgement only on a first deposit without a real referrer',()=>{
  expect(needsReferrerWarning('deposit',false,'  ')).toBe(true);expect(needsReferrerWarning('deposit',false,zero)).toBe(true);
  expect(needsReferrerWarning('deposit',true,'')).toBe(false);expect(needsReferrerWarning('reinvest',false,'')).toBe(false);expect(needsReferrerWarning('deposit',false,'0x'+'1'.repeat(40))).toBe(false);
 });
 it('excludes deeper descendants rather than counting whole branches at every level',async()=>{
  expect(await readLevelVolumes(fixture() as any,'root',123)).toEqual([{level:1,members:2,volume:50n},{level:2,members:1,volume:30n},{level:3,members:1,volume:30n}]);
 });
 it('does not present partial or inconsistent histories as exact totals',async()=>{
  await expect(readLevelVolumes({...fixture(),volumeJobs:async()=>({ancestor:'root'})} as any,'root',123)).rejects.toThrow('propagation');
  await expect(readLevelVolumes({...fixture(),volumeJobCount:async()=>5000n} as any,'root',123)).rejects.toThrow('server index');
 });
 it('selects available independent branches with the stage cap and reports shortages',async()=>{
  const vol=[900n,250n,200n],v:any={networkBranchCount:async()=>3n,rewardStage:async()=>({volumeUsd:500n}),branchCapBps:async()=>6000n,networkBranch:async(_:string,i:number)=>String(i),groupedBranch:async(_:string,a:string)=>a==='1',branchVolumeUsd:async(_:string,a:string)=>vol[Number(a)]};
  expect(await suggestRewardBranches(v,'root',123)).toMatchObject({branches:['0','2'],eligible:500n,missing:0n,cap:300n});v.groupedBranch=async()=>false;vol[0]=10n;vol[1]=20n;vol[2]=30n;
  expect(await suggestRewardBranches(v,'root',123)).toMatchObject({eligible:60n,missing:440n});
 });
});
