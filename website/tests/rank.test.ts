import {describe,it,expect,vi} from 'vitest';
import {readRankEligibility} from '../src/rank';
const usd=(n:number)=>BigInt(n)*10n**18n;
function vault(){return {qualifiedDirects:vi.fn(async()=>4n),tierConfig:vi.fn(async()=>({requiredDirect:4n,requiredSalesUsd:usd(2500)})),networkBranchCount:vi.fn(async()=>5n),ACTIVE_DIRECT_USD:vi.fn(async()=>usd(100)),branchCapBps:vi.fn(async()=>6000n),rankVolumePage:vi.fn(async()=>({eligibleUsd:usd(2481),next:5n}))};}
describe('rank eligibility read from contract',()=>{
 it('shows the checked wallet scenario as four directs but 19 USD short',async()=>{
  const v=vault(),r=await readRankEligibility(v as any,'who',0,123);
  expect(r.qualified).toBe(4n);expect(r.missing).toBe(usd(19));expect(r.minimum).toBe(usd(100));
  for(const fn of Object.values(v))for(const call of fn.mock.calls)expect(call.at(-1)).toEqual({blockTag:123});
 });
 it('sums pages and clips at the target instead of reporting a negative shortfall',async()=>{
  const v=vault();v.networkBranchCount=vi.fn(async()=>100n);v.rankVolumePage=vi.fn(async(_who,_target,start)=>({eligibleUsd:usd(1500),next:start+64n}));
  const r=await readRankEligibility(v as any,'who',0,123);expect(r.volume).toBe(usd(2500));expect(r.missing).toBe(0n);expect(v.rankVolumePage).toHaveBeenCalledTimes(2);
 });
});
