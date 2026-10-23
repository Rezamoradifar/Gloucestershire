import {describe,it,expect,vi} from 'vitest';
import {parseBranches,networkCall,readNetworkPage,readSalesModel,rewardBlockers} from '../src/network';
const address=(n:number)=>'0x'+n.toString(16).padStart(40,'0');
describe('Network wallet requests',()=>{
 it('rejects zero, invalid, duplicate and over-size branch batches',()=>{
  for(const s of ['',address(0),'oops',`${address(1)} ${address(1)}`,Array.from({length:65},(_,i)=>address(i+1)).join(' ')])expect(()=>parseBranches(s)).toThrow();
  expect(parseBranches(`${address(1)}\u060c\n${address(2)}`)).toHaveLength(2);
 });
 it('binds both reservation and claim requests to the reviewed group and stage',()=>{
  expect(networkCall({kind:'prepare',group:4n,stage:7})).toEqual({method:'prepareNetworkRewardAtStage',args:[4n,7,64]});
  expect(networkCall({kind:'claim',group:4n,stage:7})).toEqual({method:'claimNetworkRewardAtStage',args:[4n,7]});
  expect(()=>networkCall({kind:'claim',group:0n,stage:14})).toThrow();
  expect(()=>networkCall({kind:'append',group:-1n,branches:[address(1)]})).toThrow();
 });
 it('reads a bounded page from a 10000-branch network at one pinned block',async()=>{
  const options={blockTag:123};const v:any={};
  v.NETWORK_PLAN_VERSION=vi.fn(async()=>2n);v.AUTO_REWARD_GROUP_VERSION=vi.fn(async()=>1n);v.qualifiedDirects=vi.fn(async()=>12n);v.networkBranchCount=vi.fn(async()=>10000n);v.rewardGroupCount=vi.fn(async()=>10000n);v.paused=vi.fn(async()=>false);v.users=vi.fn(async()=>({registered:true}));
  v.usdt=vi.fn(async()=>address(99));v.ledgers=vi.fn(async()=>({rewards:100n}));v.assetBalance=vi.fn(async()=>100n);v.tokenDecimals=vi.fn(async()=>18n);v.SALES_REFERRAL_MODEL_VERSION=vi.fn(async()=>2n);v.quoteAsset=vi.fn(async()=>35n);v.rewardPreview=vi.fn(async()=>({consume:[300n,200n]}));
  v.tierConfig=vi.fn(async()=>({referrals:[800n,400n,200n,0n]}));v.rewardStage=vi.fn(async()=>({volumeUsd:500n,rewardUsd:35n}));v.branchCapBps=vi.fn(async()=>6000n);
  v.networkBranch=vi.fn(async(_:string,index:bigint)=>address(Number(index+1n)));v.branchVolumeUsd=vi.fn(async()=>500n);v.groupedBranch=vi.fn(async()=>false);v.rewardProgress=vi.fn(async()=>({stage:0n,preparedUsd:0n,cursor:0n,branches:2n}));
  const result=await readNetworkPage(v,address(7),123,12n,4n);
  expect(result.automaticGroup).toBe(true);
  expect(result.groups[0].eligibleUsd).toBe(500n);expect(result.branches).toHaveLength(12);expect(result.groups).toHaveLength(4);expect(result.groups[0].id).toBe(4n);expect(result.branches[0].address).toBe(address(13));
  expect(v.networkBranch).toHaveBeenCalledTimes(12);expect(v.rewardProgress).toHaveBeenCalledTimes(4);
  for(const fn of Object.values(v) as ReturnType<typeof vi.fn>[])for(const call of fn.mock.calls)expect(call.at(-1)).toEqual(options);
 });
 it('does not expose new controls for an old or unrecognized contract',async()=>{
  await expect(readNetworkPage({NETWORK_PLAN_VERSION:async()=>{throw Error('missing');}} as any,address(1),1)).rejects.toThrow('reviewed new deployment');
  await expect(readNetworkPage({NETWORK_PLAN_VERSION:async()=>1n} as any,address(1),1)).rejects.toThrow('not supported');
 });
});

describe('reward readiness and deployed sales model',()=>{
 const group={id:0n,stage:0,prepared:500n,cursor:0n,branches:2n,claimAmount:35n,quoteError:''};
 it('reports empty budget separately from sufficient volume and cash',()=>{
  expect(rewardBlockers({paused:false,rewardBudget:0n,treasuryCash:100n},group,500n)).toEqual(['The system reward budget needs funding.']);
  expect(rewardBlockers({paused:false,rewardBudget:35n,treasuryCash:35n},group,500n)).toEqual([]);
 });
 it('blocks stale quotes, insufficient cash, pause and unprepared volume',()=>{
  expect(rewardBlockers({paused:true,rewardBudget:35n,treasuryCash:0n},{...group,prepared:0n},500n)).toHaveLength(3);
  expect(rewardBlockers({paused:false,rewardBudget:100n,treasuryCash:100n},{...group,claimAmount:null,quoteError:'Stale oracle'},500n)).toEqual(['Stale oracle']);
 });
 it('recognizes legacy contracts but does not hide RPC failures as legacy',async()=>{
  expect(await readSalesModel({SALES_REFERRAL_MODEL_VERSION:async()=>{throw {code:'CALL_EXCEPTION'};}} as any,{})).toBe(1n);
  await expect(readSalesModel({SALES_REFERRAL_MODEL_VERSION:async()=>{throw Error('RPC unavailable');}} as any,{})).rejects.toThrow('RPC unavailable');
 });
});
