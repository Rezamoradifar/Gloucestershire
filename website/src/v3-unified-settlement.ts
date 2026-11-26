// User requests and operator settlement against the independently verified test release.
import {BrowserProvider,Contract,getAddress,type Eip1193Provider,type LogDescription} from 'ethers';
import {checkedGas,submitVerified,type V3Action,type V3TransactionProgressCallback} from './v3-actions';
import {v3ReadSession,V3_TEST_TOKEN_ABI,type V3Withdrawal} from './v3-chain';
import {V3_TEST_TOKEN,type V3SiteReleaseConfig} from './v3-site-config';
import {verifyPortfolioPayout} from '../../server/portfolio-payout.mjs';
import {readVerifiedWithdrawal} from './v3-withdrawal-history';
import {v3WithdrawalFee} from './v3-withdrawal-form';

import type {PortfolioAction} from './v3-portfolio';

type Request=Extract<V3Action,{kind:'requestProfit'|'requestPrincipal'|'requestReferral'|'requestNetworkReward'}>;
type Settlement=Extract<V3Action,{kind:'approveWithdrawal'|'rejectWithdrawal'|'reserveExistingCash'|'payWithdrawal'}>|
 {kind:'fundPlanReserve';gross:bigint}|{kind:'cancelWithdrawal';id:number}|{kind:'fundWithdrawal';id:number;gross:bigint;beneficiary:string};
export type UnifiedWithdrawal=Request|PortfolioAction|Settlement;
const requestKind={requestProfit:0,requestPrincipal:1,requestReferral:2,requestNetworkReward:3} as const;

export function isUnifiedWithdrawal(action:V3Action|UnifiedWithdrawal):action is UnifiedWithdrawal{
 return action.kind==='requestAccountWithdrawal'||Object.hasOwn(requestKind,action.kind)||['approveWithdrawal','rejectWithdrawal','reserveExistingCash',
  'fundWithdrawal','payWithdrawal','cancelWithdrawal','fundPlanReserve'].includes(action.kind);
}
// The on-chain reject method accepts more than one state; compare the exact
// state shown in the operator's review immediately before each wallet prompt.
export async function recheckOperatorWithdrawal(vault:Contract,who:string,portfolio:boolean,action:UnifiedWithdrawal,
 reviewed:V3Withdrawal,block:number){
 if(!('id' in action)||action.id!==reviewed.id)throw Error('The reviewed withdrawal does not match this action.');
 const at={blockTag:block};
 const isManager=action.kind!=='fundWithdrawal'&&await vault.hasRole(await vault.MANAGER_ROLE(at),who,at);
 const isFunder=(action.kind==='payWithdrawal'||action.kind==='fundWithdrawal')&&
  await vault.hasRole(await vault.FUNDER_ROLE(at),who,at);
 if(!isManager&&!isFunder)throw Error('Your settlement role changed. Refresh the queue.');
 const latest=await readVerifiedWithdrawal(vault,action.id,at,portfolio);
 const sources=['personal','referral','network','principal'] as const;
 if(latest.beneficiary!==reviewed.beneficiary||latest.status!==reviewed.status||latest.kind!==reviewed.kind||
   latest.gross!==reviewed.gross||latest.fee!==reviewed.fee||sources.some(key=>latest.allocation?.[key]!==reviewed.allocation?.[key]))
  throw Error('This withdrawal changed after review. Refresh the queue before signing.');
}

