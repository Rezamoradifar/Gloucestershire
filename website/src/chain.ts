import {BrowserProvider,Contract,ZeroAddress,isAddress,keccak256,toUtf8Bytes} from 'ethers';
import abi from './vault-abi.json';
import {chainId,configured,vaultAddress,feeWallets} from './config';
import {parseAmount,feeOf} from './money';
export const erc20Abi=['function decimals() view returns(uint8)','function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)'];
export type Asset='BNB'|'USDT';
export type Position={id:number;asset:string;principal:bigint;capitalUsd:bigint;unlockAt:bigint;penaltyBps:bigint};
export type Snapshot={partners:string[];partnerQuorum:number;who:string;asset:string;decimals:number;walletBalance:bigint;principal:bigint;profit:bigint;externalDeposited:bigint;withdrawalLimit:bigint;nextWithdrawal:bigint;reserve:bigint;totalPrincipal:bigint;totalProfit:bigint;rewards:bigint;paused:boolean;owner:boolean;reporter:boolean;registered:boolean;referrer:string;active:boolean;kyc:boolean;direct:bigint;salesUsd:bigint;capitalUsd:bigint;liquidBalance:bigint;shortfall:bigint;ownerOutstanding:bigint;tier:number;target:bigint;fee:bigint;penalty:bigint;lock:bigint;cooldown:bigint;minDeposit:bigint;positions:Position[];positionCount:number;blockTime:number;blockNumber:number};
export type Action={kind:'deposit'|'profit'|'principal'|'reinvest'|'transfer'|'reserve'|'rewards'|'settle'|'ownerWithdraw'|'returnCapital';value:string;recipient?:string;referrer?:string;position?:Position;settlementId?:string;evidence?:string;salesUsd?:string;expectedFee:bigint;expectedLock?:bigint;expectedPenalty?:bigint;expectedClaim?:bigint};
export const actionNames={deposit:'Deposit capital',profit:'Withdraw profit',principal:'Withdraw principal',reinvest:'Reinvest',transfer:'Transfer profit',reserve:'Fund fee reserve',rewards:'Fund rewards',settle:'Settle sales profit',ownerWithdraw:'Deploy treasury capital',returnCapital:'Return treasury capital'};
export async function session(expected?:string){
 if(!window.ethereum)throw Error('Open a compatible wallet browser or extension.');
 if(!configured)throw Error('The contract address is not configured.');
 const raw=await window.ethereum.request({method:'eth_chainId'});if(Number(raw)!==chainId)throw Error('Your wallet is on a different network.');
 const provider=new BrowserProvider(window.ethereum);const signer=await provider.getSigner();const who=await signer.getAddress();
 if(expected&&who.toLowerCase()!==expected.toLowerCase())throw Error('The wallet account changed. Reload your account data.');
 const vault=new Contract(vaultAddress,abi,signer);
 if(await provider.getCode(vaultAddress)==='0x')throw Error('No contract exists at this address on the selected network.');
 const destinations=await Promise.all([vault.FEE_WALLET_1(),vault.FEE_WALLET_2(),vault.WITHDRAWAL_FEE_WALLET()]);
 if(destinations.some((x,i)=>x.toLowerCase()!==feeWallets[i]))throw Error('The contract fee destinations do not match the expected version.');
 return {provider,signer,who,vault};
}
export async function readSnapshot(who:string,asset:Asset,positionLimit:number):Promise<Snapshot>{
 const {provider,vault}=await session(who);const block=await provider.getBlock('latest');if(!block)throw Error('Could not load the latest block.');const options={blockTag:block.number};
 const token=await vault.usdt(options);const a=asset==='BNB'?ZeroAddress:token;
 const [decimals,account,ledger,user,owner,reporter,paused,tier,target,fee,penalty,lock,cooldown,minDeposit,count,balance,liquidBalance,shortfall,ownerOutstanding,withdrawalLimit]=await Promise.all([
 asset==='BNB'?18:vault.tokenDecimals(options),vault.accounts(who,a,options),vault.ledgers(a,options),vault.users(who,options),vault.owner(options),vault.reporters(who,options),vault.paused(options),vault.tierOf(who,options),vault.dailyTargetBps(who,options),vault.profitFeeBps(options),vault.principalPenaltyBps(options),vault.lockDuration(options),vault.withdrawalCooldown(options),vault.minDepositUsd(options),vault.positionCount(who,options),asset==='BNB'?provider.getBalance(who,block.number):new Contract(token,erc20Abi,provider).balanceOf(who,options),vault.assetBalance(a,options),vault.liquidityShortfall(a,options),vault.ownerCapitalOutstanding(a,options),vault.profitWithdrawalCap(who,a,options)]);
 const partners:string[]=await Promise.all(Array.from({length:7},(_,i)=>vault.partnerWallets(i,options)));const partnerQuorum=Number(await vault.partnerVotesRequired(options));
 const total=Number(count);const positions:Position[]=await Promise.all(Array.from({length:Math.min(total,positionLimit)},async(_,id)=>{const p=await vault.positionOf(who,id,options);return {id,asset:p.asset,principal:p.principal,capitalUsd:p.capitalUsd,unlockAt:p.unlockAt,penaltyBps:p.penaltyBps};}));
 return {withdrawalLimit,partners,partnerQuorum,who,asset:a,decimals:Number(decimals),walletBalance:balance,principal:account.principal,profit:account.profit,externalDeposited:account.externalDeposited,nextWithdrawal:account.nextWithdrawal,reserve:ledger.feeReserve,totalPrincipal:ledger.principal,totalProfit:ledger.profit,rewards:ledger.rewards,paused,owner:owner.toLowerCase()===who.toLowerCase(),reporter,registered:user.registered,referrer:user.referrer,active:user.active,kyc:user.vipKyc,direct:user.activeDirect,salesUsd:user.salesUsd,capitalUsd:user.capitalUsd,liquidBalance,shortfall,ownerOutstanding,tier:Number(tier),target,fee,penalty,lock,cooldown,minDeposit,positions,positionCount:total,blockTime:block.timestamp,blockNumber:block.number};
}
async function receipt(tx:any){try{const r=await tx.wait();if(!r||r.status!==1)throw Error('The transaction failed.');return r.hash as string;}catch(e:any){if(e.code==='TRANSACTION_REPLACED'&&!e.cancelled&&e.receipt?.status===1)return e.receipt.hash as string;throw e;}}
export async function execute(action:Action,snapshot:Snapshot,onStatus:(s:string,hash?:string)=>void){
 const {vault,signer,who,provider}=await session(snapshot.who);const a=snapshot.asset;
 const current=await vault.accounts(who,a);const block=await provider.getBlock('latest');if(!block)throw Error('Could not load the latest block.');
 const amount=parseAmount(action.value,snapshot.decimals);
 if(['profit','transfer'].includes(action.kind)&&((amount>current.profit)||(amount>await vault.profitWithdrawalCap(who,a))))throw Error('The amount exceeds your funded profit or withdrawal cap.');
 if(['profit','transfer','principal'].includes(action.kind)&&BigInt(block.timestamp)<current.nextWithdrawal)throw Error('The withdrawal cooldown has not elapsed.');
 if(action.kind==='profit'&&await vault.profitFeeBps()!==action.expectedFee)throw Error('The fee changed. Refresh and review the transaction again.');
 if(['deposit','reinvest'].includes(action.kind)){
  if(await vault.lockDuration()!==action.expectedLock||await vault.principalPenaltyBps()!==action.expectedPenalty)throw Error('Lock or penalty terms changed. Review the updated terms.');
  if(await vault.quoteUsd(a,amount)<await vault.minDepositUsd())throw Error('The amount is below the minimum deposit value in USD.');
 }
 if(['profit','principal','ownerWithdraw'].includes(action.kind)&&await vault.assetBalance(a)<amount)throw Error('Insufficient liquid treasury balance. The owner must restore funds before this withdrawal can succeed.');
 const funded=['deposit','reserve','rewards','settle','returnCapital'].includes(action.kind);
 const payable=funded&&a===ZeroAddress?{value:amount}:{};
 if(funded){
  const balance=a===ZeroAddress?await provider.getBalance(who):await new Contract(a,erc20Abi,signer).balanceOf(who);
  if(balance<amount)throw Error('Your wallet balance is insufficient.');
  if(a!==ZeroAddress){const token=new Contract(a,erc20Abi,signer);const allowance=await token.allowance(who,vaultAddress);
   if(allowance<amount){if(allowance>0n){onStatus('Confirm the previous token allowance reset in your wallet');await receipt(await token.approve(vaultAddress,0));}
    await session(who);onStatus('Approve the exact USDT amount in your wallet');const tx=await token.approve(vaultAddress,amount);onStatus('Waiting for USDT approval confirmation',tx.hash);await receipt(tx);}
  }
 }
 await session(who);
 let method:string,args:unknown[];
 switch(action.kind){
  case 'deposit':{const u=await vault.users(who);const ref=u.registered?u.referrer:(action.referrer?.trim()||ZeroAddress);if(!isAddress(ref))throw Error('Enter a valid referrer address.');method='deposit';args=[a,amount,ref,payable];break;}
  case 'profit':method='withdrawProfit';args=[a,amount];break;
  case 'principal':{if(!action.position)throw Error('No position selected.');const p=await vault.positionOf(who,action.position.id);if(p.asset.toLowerCase()!==a.toLowerCase()||p.penaltyBps!==action.expectedFee)throw Error('The position or penalty does not match.');method='withdrawPrincipal';args=[action.position.id,amount];break;}
  case 'reinvest':method='reinvest';args=[a,amount];break;
  case 'transfer':throw Error('Internal member transfers are not supported.');
  case 'reserve':method='fundFeeReserve';args=[a,amount,payable];break;
  case 'rewards':method='fundRewards';args=[a,amount,payable];break;
  case 'ownerWithdraw':if(!isAddress(action.recipient||''))throw Error('Enter a valid treasury recipient.');method='ownerWithdrawCapital';args=[a,action.recipient,amount];break;
  case 'returnCapital':method='returnCapital';args=[a,amount,payable];break;
  case 'settle':if(!isAddress(action.recipient||'')||!action.settlementId?.trim()||!action.evidence?.trim())throw Error('A seller address, settlement ID and evidence reference are required.');method='settleSalesProfit';args=[keccak256(toUtf8Bytes(action.settlementId.trim())),a,action.recipient,amount,parseAmount(action.salesUsd||'',18),keccak256(toUtf8Bytes(action.evidence.trim())),payable];break;
 }
 // Simulation after approval catches the latest reserve, role, pause, oracle and lock checks.
 if(['deposit','reinvest'].includes(action.kind) && (await vault.lockDuration()!==action.expectedLock || await vault.principalPenaltyBps()!==action.expectedPenalty))throw Error('Lock or penalty terms changed. Review again.');
 if(action.kind==='profit'&&await vault.profitFeeBps()!==action.expectedFee)throw Error('The fee changed. Review again.');
 onStatus('Simulating the transaction');await vault[method!].staticCall(...args!);await session(who);
 onStatus('Confirm the transaction in your wallet');const sent=await vault[method!](...args!);onStatus('Transaction submitted. Waiting for confirmation.',sent.hash);
 return receipt(sent);
}
export function errorText(error:unknown){const e=error as any;if(e?.code===4001||e?.code==='ACTION_REJECTED')return 'The request was rejected in your wallet.';const name=e?.revert?.name;const errors:Record<string,string>={InsufficientLiquidity:'The treasury lacks liquid funds. Withdrawal depends on capital being returned.',Insufficient:'Insufficient balance, reserve or allowed withdrawal amount.',Locked:'This operation is locked. Check the withdrawal time or pause status.',Unauthorized:'This account does not have the required permission.',Invalid:'The request parameters are invalid.',StalePrice:'The oracle price is invalid or stale.',Unsupported:'This asset or operation is unsupported.'};return errors[name]||e?.shortMessage||e?.message||'Network request failed. Please try again.';}
export function actionFee(action:Action,amount:bigint){return ['profit','principal'].includes(action.kind)?feeOf(amount,action.expectedFee):0n;}
