// Signed actions for ONLY the independently verified NEW V3 BNB TESTNET vault.
// No raw key storage, background privileged sender, automatic payouts, real USDT
// or transfer to an address supplied by anyone other than the contract.
import {
 BrowserProvider,Contract,Interface,ZeroAddress,getAddress,isAddress,
 type Eip1193Provider,type Log
} from 'ethers';
import {V3_TEST_TOKEN,type V3SiteReleaseConfig} from './v3-site-config';
import {V3_ABI,V3_TEST_TOKEN_ABI,v3ReadSession,v3ReleaseConfig,type V3Withdrawal} from './v3-chain';
const EVENTS=new Interface(V3_ABI);
export type V3Action=
 | {kind:'register';referrer:string}
 | {kind:'checkIn'}
 | {kind:'checkInAndAccrue';positionIds:number[]}
 | {kind:'requestProfit';positionId:number;amount:bigint}
 | {kind:'requestReferral';amount:bigint}
 | {kind:'requestPrincipal';positionId:number;amount:bigint}
 | {kind:'reinvest';positionId:number;amount:bigint}
 | {kind:'approveWithdrawal';id:number}
 | {kind:'rejectWithdrawal';id:number}
 | {kind:'reserveExistingCash';id:number}
 | {kind:'payWithdrawal';id:number};
const validIndex=(n:number)=>Number.isSafeInteger(n)&&n>=0;
const roleFor=(action:V3Action):'manager'|null=>
 ['approveWithdrawal','rejectWithdrawal','reserveExistingCash'].includes(action.kind)?'manager':null;