export async function sendUnifiedWithdrawal(provider:Eip1193Provider,wallet:string,action:UnifiedWithdrawal,
 config:V3SiteReleaseConfig|null,options:{enabled:boolean;onProgress?:V3TransactionProgressCallback;reviewedRequest?:V3Withdrawal}){
 if(!options.enabled||!config?.unified)throw Error('The unified testnet preview is read-only.');
 const who=getAddress(wallet);
 if(action.kind==='requestAccountWithdrawal'){
  const p=action.parts;
  if(!config.unified.portfolio||[p.personal,p.referral,p.network,p.principal].some(v=>v<0n)||
   p.personal+p.referral+p.network+p.principal!==action.amount||
   ![action.profitStart,action.principalStart].every(v=>Number.isSafeInteger(v)&&v>=0))
   throw Error('The combined withdrawal allocation is invalid for this account.');
 }else if(config.unified.portfolio&&'amount' in action)throw Error('Use the combined withdrawal form on this contract.');
 if(action.kind==='fundPlanReserve'&&(!config.unified.dailyPlan||action.gross<=0n))throw Error('A positive amount and a verified daily plan are required.');
 if('id' in action&&(!Number.isSafeInteger(action.id)||action.id<0))throw Error('Invalid withdrawal request ID.');
 if('amount' in action&&action.amount<=0n)throw Error('Enter a positive USDT amount.');
 if('positionId' in action&&(!Number.isSafeInteger(action.positionId)||action.positionId<0))throw Error('Invalid position ID.');
 const review=async()=>v3ReadSession(provider,who,config,true);
 let session=await review();
 const browser=new BrowserProvider(provider,undefined,{cacheTimeout:-1});
 const step='amount' in action?'withdrawal_request':'withdrawal_settlement';
 let approvalHash='';
 try{
  const signer=await browser.getSigner(who);
  async function submit(contract:Contract,name:string,args:unknown[],label:string,operation:typeof step|'allowance_reset'|'token_approval'=step){
   options.onProgress?.({step:'simulation',action:operation});
   const gas=await checkedGas(session,contract,name,args,who);
   if(options.reviewedRequest){
    const head=await session.provider.getBlockNumber();
    if(head<session.block.number)throw Error('Unable to verify the latest settlement block.');
    await recheckOperatorWithdrawal(session.vault,who,Boolean(config!.unified?.portfolio),action,options.reviewedRequest,head);
   }
   return submitVerified(provider,who,signer,config!,await contract.getAddress(),
    contract.interface.encodeFunctionData(name,args),gas,label,operation,options.onProgress);
  }
  const token=()=>new Contract(V3_TEST_TOKEN,V3_TEST_TOKEN_ABI,session.provider);
  if(action.kind==='fundWithdrawal'||action.kind==='fundPlanReserve'){
   const funding=action,gross=funding.gross;
   async function checkFunding(){
    const {vault,options:at}=session;
    const [role,balance,allowance]=await Promise.all([vault.FUNDER_ROLE(at),
     token().balanceOf(who,at),token().allowance(who,config!.address,at)]);
    if(!await vault.hasRole(role,who,at))throw Error('This wallet does not hold the test funding role.');
    if(gross<=0n||BigInt(balance)<gross)throw Error('The funding wallet has insufficient test tokens.');
    if(funding.kind==='fundWithdrawal'){
     const row=await vault.withdrawalOf(funding.id,at);
     if(Number(row.status)!==1||BigInt(row.gross)!==gross||getAddress(row.beneficiary)!==getAddress(funding.beneficiary))
      throw Error('The approved request or beneficiary does not match the review.');
    }
    return BigInt(allowance);
   }
   let allowance=await checkFunding();
   if(allowance<gross){
    const amounts=allowance>0n?[0n,gross]:[gross];
    for(const next of amounts){
     const receipt=await submit(token(),'approve',[config.address,next],'Test funding allowance',next===0n?'allowance_reset':'token_approval');
     approvalHash=receipt.hash;
     session.provider.destroy();session=await review();
     allowance=await checkFunding();
     if(allowance!==next)throw Error('Exact test funding allowance could not be verified.');
    }
   }
  }
  const {vault}=session;
  if('positionId' in action&&BigInt(await vault.reinvestmentPositionPlusOne(who,session.options))===BigInt(action.positionId)+1n)
   throw Error('Select the reinvestment additions page to request profit or principal from that position.');
  const row='id' in action?await vault.withdrawalOf(action.id,session.options):null;
  const args=action.kind==='requestAccountWithdrawal'?[action.parts,action.profitStart,action.principalStart]:action.kind==='fundPlanReserve'?[action.gross]:'id' in action?[action.id]:'positionId' in action?[action.positionId,action.amount]:[action.amount];
  const receipt=await submit(vault,action.kind,args,action.kind==='fundPlanReserve'?'Fund plan reserve':'Test withdrawal');
  try{
   const logs=receipt.logs.flatMap(log=>{
    if(getAddress(log.address)!==config.address)return [];
    try{const event=vault.interface.parseLog({topics:log.topics,data:log.data});return event?[event]:[];}catch{return [];}
   });
   function find(name:string,match:(event:LogDescription)=>boolean){
    if(logs.filter(event=>event.name===name&&match(event)).length!==1)throw Error('Withdrawal event mismatch.');
   }
   if(action.kind==='fundPlanReserve'){
    find('PlanReserveFunded',({args:a})=>getAddress(a.funder)===who&&a.amount===action.gross);
   }else if(action.kind==='requestAccountWithdrawal'){
    const p=action.parts;
    const fee=v3WithdrawalFee(action.amount-p.principal,false,true)+v3WithdrawalFee(p.principal,true);
    const requests=logs.filter(e=>e.name==='WithdrawalRequested');
    if(requests.length!==1)throw Error('Expected one withdrawal request.');
    const a=requests[0].args;
    if(getAddress(a.user)!==who||a.kind!==4n||a.gross!==action.amount||a.fee!==fee)throw Error('Combined withdrawal amount mismatch.');
    find('AccountWithdrawalAllocated',({args:b})=>b.id===a.id&&getAddress(b.user)===who&&b.personal===p.personal&&
     b.referral===p.referral&&b.network===p.network&&b.principal===p.principal);
   }else if('amount' in action){
    const kind=requestKind[action.kind],fee=v3WithdrawalFee(action.amount,kind===1,config.unified.manualReinvest);
    find('WithdrawalRequested',({args:a})=>getAddress(a.user)===who&&Number(a.kind)===kind&&a.gross===action.amount&&a.fee===fee);
    // The canonical transaction, including its exact position, was checked by submitVerified.
   }else{
    const id=BigInt(action.id);
    switch(action.kind){
     case 'approveWithdrawal':find('WithdrawalApproved',({args:a})=>a.id===id&&getAddress(a.manager)===who);break;
     case 'rejectWithdrawal':case 'cancelWithdrawal':
      find('WithdrawalReleased',({args:a})=>a.id===id&&Number(a.status)===(action.kind==='rejectWithdrawal'?4:5));break;
     case 'fundWithdrawal':find('WithdrawalEscrowFunded',({args:a})=>a.id===id&&getAddress(a.funder)===who&&a.gross===action.gross);break;
     case 'reserveExistingCash':find('WithdrawalExistingCashReserved',({args:a})=>a.id===id&&a.gross===row.gross);break;
     case 'payWithdrawal':
      verifyPortfolioPayout(receipt,{vault:config.address,token:V3_TEST_TOKEN,feeReceiver:await vault.feeReceiver(session.options),
       beneficiary:row.beneficiary,id:action.id,gross:row.gross,fee:row.fee});break;
    }
   }
  }catch{throw Error('Test withdrawal transaction '+receipt.hash+' was confirmed but its event could not be verified. Check wallet history before retrying.');}
  return receipt.hash;
 }catch(error){
  if(approvalHash)throw Error((error instanceof Error?error.message:'Funding incomplete.')+' Last confirmed allowance: '+approvalHash+'. Check wallet history before retrying.');
  throw error;
 }finally{session.provider.destroy();browser.destroy();}
}
