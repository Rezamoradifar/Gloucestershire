import {getAddress,isAddress,ZeroAddress,type Contract} from 'ethers';
import {session} from './chain';

export const BRANCH_PAGE=12n,GROUP_PAGE=4n;
export type NetworkAction=
 | {kind:'create';branches:string[]}
 | {kind:'append';group:bigint;branches:string[]}
 | {kind:'prepare'|'claim';group:bigint;stage:number};
export type NetworkGroup={id:bigint;stage:number;prepared:bigint;cursor:bigint;branches:bigint;eligibleUsd?:bigint;claimAmount:bigint|null;quoteError:string};
export type NetworkPage={rewardBudget:bigint;treasuryCash:bigint;tokenDecimals:number;salesModel:bigint;block:number;qualified:bigint;branchCount:bigint;groupCount:bigint;paused:boolean;registered:boolean;tiers:bigint[][];stages:{goal:bigint;reward:bigint;cap:bigint}[];branches:{address:string;volume:bigint;grouped:boolean}[];groups:NetworkGroup[]};

export function parseBranches(value:string):string[]{
 const branches=value.trim().split(/[\s,،;]+/).filter(Boolean);
 if(!branches.length||branches.length>64)throw Error('Enter between 1 and 64 direct branch addresses per transaction. More branches can be added later.');
 if(branches.some(b=>!isAddress(b)||b===ZeroAddress))throw Error('Every branch must be a valid nonzero wallet address.');
 const normalized=branches.map(getAddress);
 if(new Set(normalized.map(b=>b.toLowerCase())).size!==normalized.length)throw Error('A branch can only be listed once.');
 return normalized;
}
async function requireVersion(vault:Contract,options:Record<string,unknown>={}){
 let version:bigint;
 try{version=await vault.NETWORK_PLAN_VERSION(options);}catch{throw Error('This contract does not support the updated network controls. Connect the reviewed new deployment.');}
 if(version!==2n)throw Error('This network-plan version is not supported by this client.');
}
export async function readSalesModel(vault:Contract,options:Record<string,unknown>):Promise<bigint>{
 try{return await vault.SALES_REFERRAL_MODEL_VERSION(options);}catch(e){if((e as {code?:string}).code==='CALL_EXCEPTION')return 1n;throw e;}
}
export function rewardBlockers(page:Pick<NetworkPage,'paused'|'rewardBudget'|'treasuryCash'>,group:NetworkGroup,goal:bigint):string[]{
 const reasons:string[]=[];
 if(page.paused)reasons.push('Reward claims are paused.');
 if((group.eligibleUsd??group.prepared)<goal)reasons.push('More eligible branch volume or batch preparation is needed for this stage.');
 if(group.claimAmount===null)reasons.push(group.quoteError||'Reward conversion is unavailable.');
 else {if(group.claimAmount===0n)reasons.push('The converted reward is too small.');if(page.rewardBudget<group.claimAmount)reasons.push('The system reward budget needs funding.');if(page.treasuryCash<group.claimAmount)reasons.push('The treasury needs additional USDT cash.');}
 return reasons;
}
export async function readNetworkPage(vault:Contract,who:string,block:number,branchStart=0n,groupStart=0n):Promise<NetworkPage>{
 const options={blockTag:block};await requireVersion(vault,options);
 const token=await vault.usdt(options);
 const [ledger,treasuryCash,tokenDecimals,salesModel]=await Promise.all([vault.ledgers(token,options),vault.assetBalance(token,options),vault.tokenDecimals(options),readSalesModel(vault,options)]);
 const [qualified,branchCount,groupCount,paused,user,tiers,stages]=await Promise.all([
  vault.qualifiedDirects(who,options),vault.networkBranchCount(who,options),vault.rewardGroupCount(who,options),vault.paused(options),vault.users(who,options),
  Promise.all(Array.from({length:5},async(_,i)=>Array.from((await vault.tierConfig(i,options)).referrals) as bigint[])),
  Promise.all(Array.from({length:14},async(_,i)=>{const s=await vault.rewardStage(i,options);return {goal:s.volumeUsd,reward:s.rewardUsd,cap:await vault.branchCapBps(s.volumeUsd,options)};}))
 ]);
 const branchLength=Number(branchCount>branchStart?(branchCount-branchStart<BRANCH_PAGE?branchCount-branchStart:BRANCH_PAGE):0n);
 const groupLength=Number(groupCount>groupStart?(groupCount-groupStart<GROUP_PAGE?groupCount-groupStart:GROUP_PAGE):0n);
 const [branches,groups]=await Promise.all([
  Promise.all(Array.from({length:branchLength},async(_,i)=>{const address=await vault.networkBranch(who,branchStart+BigInt(i),options);const [volume,grouped]=await Promise.all([vault.branchVolumeUsd(who,address,options),vault.groupedBranch(who,address,options)]);return {address,volume,grouped};})),
  Promise.all(Array.from({length:groupLength},async(_,i)=>{const id=groupStart+BigInt(i),g=await vault.rewardProgress(who,id,options);let claimAmount:bigint|null=null,quoteError='';if(Number(g.stage)<14){try{claimAmount=await vault.quoteAsset(token,stages[Number(g.stage)].reward,options);}catch(e){if((e as {code?:string}).code!=='CALL_EXCEPTION')throw e;quoteError='The contract cannot quote this reward. Its price feed may be invalid or stale.';}}let eligibleUsd:bigint|undefined;if(Number(g.stage)<14&&g.branches<=64n){const preview=await vault.rewardPreview(who,id,options);eligibleUsd=Array.from(preview.consume as bigint[]).reduce((n,v)=>n+v,0n);}return {id,stage:Number(g.stage),prepared:g.preparedUsd,cursor:g.cursor,branches:g.branches,eligibleUsd,claimAmount,quoteError};}))
 ]);
 return {rewardBudget:ledger.rewards,treasuryCash,tokenDecimals:Number(tokenDecimals),salesModel,block,qualified,branchCount,groupCount,paused,registered:user.registered,tiers,stages,branches,groups};
}
export async function loadNetwork(who:string,branchStart:bigint,groupStart:bigint){
 const {vault,provider}=await session(who);const block=await provider.getBlock('latest');if(!block)throw Error('Could not load the latest block.');
 return readNetworkPage(vault,who,block.number,branchStart,groupStart);
}
export function networkCall(action:NetworkAction):{method:string;args:unknown[]}{
 if(action.kind==='create')return {method:'createRewardGroup',args:[parseBranches(action.branches.join(' '))]};
 if(action.group<0n)throw Error('Invalid reward group.');
 if(action.kind==='append')return {method:'addRewardBranches',args:[action.group,parseBranches(action.branches.join(' '))]};
 if(!Number.isInteger(action.stage)||action.stage<0||action.stage>=14)throw Error('This reward stage has finished or is invalid.');
 return action.kind==='prepare'?{method:'prepareNetworkRewardAtStage',args:[action.group,action.stage,64]}:{method:'claimNetworkRewardAtStage',args:[action.group,action.stage]};
}
export async function executeNetwork(action:NetworkAction,who:string,onStatus:(message:string,hash?:string)=>void){
 const {method,args}=networkCall(action);
 const {vault}=await session(who);await requireVersion(vault);
 onStatus('Checking the selected network action');await vault[method].staticCall(...args);await session(who);
 onStatus('Confirm the network action in your wallet');const sent=await vault[method](...args);onStatus('Waiting for network confirmation',sent.hash);
 try{const receipt=await sent.wait();if(!receipt||receipt.status!==1)throw Error('The network action failed.');return receipt.hash as string;}
 catch(e:unknown){const x=e as {code?:string;cancelled?:boolean;receipt?:{status:number;hash:string}};if(x.code==='TRANSACTION_REPLACED'&&!x.cancelled&&x.receipt?.status===1)return x.receipt.hash;throw e;}
}
