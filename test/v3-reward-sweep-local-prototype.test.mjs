import assert from 'node:assert/strict';
import test from 'node:test';
import {Interface,getAddress} from 'ethers';
import {runLocalSimulationSweep,scanRewardStages} from '../scripts/v3-reward-sweep-local-prototype.mjs';

const addresses=[1,2,3].map(n=>getAddress('0x'+String(n).padStart(40,'0')));
const target=getAddress('0x'+'a'.repeat(40));
const reverted=()=>Object.assign(new Error('revert'),{code:'CALL_EXCEPTION',data:'0x12345678'});
function fake(groups,eligible=[true,true,true],enabled=[true,true,true]){
 const state={paused:false,groups,calls:[]};
 const vault={target,paused:async()=>state.paused,memberCount:async()=>BigInt(addresses.length),
  memberAt:async i=>addresses[i],isEligible:async who=>eligible[addresses.indexOf(who)],
  autoNetworkEnabled:async who=>enabled[addresses.indexOf(who)],
  rewardGroupCount:async who=>BigInt(state.groups[addresses.indexOf(who)].length),
  rewardProgress:async(who,i)=>state.groups[addresses.indexOf(who)][i],
  claimNetworkRewardsFor:{staticCall:async(who,i,stage)=>{
   state.calls.push([who,i,stage]);
   const item=state.groups[addresses.indexOf(who)][i];
   if(item.error)throw item.error;
   if(!item.ready||item.stage!==stage)throw reverted();
  }}
 };
 return {state,vault};
}
const item=(stage,branches,ready=false)=>({stage,branches,ready});
test('bounded round-robin scan skips incomplete, opted-out and non-ready stages',async()=>{
 const {state,vault}=fake([[item(0,2,true),item(1,3,false),item(2,3,true)],
  [item(0,3,true)],[item(0,3,true)]],[true,true,true],[true,false,true]);
 const one=await scanRewardStages(vault,{member:0,group:0},{maxMembers:3,maxGroups:2});
 assert.deepEqual(one,{status:'NO_READY_STAGE',members:3,scannedGroups:2,next:{member:0,group:2}});
 const two=await scanRewardStages(vault,one.next,{maxMembers:3,maxGroups:2});
 assert.equal(two.status,'READY');assert.deepEqual(two.candidate,{who:addresses[0],group:2,stage:2,count:1});
 assert.deepEqual(two.next,{member:1,group:0});
 const three=await scanRewardStages(vault,two.next,{maxMembers:3,maxGroups:2});
 assert.equal(three.candidate.who,addresses[2]);
 state.paused=true;assert.equal((await scanRewardStages(vault,{member:0,group:0})).status,'PAUSED');
 await assert.rejects(scanRewardStages(vault,{member:-1,group:0}),/INVALID_REWARD_CURSOR/);
 await assert.rejects(scanRewardStages(vault,{member:0,group:0},{maxGroups:129}),/INVALID_REWARD_SCAN_BOUNDS/);
});
test('network failure is not silently reported as an ineligible stage',async()=>{
 const {vault}=fake([[{...item(0,3,true),error:Object.assign(new Error('offline'),{code:'NETWORK_ERROR'})}],[],[]]);
 vault.isEligible=async()=>true;vault.autoNetworkEnabled=async()=>true;
 await assert.rejects(scanRewardStages(vault,{member:0,group:0}),/offline/);
});
test('only exact successful event commits cursor; unknown send leaves intent',async()=>{
 const {vault}=fake([[item(0,3,true)],[],[]]);
 let pending=null,committed=null;
 const journal={begin:async v=>{if(pending)throw Error('PENDING_REQUIRES_REVIEW');pending=v;},
  commit:async v=>{committed=v;pending=null;}};
 const cursor={member:0,group:0};
 await assert.rejects(runLocalSimulationSweep({vault,cursor,journal,send:async()=>{throw Error('timeout');}}),/timeout/);
 assert.ok(pending);assert.equal(committed,null);
 await assert.rejects(runLocalSimulationSweep({vault,cursor,journal,send:async()=>{throw Error('must not send');}}),/PENDING_REQUIRES_REVIEW/);
 pending=null;
 const iface=new Interface(['event NetworkClaimAccrued(address indexed user,uint256 indexed group,uint256 amount,uint8 stages)']);
 const event=iface.encodeEventLog(iface.getEvent('NetworkClaimAccrued'),[addresses[0],0,35n,1]);
 const receipt={status:1,hash:'0x'+'1'.repeat(64),logs:[{address:target,...event}]};
 const result=await runLocalSimulationSweep({vault,cursor,journal,send:async()=>receipt});
 assert.equal(result.status,'CONFIRMED_LOCAL_SIMULATION');assert.equal(result.amount,35n);
 assert.equal(committed.item.who,addresses[0]);assert.equal(pending,null);
});
