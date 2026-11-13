// BNB Testnet-only signed deposit workflow against the NEW V2 vault.
// Every operation is a real, individually confirmed blockchain transaction.
// Never use this flow for real-money purchases or on a mainnet chain.
// The deployed V2 routes ALL deposits to external fee/operations addresses,
// creating gross principal liabilities without keeping principal cash.
import {BrowserProvider,Contract,ZeroAddress,getAddress,parseUnits,keccak256,type Eip1193Provider} from 'ethers';
import {V2_ADDRESS,v2Session,V2_CHAIN_ID} from './v2-chain';

export const V2_TEST_TOKEN=getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89');
export const V2_VAULT_DEPLOYMENT_BLOCK=142416836;
export type V2DepositAsset='TEST_USDT'|'tBNB';
export type V2DepositQuote={
 asset:string;label:V2DepositAsset;wallet:string;amount:bigint;decimals:number;
 quotedUsd:bigint;fee1:bigint;fee2:bigint;operations:bigint;
 recordedPrincipal:bigint;cashRetainedFromThisDeposit:bigint;
 currentCapitalUsd:bigint;capitalAfterUsd:bigint;
 registered:boolean;referrer:string;requiresKyc:boolean;
 userBalance:bigint;allowance:bigint|null;paused:boolean;block:number;
};

