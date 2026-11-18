import {BrowserProvider,Interface,getAddress,toQuantity,type Eip1193Provider,type TransactionReceipt} from 'ethers';
import {checkV3GroupBranches,checkedGas,groupEventMatches,submitVerified,type V3Action,type V3TransactionProgressCallback} from './v3-actions';
import {V3_ABI,v3ReadSession} from './v3-chain';
import type {V3SiteReleaseConfig} from './v3-site-config';

type GroupAction=Extract<V3Action,{kind:'createRewardGroup'|'addRewardBranches'}>;
type StageAction=Extract<V3Action,{kind:'prepareNetworkReward'|'claimNetworkRewards'}>;
type NetworkAction=GroupAction|StageAction;
const events=new Interface(V3_ABI);
const isGroup=(action:NetworkAction):action is GroupAction=>
 action.kind==='createRewardGroup'||action.kind==='addRewardBranches';
export const isUnifiedNetworkAction=(action:{kind:string}):action is NetworkAction=>
 ['createRewardGroup','addRewardBranches','prepareNetworkReward','claimNetworkRewards'].includes(action.kind);

export function networkActionTarget(config:V3SiteReleaseConfig,action:NetworkAction){
 if(!config.unified)throw Error('The verified unified testnet contract is required.');
 return isGroup(action)?config.unified.network:config.address;
}

function verifyStageReceipt(receipt:TransactionReceipt,action:StageAction,wallet:string,config:V3SiteReleaseConfig){
 const logs=(emitter:string,name:string)=>receipt.logs.flatMap(log=>{
  if(getAddress(log.address)!==getAddress(emitter))return [];
  const event=events.parseLog({topics:log.topics,data:log.data});
  return event?.name===name&&getAddress(event.args.user)===wallet&&event.args.group===BigInt(action.group)?[event]:[];
 });
 if(action.kind==='prepareNetworkReward'){
  const prepared=logs(config.unified!.network,'NetworkRewardPrepared');
  return prepared.length===1&&prepared[0].args.stage===BigInt(action.stage);
 }
 const earned=logs(config.unified!.network,'NetworkRewardEarned');
 const accrued=logs(config.address,'NetworkClaimAccrued');
 return earned.length===action.count&&earned.every((event,i)=>event.args.stage===BigInt(action.stage+i)&&event.args.rewardUsd>0n)&&
  accrued.length===1&&accrued[0].args.stages===BigInt(action.count)&&
  accrued[0].args.amount===earned.reduce((sum,event)=>sum+BigInt(event.args.rewardUsd),0n);
}

export async function sendUnifiedNetworkAction(walletProvider:Eip1193Provider,wallet:string,
 action:NetworkAction,config:V3SiteReleaseConfig,options:{enabled?:boolean;onProgress?:V3TransactionProgressCallback}={}){
 if(options.enabled!==true)throw Error('The unified testnet preview is read-only.');
 if(!isUnifiedNetworkAction(action))throw Error('Select a supported network action.');
 const to=networkActionTarget(config,action),who=getAddress(wallet);
 const notify=(step:'preflight'|'simulation')=>{
  try{options.onProgress?.({step,action:'network_group'});}catch{/* Ignore presentation errors. */}
 };
 notify('preflight');
 const session=await v3ReadSession(walletProvider,who,config,true);
 let browser:BrowserProvider|undefined;
 try{
  const {vault,network,provider,block}=session,at=session.options;
  if(await vault.paused(at))throw Error('Network actions are paused on the test contract.');
  if(action.kind!=='createRewardGroup'){
   if(!Number.isSafeInteger(action.group)||action.group<0||BigInt(action.group)>=await network.rewardGroupCount(who,at))
    throw Error('Refresh the team and select a current reward group.');
   if(!isGroup(action)&&(!Number.isSafeInteger(action.stage)||action.stage<0||action.stage>=14))
    throw Error('Invalid network reward stage.');
   const state=await network.rewardProgress(who,action.group,at);
   if(state.stage>=14n||(!isGroup(action)&&state.stage!==BigInt(action.stage)))
    throw Error('The group reward stage changed. Refresh the team before continuing.');
  }
  let args:unknown[];
  if(isGroup(action)){
   await checkV3GroupBranches(vault,who,action.branches,at,network);
   args=action.kind==='createRewardGroup'?[action.branches]:[action.group,action.branches];
  }else if(action.kind==='prepareNetworkReward'){
   if(!Number.isSafeInteger(action.steps)||action.steps<1||action.steps>64)throw Error('Invalid network preparation size.');
   args=[action.group,action.stage,action.steps];
  }else{
   if(!Number.isSafeInteger(action.count)||action.count<1||action.stage+action.count>14)throw Error('Invalid network stage count.');
   if(!await vault.isEligible(who,at))throw Error('This account is not currently eligible to claim a network reward.');
   args=[action.group,action.stage,action.count];
  }
  notify('simulation');
  const gas=await checkedGas(session,isGroup(action)?network:vault,action.kind,args,who);
  const canonical=await provider.send('eth_getBlockByNumber',[toQuantity(block.number),false]);
  if(!block.hash||String(canonical?.hash).toLowerCase()!==block.hash.toLowerCase())
   throw Error('The verified network block changed. Refresh the team before continuing.');
  browser=new BrowserProvider(walletProvider,undefined,{cacheTimeout:-1});
  const signer=await browser.getSigner(who),data=events.encodeFunctionData(action.kind,args);
  const receipt=await submitVerified(walletProvider,who,signer,config,to,data,gas,'Team reward','network_group',options.onProgress);
  if(!(isGroup(action)?groupEventMatches(receipt,to,who,action):verifyStageReceipt(receipt,action,who,config)))
   throw Error('Team transaction '+receipt.hash+' was confirmed but its reward event could not be verified. Check wallet history before retrying.');
  return receipt.hash;
 }finally{browser?.destroy();session.provider.destroy();}
}
