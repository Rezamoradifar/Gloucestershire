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
 | {kind:'requestNetworkReward';amount:bigint}
 | {kind:'createRewardGroup';branches:string[]}
 | {kind:'addRewardBranches';group:number;branches:string[]}
 | {kind:'prepareNetworkReward';group:number;stage:number;steps:number}
 | {kind:'claimNetworkRewards';group:number;stage:number;count:number}
 | {kind:'requestPrincipal';positionId:number;amount:bigint}
 | {kind:'reinvest';positionId:number;amount:bigint}
 | {kind:'approveWithdrawal';id:number}
 | {kind:'rejectWithdrawal';id:number}
 | {kind:'reserveExistingCash';id:number}
 | {kind:'payWithdrawal';id:number};
const validIndex=(n:number)=>Number.isSafeInteger(n)&&n>=0;
const roleFor=(action:V3Action):'manager'|null=>
 ['approveWithdrawal','rejectWithdrawal','reserveExistingCash'].includes(action.kind)?'manager':null;
// Wallet providers sometimes cannot answer eth_call despite supporting signing.
// Use the verified read session for simulation and gas estimation.
const MAX_TESTNET_ACTION_GAS=8_000_000n;
async function checkedGas(session:Awaited<ReturnType<typeof v3ReadSession>>,contract:Contract,
 name:string,args:unknown[],wallet:string){
 const method=contract.getFunction(name);
 const result=await method.staticCall(...args,{from:wallet,...session.options});
 if(result===false)throw Error('TESTNET token simulation returned false.');
 const estimate=BigInt(await method.estimateGas(...args,{from:wallet}));
 const latest=await session.provider.getBlock('latest');
 if(estimate<=0n||!latest||latest.gasLimit<=0n)throw Error('Unable to verify the TESTNET gas estimate.');
 const limit=(estimate*125n+99n)/100n;
 if(limit>MAX_TESTNET_ACTION_GAS||limit>latest.gasLimit)
  throw Error('TESTNET action exceeds the permitted gas limit.');
 return limit;
}
async function checkWalletStillSelected(provider:Eip1193Provider,wallet:string){
 const [chain,accounts]=await Promise.all([
  provider.request({method:'eth_chainId'}),provider.request({method:'eth_accounts'})
 ]);
 if(Number(BigInt(String(chain)))!==97||!Array.isArray(accounts)||
  !accounts.some(a=>typeof a==='string'&&a.toLowerCase()===wallet.toLowerCase()))
  throw Error('Wallet account or BNB Testnet changed. Reconnect before continuing.');
}
async function waitForConfirmed(tx:{hash:string;wait:(n:number)=>Promise<{status:number}|null>},label:string){
 try{
  const receipt=await tx.wait(5);
  if(!receipt||receipt.status!==1)throw Error('NOT_CONFIRMED');
 }catch{
  throw Error(label+' transaction '+tx.hash+' was not confirmed. Check the receipt before retrying.');
 }
}
async function sendWalletTransaction<T>(send:()=>Promise<T>,label:string):Promise<T>{
 try{return await send();}
 catch(error){
  const e=error as {code?:number|string}|null;
  if(e?.code===4001||e?.code==='ACTION_REJECTED')throw error;
  throw Error(label+' could not be verified. Check your wallet transaction history before retrying.');
 }
}
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
// Check the same confirmed contract snapshot used for the rest of the action.
// The contract remains authoritative when the signed transaction is sent.
export async function checkV3Registration(vault:Contract,wallet:string,referrer:string,options:{blockTag:number}){
 if(!isAddress(referrer)||getAddress(referrer)===getAddress(wallet))
  throw Error('Choose a valid V3 referral address or leave the referrer empty.');
 const [paused,user]=await Promise.all([vault.paused(options),vault.users(wallet,options)]);
 if(paused)throw Error('Registration is paused on the V3 test contract.');
 if(user.registered)throw Error('This wallet is already registered on this V3 test contract. Refresh your account.');
 if(getAddress(referrer)!==ZeroAddress){
  const parent=await vault.users(getAddress(referrer),options);
  if(!parent.registered)throw Error('The referrer is not registered on this V3 test contract. Use an address registered here, or leave the referrer empty if you do not have one.');
 }
}
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
    await checkV3Registration(vault,wallet,action.referrer,options);
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
   case 'requestNetworkReward':
    if(action.amount<=0n)throw Error('Enter a positive referral claim.');
    name=action.kind;args=[action.amount];break;
   case 'createRewardGroup':
   case 'addRewardBranches':{
    const branches=action.branches.map(address=>getAddress(address));
    if(!branches.length||branches.length>64||new Set(branches).size!==branches.length)
     throw Error('Select between 1 and 64 distinct direct branches.');
    if(action.kind==='addRewardBranches'&&!validIndex(action.group))throw Error('Invalid network group.');
    name=action.kind;args=action.kind==='createRewardGroup'?[branches]:[action.group,branches];break;
   }
   case 'prepareNetworkReward':
    if(!validIndex(action.group)||!validIndex(action.stage)||action.stage>=14||
     !Number.isSafeInteger(action.steps)||action.steps<1||action.steps>64)throw Error('Invalid network preparation.');
    name=action.kind;args=[action.group,action.stage,action.steps];break;
   case 'claimNetworkRewards':
    if(!validIndex(action.group)||!validIndex(action.stage)||action.stage>=14||
     !Number.isSafeInteger(action.count)||action.count<1||action.stage+action.count>14)throw Error('Invalid network stage claim.');
    name=action.kind;args=[action.group,action.stage,action.count];break;
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
 // Verify registration simulation independently of the wallet's read RPC.
 let registrationGas:bigint|undefined;
 const recheck=await v3ReadSession(walletProvider,wallet,config);
 try{
  if(action.kind==='register'){
   await checkV3Registration(recheck.vault,wallet,action.referrer,recheck.options);
   registrationGas=await checkedGas(recheck,recheck.vault,name,args,wallet);
  }
 }finally{recheck.provider.destroy();}
 const provider=new BrowserProvider(walletProvider,undefined,{cacheTimeout:-1});
 try{
  const signer=await provider.getSigner(wallet);
  const writable=new Contract(config.address,V3_ABI,signer);
  if(registrationGas===undefined)await writable.getFunction(name).staticCall(...args);
  await checkWalletStillSelected(walletProvider,wallet);
  const sent=registrationGas===undefined?await writable.getFunction(name)(...args):
   await sendWalletTransaction(()=>writable.getFunction(name)(...args,{gasLimit:registrationGas}),'Registration');
  if(action.kind==='register'){
   await waitForConfirmed(sent,'Registration');
   return sent.hash as string;
  }
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
 async function state(s:Awaited<ReturnType<typeof v3ReadSession>>){
  const token=new Contract(V3_TEST_TOKEN,V3_TEST_TOKEN_ABI,s.provider);
  const [balance,allowance,paused]=await Promise.all([
   token.balanceOf(wallet,s.options),token.allowance(wallet,config!.address,s.options),
   s.vault.paused(s.options)
  ]);
  if(paused||BigInt(balance)<amount)throw Error('V3 testnet paused or wallet lacks actual TEST USDT tokens.');
  if(BigInt(allowance)<0n)throw Error('Invalid token allowance');
  return {token,allowance:BigInt(allowance)};
 }
 let s=await v3ReadSession(walletProvider,wallet,config);
 let allowance:bigint;
 try{allowance=(await state(s)).allowance;}finally{s.provider.destroy();}
 const provider=new BrowserProvider(walletProvider,undefined,{cacheTimeout:-1});
 let lastApprovalHash='';
 let depositSent=false;
 try{
  const signer=await provider.getSigner(wallet);
  const writableToken=new Contract(V3_TEST_TOKEN,V3_TEST_TOKEN_ABI,signer);
  if(allowance<amount){
   if(allowance>0n){
    s=await v3ReadSession(walletProvider,wallet,config);
    let resetGas:bigint;
    try{
     const current=await state(s);
     if(current.allowance!==allowance)throw Error('TEST token allowance changed. Refresh before continuing.');
     resetGas=await checkedGas(s,current.token,'approve',[config.address,0n],wallet);
    }finally{s.provider.destroy();}
    await checkWalletStillSelected(walletProvider,wallet);
    const reset=await sendWalletTransaction(()=>writableToken.approve(config.address,0n,{gasLimit:resetGas}),'Allowance reset');
    lastApprovalHash=reset.hash;
    await waitForConfirmed(reset,'Allowance reset');
    s=await v3ReadSession(walletProvider,wallet,config);
    try{allowance=(await state(s)).allowance;}finally{s.provider.destroy();}
    if(allowance!==0n)throw Error('Allowance reset was not confirmed. Check the transaction before retrying.');
   }
   s=await v3ReadSession(walletProvider,wallet,config);
   let approvalGas:bigint;
   try{
    const current=await state(s);
    if(current.allowance!==0n)throw Error('TEST token allowance changed. Refresh before continuing.');
    approvalGas=await checkedGas(s,current.token,'approve',[config.address,amount],wallet);
   }finally{s.provider.destroy();}
   await checkWalletStillSelected(walletProvider,wallet);
   const approval=await sendWalletTransaction(()=>writableToken.approve(config.address,amount,{gasLimit:approvalGas}),'TEST token approval');
   lastApprovalHash=approval.hash;
   await waitForConfirmed(approval,'TEST token approval');
  }
  const check=await v3ReadSession(walletProvider,wallet,config);
  let depositGas:bigint;
  try{
   const confirmedAllowance=(await state(check)).allowance;
   if(confirmedAllowance<amount)throw Error('Approved token allowance is not confirmed. Retry only after verifying the transaction.');
   depositGas=await checkedGas(check,check.vault,'deposit',[amount,getAddress(referrer)],wallet);
  }finally{check.provider.destroy();}
  await checkWalletStillSelected(walletProvider,wallet);
  const vault=new Contract(config.address,V3_ABI,signer);
  const sent=await sendWalletTransaction(()=>vault.deposit(amount,getAddress(referrer),{gasLimit:depositGas}),'TESTNET deposit');
  depositSent=true;
  let receipt;
  try{receipt=await sent.wait(5);}
  catch{throw Error('TESTNET deposit '+sent.hash+' confirmation is unknown. Check the transaction before retrying.');}
  if(!receipt||receipt.status!==1)throw Error('TESTNET deposit '+sent.hash+' was not confirmed. Check the transaction before retrying.');
  const expectedFee=amount/10n;
  const routed=receipt.logs.some((raw:Log)=>{
   if(raw.address.toLowerCase()!==config.address.toLowerCase())return false;
   try{
    const event=EVENTS.parseLog({topics:raw.topics,data:raw.data});
    return event?.name==='DepositRouted'&&getAddress(event.args.user)===getAddress(wallet)&&
     BigInt(event.args.amount)===amount&&BigInt(event.args.fee1)===expectedFee&&
     BigInt(event.args.fee2)===expectedFee&&BigInt(event.args.operations)===amount-2n*expectedFee;
   }catch{return false;}
  });
  if(!routed)throw Error('Deposit routing event for '+sent.hash+' was not verified. Inspect the transaction before retrying.');
  return receipt.hash as string;
 }catch(error){
  if(lastApprovalHash&&!depositSent){
   const message=error instanceof Error?error.message:'TESTNET deposit did not complete.';
   throw Error(message+' Last token approval/reset: '+lastApprovalHash+'. Check wallet history before retrying.');
  }
  throw error;
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
 config:V3SiteReleaseConfig|null=v3ReleaseConfig,page=0){
 if(!Number.isSafeInteger(page)||page<0||page>100000)
  throw Error('Invalid V3 manager request page.');
 const s=await v3ReadSession(walletProvider,wallet,config);
 try{
  const role=await s.vault.MANAGER_ROLE(s.options);
  if(!await s.vault.hasRole(role,wallet,s.options))
   throw Error('Connect an authorized V3 manager to view the approval queue.');
  const raw=await s.vault.withdrawalCount(s.options);
  const count=Number(raw);
  if(!Number.isSafeInteger(count)||count<0)throw Error('Invalid V3 queue size.');
  const from=count-page*20;
  const ids=Array.from({length:Math.max(0,Math.min(20,from))},(_,i)=>from-1-i);
  const requests=await Promise.all(ids.map(async id=>{
   const r=await s.vault.withdrawalOf(id,s.options);
   return {id,beneficiary:getAddress(r.beneficiary),
    positionId:Number(r.positionId),gross:BigInt(r.gross),fee:BigInt(r.fee),
    requestedAt:Number(r.requestedAt),status:Number(r.status),
    kind:Number(r.kind)} as V3Withdrawal;
  }));
  return {count,page,requests};
 }finally{s.provider.destroy();}
}