const ERC20_ABI=[
 'function balanceOf(address) view returns(uint256)',
 'function allowance(address,address) view returns(uint256)',
 'function approve(address,uint256) returns(bool)'
];
const eventAbi=['event DepositRouted(address indexed user,address indexed asset,uint256 gross,uint256 fee1,uint256 fee2,uint256 operations)'];
const validValue=(value:string,decimals:number)=>{
 if(!Number.isSafeInteger(decimals)||decimals<0||decimals>18||
  typeof value!=='string'||!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.trim()))
  throw Error('Enter a valid amount with the correct test-token precision.');
 const amount=parseUnits(value.trim(),decimals);
 if(amount<=0n)throw Error('Testnet deposit amount must be positive.');
 return amount;
};
export function v2ResolveDepositReferrer(input:string,registered:boolean,stored:string,who:string){
 const normalized=input.trim()?getAddress(input.trim()):ZeroAddress;
 if(normalized.toLowerCase()===who.toLowerCase())throw Error('Self-referral is not permitted.');
 if(registered){
  if(normalized.toLowerCase()!==stored.toLowerCase())
   throw Error('Registered users must keep their original on-chain referrer.');
  return getAddress(stored);
 }
 return normalized;
}
export async function readV2DepositQuote(
 walletProvider:Eip1193Provider,wallet:string,label:V2DepositAsset,decimalAmount:string,
 referrerInput=''
):Promise<V2DepositQuote>{
 if(label!=='TEST_USDT'&&label!=='tBNB')throw Error('Unsupported V2 deposit asset.');
 const {provider,vault,block,options}=await v2Session(walletProvider,wallet);
 const token=getAddress(await vault.usdt(options));
 if(token!==V2_TEST_TOKEN)throw Error('This V2 vault token differs from the pinned testnet token. Stop.');
 const decimals=label==='tBNB'?18:Number(await vault.tokenDecimals(options));
 const asset=label==='tBNB'?ZeroAddress:token;
 const amount=validValue(decimalAmount,decimals);
 const ref=await vault.users(wallet,options);
 const referrer=v2ResolveDepositReferrer(referrerInput,Boolean(ref.registered),getAddress(ref.referrer),wallet);
 if(referrer!==ZeroAddress&&!Boolean(ref.registered)){
  const upstream=await vault.users(referrer,options);
  if(!upstream.registered)throw Error('Referrer has not registered on the NEW V2 contract.');
 }
 const quote=BigInt(await vault.quoteUsd(asset,amount,options));
 if(quote<10n**19n)throw Error('The on-chain oracle values this deposit below the $10 minimum.');
 const capitalAfterUsd=BigInt(ref.capitalUsd)+quote;
 const requiresKyc=capitalAfterUsd>50_000n*10n**18n&&!Boolean(ref.vipKyc);
 const fees=amount/10n;
 const tokenContract=label==='TEST_USDT'?new Contract(token,ERC20_ABI,provider):null;
 const [balance,allowance,paused]=await Promise.all([
  tokenContract?tokenContract.balanceOf(wallet,options):provider.getBalance(wallet,block.number),
  tokenContract?tokenContract.allowance(wallet,V2_ADDRESS,options):Promise.resolve(null),
  vault.paused(options)
 ]);
 return {
  asset,label,wallet:getAddress(wallet),amount,decimals,quotedUsd:quote,
  fee1:fees,fee2:fees,operations:amount-2n*fees,recordedPrincipal:amount,
  cashRetainedFromThisDeposit:0n,currentCapitalUsd:BigInt(ref.capitalUsd),
  capitalAfterUsd,registered:Boolean(ref.registered),referrer,requiresKyc,
  userBalance:BigInt(balance),allowance:allowance===null?null:BigInt(allowance),
  paused:Boolean(paused),block:block.number
 };
}
export async function sendV2TestnetDeposit(
 walletProvider:Eip1193Provider,wallet:string,quote:V2DepositQuote,
 report:(status:string,hash?:string)=>void=()=>{}
){
 if(quote.wallet.toLowerCase()!==wallet.toLowerCase()||
   quote.amount<=0n||quote.asset!==(quote.label==='tBNB'?ZeroAddress:V2_TEST_TOKEN)||
   quote.quotedUsd<10n**19n||quote.requiresKyc||quote.paused)
   throw Error('Invalid V2 testnet preflight. Recheck the quote and account status.');
 const provider=new BrowserProvider(walletProvider,undefined,{cacheTimeout:-1});
 // v2Session checks chain 97, active wallet, signed V2 code hash and terms.
 await v2Session(walletProvider,wallet);
 const signer=await provider.getSigner(wallet);
 const vault=new Contract(V2_ADDRESS,[
  'function deposit(address,uint256,address)',
  'function users(address) view returns(address referrer,bool registered,bool vipKyc,bool suspended,uint64 lastCheckIn,uint256 capitalUsd)',
  'function usdt() view returns(address)',
  'function quoteUsd(address,uint256) view returns(uint256)',
  'function paused() view returns(bool)'
 ],signer);
 const referrer=quote.referrer;
 if(referrer.toLowerCase()===wallet.toLowerCase())throw Error('Self-referral is forbidden.');
 if(quote.label==='TEST_USDT'){
  const token=new Contract(V2_TEST_TOKEN,ERC20_ABI,signer);
  const [balance,allowance]=await Promise.all([
   token.balanceOf(wallet),token.allowance(wallet,V2_ADDRESS)
  ]);
  if(balance<quote.amount)throw Error('Insufficient test token balance in the wallet.');
  if(allowance<quote.amount){
   // Do not approve unlimited funds. Approval is a separate explicit wallet tx.
   report('Approve the exact amount of test tokens in your wallet.');
   if(allowance>0n){
    const reset=await token.approve(V2_ADDRESS,0n);
    const resetReceipt=await reset.wait(3);
    if(resetReceipt?.status!==1)throw Error('Test token allowance reset not confirmed.');
   }
   const approval=await token.approve(V2_ADDRESS,quote.amount);
   const approved=await approval.wait(3);
   if(approved?.status!==1)throw Error('Test token allowance not confirmed.');
   report('Exact test-token approval confirmed.',approved.hash);
  }
 }
 // Revalidate the contract and wallet if approval has taken time or account changed.
 await v2Session(walletProvider,wallet);
 const [current,paused,price]=await Promise.all([
  vault.users(wallet),vault.paused(),vault.quoteUsd(quote.asset,quote.amount)
 ]);
 if(paused||current.suspended||BigInt(price)<10n**19n||
  BigInt(current.capitalUsd)+BigInt(price)>50_000n*10n**18n&&!current.vipKyc)
  throw Error('V2 deposit policy changed or VIP KYC required; do not broadcast.');
 if(current.registered&&getAddress(current.referrer)!==referrer)
  throw Error('V2 referrer changed; restart preflight.');
 if(!current.registered&&referrer!==ZeroAddress){
  const upstream=await vault.users(referrer);
  if(!upstream.registered)throw Error('Referrer is not registered on V2.');
 }
 // Always simulate the actual CURRENT state as the wallet before submission.
 const overrides=quote.label==='tBNB'?{value:quote.amount}:{};
 await vault.deposit.staticCall(quote.asset,quote.amount,referrer,overrides);
 report('Confirm the real BNB TESTNET transaction in your wallet. No mainnet funds.');
 const sent=await vault.deposit(quote.asset,quote.amount,referrer,overrides);
 const receipt=await sent.wait(3);
 if(!receipt||receipt.status!==1)throw Error('The V2 deposit transaction was not confirmed.');
 const parser=new (await import('ethers')).Interface(eventAbi);
 const found=receipt.logs.some((log:unknown)=>{
  const l=log as {address:string;topics:string[];data:string};
  if(l.address.toLowerCase()!==V2_ADDRESS.toLowerCase())return false;
  try{
   const e=parser.parseLog({topics:l.topics,data:l.data});
   return e?.name==='DepositRouted'&&
    getAddress(e.args.user)===getAddress(wallet)&&
    getAddress(e.args.asset)===getAddress(quote.asset)&&BigInt(e.args.gross)===quote.amount;
  }catch{return false;}
 });
 if(!found)throw Error('Deposit receipt confirmed but matching vault event could not be verified. Inspect transaction.');
 return {txHash:receipt.hash,block:receipt.blockNumber,amount:quote.amount,
  chainId:V2_CHAIN_ID,contract:V2_ADDRESS,status:'ONCHAIN_TESTNET_DEPOSIT_CONFIRMED' as const};
}