const eventMatches=(receipt:{logs:readonly Log[]},address:string,name:string,id:number,beneficiary?:string)=>{
 return receipt.logs.some(raw=>{
  if(raw.address.toLowerCase()!==address.toLowerCase())return false;
  try{
   const event=EVENTS.parseLog({topics:raw.topics,data:raw.data});
   if(event?.name!==name||BigInt(event.args.id)!==BigInt(id))return false;
   if(beneficiary&&name==='WithdrawalPaid'&&
      getAddress(event.args.beneficiary)!==beneficiary)return false;
   return true;
  }catch{return false;}
 });
};
export async function sendV3Action(walletProvider:Eip1193Provider,wallet:string,
 action:V3Action,config:V3SiteReleaseConfig|null=v3ReleaseConfig){
 const context=await v3ReadSession(walletProvider,wallet,config);
 const {vault,options}=context;
 let name:string,args:unknown[];
 let prior:V3Withdrawal|null=null;
 try{
  const role=roleFor(action);
  if(role){
   const manager=await vault.MANAGER_ROLE(options);
   if(!await vault.hasRole(manager,wallet,options))
    throw Error('Only the authorized V3 manager may confirm this operation.');
  }
  switch(action.kind){
   case 'register':
    if(!isAddress(action.referrer)||getAddress(action.referrer)===getAddress(wallet))
     throw Error('Choose a valid V3 referral address or the zero address.');
    name='register';args=[getAddress(action.referrer)];break;
   case 'checkIn':name='checkIn';args=[];break;
   case 'checkInAndAccrue':
    if(!action.positionIds.length||action.positionIds.length>20||
      action.positionIds.some(x=>!validIndex(x))||
      new Set(action.positionIds).size!==action.positionIds.length)
     throw Error('Choose up to 20 distinct due V3 positions.');
    name='checkInAndAccrue';args=[action.positionIds];break;
   case 'requestProfit':
   case 'requestPrincipal':
   case 'reinvest':
    if(!validIndex(action.positionId)||action.amount<=0n)
     throw Error('Invalid V3 position or positive amount.');
    name=action.kind;args=[action.positionId,action.amount];break;
   case 'requestReferral':
    if(action.amount<=0n)throw Error('Enter a positive referral claim.');
    name='requestReferral';args=[action.amount];break;
   case 'approveWithdrawal':
   case 'rejectWithdrawal':
   case 'reserveExistingCash':
   case 'payWithdrawal':{
    if(!validIndex(action.id))throw Error('Invalid V3 withdrawal ID.');
    const row=await vault.withdrawalOf(action.id,options);
    const expected=action.kind==='approveWithdrawal'||action.kind==='rejectWithdrawal'?0:1;
    if(action.kind==='rejectWithdrawal'&&Number(row.status)!==0&&Number(row.status)!==1)
     throw Error('V3 withdrawal can only be rejected before funding.');
    if(action.kind==='payWithdrawal'&&Number(row.status)!==2)
     throw Error('This V3 request has not yet received escrowed cash.');
    if(action.kind!=='rejectWithdrawal'&&action.kind!=='payWithdrawal'&&Number(row.status)!==expected)
     throw Error('V3 withdrawal status changed; refresh before confirming.');
    prior={id:action.id,beneficiary:getAddress(row.beneficiary),
     positionId:Number(row.positionId),gross:BigInt(row.gross),fee:BigInt(row.fee),
     requestedAt:Number(row.requestedAt),status:Number(row.status),kind:Number(row.kind)};
    name=action.kind;args=[action.id];break;
   }
  }
 }finally{context.provider.destroy();}
 if(!config)throw Error('V3 is not deployed.');
 // Wallet signer is never reused across a changed chain/account.
 await v3ReadSession(walletProvider,wallet,config).then(s=>s.provider.destroy());
 const provider=new BrowserProvider(walletProvider,undefined,{cacheTimeout:-1});
 try{
  const signer=await provider.getSigner(wallet);
  const writable=new Contract(config.address,V3_ABI,signer);
  await writable.getFunction(name).staticCall(...args);
  const sent=await writable.getFunction(name)(...args);
  const receipt=await sent.wait(5);
  if(!receipt||receipt.status!==1)throw Error('V3 TESTNET action was not confirmed on-chain.');
  if(action.kind==='payWithdrawal'&&prior&&
     !eventMatches(receipt,config.address,'WithdrawalPaid',prior.id,prior.beneficiary))
   throw Error('Payout receipt lacks the exact beneficiary and request. Inspect the transaction; do not retry blindly.');
  if(action.kind==='reserveExistingCash'&&prior&&
     !eventMatches(receipt,config.address,'WithdrawalExistingCashReserved',prior.id))
   throw Error('Existing cash reserve event not verified; review on chain.');
  return receipt.hash as string;
 }finally{provider.destroy();}
}
export async function sendV3TestTokenDeposit(walletProvider:Eip1193Provider,wallet:string,
 amount:bigint,referrer:string,config:V3SiteReleaseConfig|null=v3ReleaseConfig){
 if(!config||amount<10n**19n||!isAddress(referrer)||
  getAddress(referrer)===getAddress(wallet))
  throw Error('Invalid V3 TESTNET deposit, referrer, or unverified contract.');
 const s=await v3ReadSession(walletProvider,wallet,config);
 try{
  const token=new Contract(V3_TEST_TOKEN,V3_TEST_TOKEN_ABI,s.provider);
  const [balance,allowance,paused]=await Promise.all([
   token.balanceOf(wallet,s.options),token.allowance(wallet,config.address,s.options),
   s.vault.paused(s.options)
  ]);
  if(paused||balance<amount)throw Error('V3 testnet paused or wallet lacks actual TEST USDT tokens.');
  if(allowance<0n)throw Error('Invalid token allowance');
 }finally{s.provider.destroy();}
 const provider=new BrowserProvider(walletProvider,undefined,{cacheTimeout:-1});
 try{
  const signer=await provider.getSigner(wallet);
  const token=new Contract(V3_TEST_TOKEN,V3_TEST_TOKEN_ABI,signer);
  let allowance=BigInt(await token.allowance(wallet,config.address));
  if(allowance<amount){
   if(allowance>0n){
    const reset=await token.approve(config.address,0n);
    if((await reset.wait(5))?.status!==1)throw Error('TEST token allowance reset not confirmed.');
   }
   const approval=await token.approve(config.address,amount);
   if((await approval.wait(5))?.status!==1)throw Error('V3 TEST token approval not confirmed.');
  }
  const check=await v3ReadSession(walletProvider,wallet,config);
  try{
   const confirmedAllowance=BigInt(await new Contract(V3_TEST_TOKEN,V3_TEST_TOKEN_ABI,check.provider)
    .allowance(wallet,config.address,check.options));
   if(confirmedAllowance<amount)throw Error('Approved token allowance is not confirmed. Retry only after verifying the transaction.');
  }finally{check.provider.destroy();}
  const vault=new Contract(config.address,V3_ABI,signer);
  await vault.deposit.staticCall(amount,getAddress(referrer));
  const sent=await vault.deposit(amount,getAddress(referrer));
  const receipt=await sent.wait(5);
  if(!receipt||receipt.status!==1)throw Error('V3 TESTNET deposit did not confirm.');
  return receipt.hash as string;
 }finally{provider.destroy();}
}
export async function sendV3FundWithdrawal(walletProvider:Eip1193Provider,wallet:string,
 id:number,config:V3SiteReleaseConfig|null=v3ReleaseConfig){
 if(!config||!validIndex(id))throw Error('Valid V3 TESTNET withdrawal required.');
 const s=await v3ReadSession(walletProvider,wallet,config);
 let amount=0n,beneficiary='';
 try{
  const role=await s.vault.FUNDER_ROLE(s.options);
  if(!await s.vault.hasRole(role,wallet,s.options))
   throw Error('Only the V3 registered funding wallet may escrow test tokens.');
  const row=await s.vault.withdrawalOf(id,s.options);
  if(Number(row.status)!==1)throw Error('This withdrawal has not been approved or is already escrowed.');
  amount=BigInt(row.gross);beneficiary=getAddress(row.beneficiary);
  const balance=await new Contract(V3_TEST_TOKEN,V3_TEST_TOKEN_ABI,s.provider)
   .balanceOf(wallet,s.options);
  if(amount<=0n||BigInt(balance)<amount)throw Error('Funding wallet has insufficient actual TEST USDT.');
 }finally{s.provider.destroy();}
 const provider=new BrowserProvider(walletProvider,undefined,{cacheTimeout:-1});
 try{
  const signer=await provider.getSigner(wallet);
  const token=new Contract(V3_TEST_TOKEN,V3_TEST_TOKEN_ABI,signer);
  const allowance=BigInt(await token.allowance(wallet,config.address));
  if(allowance<amount){
   if(allowance>0n){
    const reset=await token.approve(config.address,0n);
    if((await reset.wait(5))?.status!==1)throw Error('Funding allowance reset not confirmed.');
   }
   const approval=await token.approve(config.address,amount);
   if((await approval.wait(5))?.status!==1)throw Error('Exact test-token funding allowance not confirmed.');
  }
  const recheck=await v3ReadSession(walletProvider,wallet,config);
  try{
   const row=await recheck.vault.withdrawalOf(id,recheck.options);
   if(Number(row.status)!==1||BigInt(row.gross)!==amount||
    getAddress(row.beneficiary)!==beneficiary)
    throw Error('Beneficiary, amount or status changed; do not fund.');
  }finally{recheck.provider.destroy();}
  const vault=new Contract(config.address,V3_ABI,signer);
  await vault.fundWithdrawal.staticCall(id);
  const tx=await vault.fundWithdrawal(id);
  const receipt=await tx.wait(5);
  if(!receipt||receipt.status!==1)
   throw Error('V3 TESTNET funding did not confirm. Review on-chain receipt before retry.');
  if(!eventMatches(receipt,config.address,'WithdrawalEscrowFunded',id))
   throw Error('Exact V3 withdrawal funding event not found; review receipt.');
  return receipt.hash as string;
 }finally{provider.destroy();}
}
export async function readV3ManagerQueue(walletProvider:Eip1193Provider,wallet:string,
 config:V3SiteReleaseConfig|null=v3ReleaseConfig){
 const s=await v3ReadSession(walletProvider,wallet,config);
 try{
  const role=await s.vault.MANAGER_ROLE(s.options);
  if(!await s.vault.hasRole(role,wallet,s.options))
   throw Error('Connect an authorized V3 manager to view the approval queue.');
  const raw=await s.vault.withdrawalCount(s.options);
  const count=Number(raw);
  if(!Number.isSafeInteger(count)||count<0)throw Error('Invalid V3 queue size.');
  const ids=Array.from({length:Math.min(count,20)},(_,i)=>count-1-i);
  const requests=await Promise.all(ids.map(async id=>{
   const r=await s.vault.withdrawalOf(id,s.options);
   return {id,beneficiary:getAddress(r.beneficiary),
    positionId:Number(r.positionId),gross:BigInt(r.gross),fee:BigInt(r.fee),
    requestedAt:Number(r.requestedAt),status:Number(r.status),
    kind:Number(r.kind)} as V3Withdrawal;
  }));
  return {count,requests};
 }finally{s.provider.destroy();}
}
