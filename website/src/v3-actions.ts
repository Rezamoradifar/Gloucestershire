// Signed actions for ONLY the independently verified NEW V3 BNB TESTNET vault.
// No raw key storage, background privileged sender, automatic payouts, real USDT
// or transfer to an address supplied by anyone other than the contract.
import {
 BrowserProvider,Contract,Interface,ZeroAddress,getAddress,isAddress,
 type Eip1193Provider,type Log,type JsonRpcSigner,type TransactionReceipt
} from 'ethers';
import {V3_TEST_TOKEN,type V3SiteReleaseConfig} from './v3-site-config';
import {V3_ABI,V3_TEST_TOKEN_ABI,v3ReadSession,v3ReleaseConfig,type V3Withdrawal} from './v3-chain';
const EVENTS=new Interface(V3_ABI);
const TOKEN_METHODS=new Interface(V3_TEST_TOKEN_ABI);
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
export type V3TransactionProgress={
 step:'preflight'|'simulation'|'wallet_request'|'verification'|'confirmed';
 action:'registration'|'allowance_reset'|'token_approval'|'test_deposit'|'network_group';
 hash?:string;
};
export type V3TransactionProgressCallback=(progress:V3TransactionProgress)=>void;
// Presentation must not affect any transaction or receipt decision.
function progress(callback:V3TransactionProgressCallback|undefined,detail:V3TransactionProgress){
 try{callback?.(detail);}catch{/* Ignore errors from presentation callbacks. */}
}
const validIndex=(n:number)=>Number.isSafeInteger(n)&&n>=0;
function requireActionReady(config:V3SiteReleaseConfig|null){
 if(config?.unified)throw Error('Unified testnet is a read-only preview; wallet actions are not enabled.');
}
const roleFor=(action:V3Action):'manager'|null=>
 ['approveWithdrawal','rejectWithdrawal','reserveExistingCash'].includes(action.kind)?'manager':null;
