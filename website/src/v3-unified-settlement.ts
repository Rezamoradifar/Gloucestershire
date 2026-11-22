// User requests and operator settlement against the independently verified test release.
import {BrowserProvider,Contract,getAddress,type Eip1193Provider,type LogDescription} from 'ethers';
import {checkedGas,submitVerified,type V3Action,type V3TransactionProgressCallback} from './v3-actions';
import {v3ReadSession,V3_TEST_TOKEN_ABI} from './v3-chain';
import {V3_TEST_TOKEN,type V3SiteReleaseConfig} from './v3-site-config';

type Request=Extract<V3Action,{kind:'requestProfit'|'requestPrincipal'|'requestReferral'|'requestNetworkReward'}>;
type Settlement=Extract<V3Action,{kind:'approveWithdrawal'|'rejectWithdrawal'|'reserveExistingCash'|'payWithdrawal'}>|
 {kind:'fundPlanReserve';gross:bigint}|{kind:'cancelWithdrawal';id:number}|{kind:'fundWithdrawal';id:number;gross:bigint;beneficiary:string};
export type UnifiedWithdrawal=Request|Settlement;
const requestKind={requestProfit:0,requestPrincipal:1,requestReferral:2,requestNetworkReward:3} as const;

export function isUnifiedWithdrawal(action:V3Action|UnifiedWithdrawal):action is UnifiedWithdrawal{
 return Object.hasOwn(requestKind,action.kind)||['approveWithdrawal','rejectWithdrawal','reserveExistingCash',
  'fundWithdrawal','payWithdrawal','cancelWithdrawal','fundPlanReserve'].includes(action.kind);
}
export async function sendUnifiedWithdrawal(provider:Eip1193Provider,wallet:string,action:UnifiedWithdrawal,
 config:V3SiteReleaseConfig|null,options:{enabled:boolean;onProgress?:V3TransactionProgressCallback}){
 if(!options.enabled||!config?.unified)throw Error('The unified testnet preview is read-only.');
 const who=getAddress(wallet);
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
  const args=action.kind==='fundPlanReserve'?[action.gross]:'id' in action?[action.id]:'positionId' in action?[action.positionId,action.amount]:[action.amount];
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
   }else if('amount' in action){
    const kind=requestKind[action.kind],fee=action.amount*(kind===1?3000n:300n)/10000n;
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
     case 'payWithdrawal':find('WithdrawalPaid',({args:a})=>a.id===id&&getAddress(a.beneficiary)===getAddress(row.beneficiary)&&
      a.net===row.gross-row.fee&&a.fee===row.fee);break;
    }
   }
  }catch{throw Error('Test withdrawal transaction '+receipt.hash+' was confirmed but its event could not be verified. Check wallet history before retrying.');}
  return receipt.hash;
 }catch(error){
  if(approvalHash)throw Error((error instanceof Error?error.message:'Funding incomplete.')+' Last confirmed allowance: '+approvalHash+'. Check wallet history before retrying.');
  throw error;
 }finally{session.provider.destroy();browser.destroy();}
}