// Wallet providers sometimes cannot answer eth_call despite supporting signing.
// Use the verified read session for simulation and gas estimation.
const MAX_TESTNET_ACTION_GAS=8_000_000n;
// A bounded legacy fee suggestion for wallets which need an explicit gasPrice.
// This is testnet-only and is not proof that a particular wallet accepts it.
const MAX_TESTNET_GAS_PRICE=100_000_000_000n;
const MAX_TESTNET_ACTION_FEE=10_000_000_000_000_000n;
type CheckedTestGas={gasLimit:bigint;gasPrice:bigint};
async function checkedGas(session:Awaited<ReturnType<typeof v3ReadSession>>,contract:Contract,
 name:string,args:unknown[],wallet:string):Promise<CheckedTestGas>{
 const method=contract.getFunction(name);
 const result=await method.staticCall(...args,{from:wallet,...session.options});
 if(result===false)throw Error('TESTNET token simulation returned false.');
 const estimate=BigInt(await method.estimateGas(...args,{from:wallet}));
 const latest=await session.provider.getBlock('latest');
 if(estimate<=0n||!latest||latest.gasLimit<=0n)throw Error('Unable to verify the TESTNET gas estimate.');
 const limit=(estimate*125n+99n)/100n;
 if(limit>MAX_TESTNET_ACTION_GAS||limit>latest.gasLimit)
  throw Error('TESTNET action exceeds the permitted gas limit.');
 // Read the network fee independently; never guess or fall back after a send.
 let gasPrice:bigint;
 try{
  const fees=await session.provider.getFeeData();
  if(fees.gasPrice===null)throw Error('NO_GAS_PRICE');
  gasPrice=BigInt(fees.gasPrice);
 }catch{throw Error('Unable to verify the TESTNET gas price. Try again later.');}
 if(gasPrice<=0n||gasPrice>MAX_TESTNET_GAS_PRICE||limit*gasPrice>MAX_TESTNET_ACTION_FEE)
  throw Error('TESTNET estimated gas fee exceeds the permitted limit.');
 return {gasLimit:limit,gasPrice};
}
async function checkWalletStillSelected(provider:Eip1193Provider,wallet:string){
 const [chain,accounts]=await Promise.all([
  provider.request({method:'eth_chainId'}),provider.request({method:'eth_accounts'})
 ]);
 if(Number(BigInt(String(chain)))!==97||!Array.isArray(accounts)||
  !accounts.some(a=>typeof a==='string'&&a.toLowerCase()===wallet.toLowerCase()))
  throw Error('Wallet account or BNB Testnet changed. Reconnect before continuing.');
}
async function sendWalletTransaction<T>(send:()=>Promise<T>,label:string,onHash?:(hash:string)=>void):Promise<T>{
 try{return await send();}
 catch(error){
  const e=error as {code?:unknown;error?:{code?:unknown;message?:unknown};
   info?:{sendTransactionHash?:unknown;error?:{code?:unknown;message?:unknown}}}|null;
  // Ethers can report a hash even if its post-broadcast transaction lookup fails.
  // Never copy arbitrary wallet messages, RPC URLs, or unvalidated error data.
  const candidate=e?.info?.sendTransactionHash;
  const hash=typeof candidate==='string'&&/^0x[0-9a-fA-F]{64}$/.test(candidate)?candidate:'';
  const safeCodes=new Set<number|string>([
   -32603,-32601,-32002,-32000,4001,4100,4200,4900,4901,
   'ACTION_REJECTED','BAD_DATA','CALL_EXCEPTION','CANCELLED','INSUFFICIENT_FUNDS',
   'INVALID_ARGUMENT','NETWORK_ERROR','NONCE_EXPIRED','SERVER_ERROR','TIMEOUT',
   'UNKNOWN_ERROR','UNSUPPORTED_OPERATION'
  ]);
  const code=typeof e?.code==='number'||typeof e?.code==='string'?e.code:undefined;
  // Ethers wraps EIP-1193 errors under error or info.error. Only show standard
  // numeric wallet codes and a fixed category, never wallet messages or payloads.
  const walletCodes=new Set([-32603,-32601,-32002,-32000,4001,4100,4200,4900,4901]);
  const nested=[e?.error,e?.info?.error];
  const walletCode=nested.map(item=>item?.code).find(value=>typeof value==='number'&&walletCodes.has(value));
  const walletReportsFunds=code==='INSUFFICIENT_FUNDS'||nested.some(item=>
   typeof item?.message==='string'&&/insufficient funds|not enough.{0,80}(?:miners|gas)|insufficient.{0,80}(?:gas|fee)/i.test(item.message));
  const codes=[code!==undefined&&safeCodes.has(code)?'code '+code:'',
   walletCode!==undefined?'wallet code '+walletCode:''].filter(Boolean).join('; ');
  const diagnostic=(codes?' ('+codes+')':'')+(walletReportsFunds?' Wallet reports insufficient funds for gas.':'');
  if(hash){onHash?.(hash);throw Error(label+' transaction '+hash+' could not be verified'+diagnostic+'. Check its receipt before retrying.');}
  if(code===4001||code==='ACTION_REJECTED')throw Error(label+' was declined in your wallet.');
  throw Error(label+' could not be verified'+diagnostic+'. Check your wallet transaction history before retrying.');
 }
}
// Only the explicitly requested TESTNET call is submitted. The wallet supplies
// the hash; the independently verified reader must confirm the exact call and
// a canonical five-confirmation receipt before another action can be sent.
async function submitVerified(walletProvider:Eip1193Provider,wallet:string,signer:JsonRpcSigner,
 config:V3SiteReleaseConfig,to:string,data:string,gas:CheckedTestGas,label:string,
 action:V3TransactionProgress['action'],onProgress?:V3TransactionProgressCallback):Promise<TransactionReceipt>{
 await checkWalletStillSelected(walletProvider,wallet);
 progress(onProgress,{step:'wallet_request',action});
 const hash=await sendWalletTransaction(()=>signer.sendUncheckedTransaction({
  from:wallet,to,data,value:0n,gasLimit:gas.gasLimit,gasPrice:gas.gasPrice
 }),label,hash=>progress(onProgress,{step:'verification',action,hash}));
 if(typeof hash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(hash))
  throw Error(label+' returned an invalid transaction reference. Check wallet history before retrying.');
 progress(onProgress,{step:'verification',action,hash});
 let session:Awaited<ReturnType<typeof v3ReadSession>>|undefined;
 try{
  session=await v3ReadSession(walletProvider,wallet,config,true);
  const p=session.provider;
  const deadline=Date.now()+90000;
  let receipt:TransactionReceipt|null=null;
  while(Date.now()<deadline){
   const candidate=await p.getTransactionReceipt(hash);
   if(candidate){
    if(candidate.status!==1)throw Error('TRANSACTION_FAILED');
    const height=await p.getBlockNumber();
    if(height>=candidate.blockNumber+4){receipt=candidate;break;}
   }
   await new Promise<void>(resolve=>setTimeout(resolve,2000));
  }
  if(!receipt)throw Error('CONFIRMATION_TIMEOUT');
  const [tx,canonical,again]=await Promise.all([
   p.getTransaction(hash),p.getBlock(receipt.blockNumber),p.getTransactionReceipt(hash)
  ]);
  if(!tx||tx.hash.toLowerCase()!==hash.toLowerCase()||tx.chainId!==97n||
     getAddress(tx.from)!==getAddress(wallet)||!tx.to||getAddress(tx.to)!==getAddress(to)||
     tx.data.toLowerCase()!==data.toLowerCase()||tx.value!==0n||
     receipt.hash.toLowerCase()!==hash.toLowerCase()||!receipt.to||
     getAddress(receipt.from)!==getAddress(wallet)||getAddress(receipt.to)!==getAddress(to)||
     !canonical?.hash||canonical.hash.toLowerCase()!==receipt.blockHash.toLowerCase()||
     !again||again.status!==1||again.hash.toLowerCase()!==hash.toLowerCase()||
     again.blockNumber!==receipt.blockNumber||again.blockHash.toLowerCase()!==receipt.blockHash.toLowerCase())
   throw Error('TRANSACTION_IDENTITY_MISMATCH');
  const finalBlock=await p.getBlock(receipt.blockNumber);
  const finalHeight=await p.getBlockNumber();
  if(!finalBlock?.hash||finalBlock.hash.toLowerCase()!==receipt.blockHash.toLowerCase()||
     finalHeight<receipt.blockNumber+4)throw Error('TRANSACTION_CONFIRMATIONS_CHANGED');
  progress(onProgress,{step:'confirmed',action,hash});
  return again;
 }catch{
  throw Error(label+' transaction '+hash+' could not be independently confirmed. Check its receipt before retrying.');
 }finally{session?.provider.destroy();}
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
const groupEventMatches=(receipt:{logs:readonly Log[]},contract:string,wallet:string,
 action:Extract<V3Action,{kind:'createRewardGroup'|'addRewardBranches'}>)=>receipt.logs.some(raw=>{
 if(raw.address.toLowerCase()!==contract.toLowerCase())return false;
 try{
  const event=EVENTS.parseLog({topics:raw.topics,data:raw.data});
  const expected=action.kind==='createRewardGroup'?'RewardGroupCreated':'RewardBranchesAdded';
  if(event?.name!==expected||getAddress(event.args.user)!==getAddress(wallet))return false;
  if(action.kind==='addRewardBranches'&&BigInt(event.args.group)!==BigInt(action.group))return false;
  const actual=Array.from(event.args.branches as readonly string[],address=>getAddress(address));
  const requested=action.branches.map(address=>getAddress(address));
  return actual.length===requested.length&&actual.every((address,index)=>address===requested[index]);
 }catch{return false;}
});

// Read the permanent parent and group assignment at the same verified block.
// The contract remains authoritative if a branch is assigned concurrently.
export async function checkV3GroupBranches(vault:Contract,wallet:string,branches:string[],options:{blockTag:number}){
 const who=getAddress(wallet),addresses=branches.map(address=>getAddress(address));
 if(!addresses.length||addresses.length>64||new Set(addresses).size!==addresses.length)
  throw Error('Select between 1 and 64 distinct direct branches.');
 for(let start=0;start<addresses.length;start+=5){
  const checks=await Promise.all(addresses.slice(start,start+5).map(async address=>{
   const [user,grouped]=await Promise.all([vault.users(address,options),vault.groupedBranch(who,address,options)]);
   return {user,grouped};
  }));
  for(const {user,grouped} of checks){
   if(grouped)throw Error('A selected branch is already in a reward group. Refresh the team and select an available branch.');
   if(!user.registered||!isAddress(user.referrer)||getAddress(user.referrer)!==who)
    throw Error('A selected branch is not a registered direct referral of this wallet. Refresh the team and check the branch.');
  }
 }
}
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

// Check immutable referral and eligibility rules before asking for a token
// approval. The checks use the verified block, and run again before deposit.
export async function checkV3DepositAccount(vault:Contract,wallet:string,referrer:string,
 amount:bigint,options:{blockTag:number}){
 const who=getAddress(wallet),parent=getAddress(referrer);
 if(parent===who)throw Error('A wallet cannot be its own referrer.');
 const user=await vault.users(who,options);
 if(user.registered){
  if(!isAddress(user.referrer))throw Error('The registered referral address could not be verified. Refresh before continuing.');
  if(getAddress(user.referrer)!==parent)
   throw Error('The selected referrer does not match this account’s permanent referrer on this test contract. Refresh before continuing.');
 }else if(parent!==ZeroAddress){
  const sponsor=await vault.users(parent,options);
  if(!sponsor.registered)
   throw Error('This referrer is not registered on this V3 test contract. Ask them to register here first. Only continue without a referrer if that is your intended choice.');
 }
 if(user.suspended)throw Error('This V3 test account is suspended.');
 let capital:bigint;
 try{capital=BigInt(user.capital);}catch{throw Error('The V3 test account balance could not be verified. Refresh before continuing.');}
 if(capital<0n)throw Error('The V3 test account balance could not be verified. Refresh before continuing.');
 if(capital+amount>50_000n*10n**18n&&!user.vipKyc)
  throw Error('This deposit requires VIP verification on the V3 test contract.');
}

function isV3InvalidRevert(error:unknown){
 const e=error as {data?:unknown;info?:{error?:{data?:unknown}}}|null;
 const nested=e?.info?.error?.data;
 const candidates=[e?.data,nested,typeof nested==='object'&&nested!==null?(nested as {data?:unknown}).data:null];
 return candidates.some(value=>typeof value==='string'&&value.toLowerCase()==='0x6dac6a09');
}
export async function sendV3Action(walletProvider:Eip1193Provider,wallet:string,
 action:V3Action,config:V3SiteReleaseConfig|null=v3ReleaseConfig,onProgress?:V3TransactionProgressCallback){
 requireActionReady(config);
 if(action.kind==='register')progress(onProgress,{step:'preflight',action:'registration'});
 const groupAction=action.kind==='createRewardGroup'||action.kind==='addRewardBranches';
 if(groupAction)progress(onProgress,{step:'preflight',action:'network_group'});
 const context=await v3ReadSession(walletProvider,wallet,config,groupAction);
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
    await checkV3GroupBranches(vault,wallet,branches,options);
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
 // Verify registration and group actions independently of the wallet's read RPC.
 let registrationGas:CheckedTestGas|undefined;
 let groupGas:CheckedTestGas|undefined;
 const recheck=await v3ReadSession(walletProvider,wallet,config,action.kind==='register'||groupAction);
 try{
  if(action.kind==='register'){
   await checkV3Registration(recheck.vault,wallet,action.referrer,recheck.options);
   progress(onProgress,{step:'simulation',action:'registration'});
   registrationGas=await checkedGas(recheck,recheck.vault,name,args,wallet);
  }
  if(action.kind==='createRewardGroup'||action.kind==='addRewardBranches'){
   await checkV3GroupBranches(recheck.vault,wallet,action.branches,recheck.options);
   progress(onProgress,{step:'simulation',action:'network_group'});
   try{groupGas=await checkedGas(recheck,recheck.vault,name,args,wallet);}
   catch(error){
    if((error as {code?:unknown})?.code==='CALL_EXCEPTION')
     throw Error('The group request was rejected during testnet simulation. Refresh the team and check the selected branches. No transaction was sent.');
    throw error;
   }
  }
 }finally{recheck.provider.destroy();}
 const provider=new BrowserProvider(walletProvider,undefined,{cacheTimeout:-1});
 try{
  const signer=await provider.getSigner(wallet);
  if(registrationGas!==undefined){
   const data=EVENTS.encodeFunctionData(name,args);
   const receipt=await submitVerified(walletProvider,wallet,signer,config,config.address,data,registrationGas,'Registration','registration',onProgress);
   return receipt.hash;
  }
  if(groupGas!==undefined&&(action.kind==='createRewardGroup'||action.kind==='addRewardBranches')){
   const data=EVENTS.encodeFunctionData(name,args);
   const receipt=await submitVerified(walletProvider,wallet,signer,config,config.address,data,groupGas,'Reward group','network_group',onProgress);
   if(!groupEventMatches(receipt,config.address,wallet,action))
    throw Error('The group transaction was confirmed but its event could not be verified. Check wallet history before retrying.');
   return receipt.hash;
  }
  const writable=new Contract(config.address,V3_ABI,signer);
  await writable.getFunction(name).staticCall(...args);
  await checkWalletStillSelected(walletProvider,wallet);
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
 amount:bigint,referrer:string,config:V3SiteReleaseConfig|null=v3ReleaseConfig,onProgress?:V3TransactionProgressCallback){
 requireActionReady(config);
 if(!config||amount<10n**19n||!isAddress(referrer)||
  getAddress(referrer)===getAddress(wallet))
  throw Error('Invalid V3 TESTNET deposit, referrer, or unverified contract.');
 progress(onProgress,{step:'preflight',action:'test_deposit'});
 async function state(s:Awaited<ReturnType<typeof v3ReadSession>>){
  const token=new Contract(V3_TEST_TOKEN,V3_TEST_TOKEN_ABI,s.provider);
  const [balance,allowance,paused]=await Promise.all([
   token.balanceOf(wallet,s.options),token.allowance(wallet,config!.address,s.options),
   s.vault.paused(s.options)
  ]);
  if(paused)throw Error('Deposits are paused on this V3 test contract.');
  if(BigInt(balance)<amount)throw Error('This wallet does not have enough TEST USDT on this V3 test network.');
  if(BigInt(allowance)<0n)throw Error('Invalid token allowance');
  await checkV3DepositAccount(s.vault,wallet,referrer,amount,s.options);
  return {token,allowance:BigInt(allowance)};
 }
 let s=await v3ReadSession(walletProvider,wallet,config,true);
 let allowance:bigint;
 try{allowance=(await state(s)).allowance;}finally{s.provider.destroy();}
 const provider=new BrowserProvider(walletProvider,undefined,{cacheTimeout:-1});
 let lastApprovalHash='';
 let depositSent=false;
 try{
  const signer=await provider.getSigner(wallet);
  if(allowance<amount){
   if(allowance>0n){
    s=await v3ReadSession(walletProvider,wallet,config,true);
    let resetGas:CheckedTestGas;
    try{
     const current=await state(s);
     if(current.allowance!==allowance)throw Error('TEST token allowance changed. Refresh before continuing.');
     progress(onProgress,{step:'simulation',action:'allowance_reset'});
     resetGas=await checkedGas(s,current.token,'approve',[config.address,0n],wallet);
    }finally{s.provider.destroy();}
    const reset=await submitVerified(walletProvider,wallet,signer,config,V3_TEST_TOKEN,
     TOKEN_METHODS.encodeFunctionData('approve',[config.address,0n]),resetGas,'Allowance reset','allowance_reset',onProgress);
    lastApprovalHash=reset.hash;
    s=await v3ReadSession(walletProvider,wallet,config,true);
    try{allowance=(await state(s)).allowance;}finally{s.provider.destroy();}
    if(allowance!==0n)throw Error('Allowance reset was not confirmed. Check the transaction before retrying.');
   }
   s=await v3ReadSession(walletProvider,wallet,config,true);
   let approvalGas:CheckedTestGas;
   try{
    const current=await state(s);
    if(current.allowance!==0n)throw Error('TEST token allowance changed. Refresh before continuing.');
    progress(onProgress,{step:'simulation',action:'token_approval'});
    approvalGas=await checkedGas(s,current.token,'approve',[config.address,amount],wallet);
   }finally{s.provider.destroy();}
   const approval=await submitVerified(walletProvider,wallet,signer,config,V3_TEST_TOKEN,
    TOKEN_METHODS.encodeFunctionData('approve',[config.address,amount]),approvalGas,'TEST token approval','token_approval',onProgress);
   lastApprovalHash=approval.hash;
  }
  const check=await v3ReadSession(walletProvider,wallet,config,true);
  let depositGas:CheckedTestGas;
  try{
   const confirmedAllowance=(await state(check)).allowance;
   if(confirmedAllowance<amount)throw Error('Approved token allowance is not confirmed. Retry only after verifying the transaction.');
   progress(onProgress,{step:'simulation',action:'test_deposit'});
   try{depositGas=await checkedGas(check,check.vault,'deposit',[amount,getAddress(referrer)],wallet);}
   catch(error){
    if(isV3InvalidRevert(error))throw Error('The test deposit was rejected during simulation. Check the account’s permanent referrer and test-token compatibility; no deposit was sent.');
    throw error;
   }
  }finally{check.provider.destroy();}
  const receipt=await submitVerified(walletProvider,wallet,signer,config,config.address,
   EVENTS.encodeFunctionData('deposit',[amount,getAddress(referrer)]),depositGas,'TESTNET deposit','test_deposit',onProgress);
  depositSent=true;
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
  if(!routed)throw Error('Deposit routing event for '+receipt.hash+' was not verified. Inspect the transaction before retrying.');
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
 requireActionReady(config);
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
