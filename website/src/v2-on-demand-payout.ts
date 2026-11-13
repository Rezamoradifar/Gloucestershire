// Exact TESTNET ONLY, payout-triggered V2 cash top-up.
// No advance 1M treasury seeding; the signer funds only the contract's CURRENT
// minimum shortfall for an already approved, immutable withdrawal request.
// The deployed V2 requires ALL credited-profit liabilities to be cash-backed
// before ANY profit request can pay; disclose this unavoidable global shortfall.
import {
 BrowserProvider,Contract,Interface,getAddress,
 type Eip1193Provider,type Log
} from 'ethers';
import {V2_ADDRESS,V2_CHAIN_ID,V2_EXPLORER,v2Session} from './v2-chain';
import {V2_TEST_TOKEN} from './v2-live-deposit';

const TOKEN_ABI=[
 'function balanceOf(address) view returns(uint256)',
 'function allowance(address,address) view returns(uint256)',
 'function approve(address,uint256) returns(bool)'
];
const VAULT_ABI=[
 'function fundPrincipalLiquidity(address,uint256) payable',
 'function payWithdrawal(uint256)',
 'event PrincipalLiquidityFunded(address indexed sender,address indexed asset,uint256 amount)',
 'event WithdrawalResolved(uint256 indexed id,uint8 status,bytes32 reason)'
];
const EVENTS=new Interface(VAULT_ABI);
export type V2PayoutOnDemandQuote={
 wallet:string;requestId:number;beneficiary:string;asset:string;gross:bigint;fee:bigint;
 principal:boolean;status:number;cash:bigint;profitLiability:bigint;
 fundingShortfall:bigint;walletBalance:bigint;allowance:bigint;gasWei:bigint;
 decimals:number;block:number;
};
const nonnegative=(x:bigint)=>x>0n?x:0n;
export function requiredV2PayoutFunding({
 cash,profitLiability,gross,principal
}:{cash:bigint;profitLiability:bigint;gross:bigint;principal:boolean}):bigint{
 if(cash<0n||profitLiability<0n||gross<=0n)throw Error('Invalid verified withdrawal liquidity.');
 // Deployed V2 cannot pay profit unless the entire on-chain profit liability
 // is cash-backed, even when just one smaller withdrawal is requested.
 return nonnegative((principal?profitLiability+gross:profitLiability)-cash);
}
export async function readV2OnDemandPayout(
 walletProvider:Eip1193Provider,wallet:string,requestId:number
):Promise<V2PayoutOnDemandQuote>{
 if(!Number.isSafeInteger(requestId)||requestId<0)throw Error('Invalid withdrawal request ID.');
 const {provider,vault,options,block}=await v2Session(walletProvider,wallet);
 const [r,tokenAddress,decimalsBig]=await Promise.all([
  vault.withdrawalOf(requestId,options),vault.usdt(options),vault.tokenDecimals(options)
 ]);
 const token=getAddress(tokenAddress),asset=getAddress(r.asset);
 if(token!==V2_TEST_TOKEN||Number(decimalsBig)!==18)
  throw Error('Verified V2 TEST token identity changed. Do not fund.');
 if(asset!==token)throw Error('Only TEST USDT requests are supported here. Do not mix tBNB with test tokens.');
 if(Number(r.status)!==1)throw Error('This V2 request has not been manager-approved or is no longer payable.');
 const [cash,profits]=await Promise.all([
  vault.assetBalance(token,options),vault.profitLiability(token,options)
 ]);
 const tokenContract=new Contract(token,TOKEN_ABI,provider);
 const [balance,allowance,gas]=await Promise.all([
  tokenContract.balanceOf(wallet,options),
  tokenContract.allowance(wallet,V2_ADDRESS,options),
  provider.getBalance(wallet,block.number)
 ]);
 const gross=BigInt(r.gross),fee=BigInt(r.fee),principal=Boolean(r.principal);
 if(gross<=0n||fee>=gross)throw Error('Invalid on-chain withdrawal or fee.');
 return Object.freeze({
  wallet:getAddress(wallet),requestId,beneficiary:getAddress(r.user),
  asset,principal,gross,fee,status:Number(r.status),
  cash:BigInt(cash),profitLiability:BigInt(profits),
  fundingShortfall:requiredV2PayoutFunding({
   cash:BigInt(cash),profitLiability:BigInt(profits),gross,principal
  }),
  walletBalance:BigInt(balance),allowance:BigInt(allowance),
  gasWei:BigInt(gas),decimals:18,block:block.number
 });
}
export function canFundV2PayoutOnDemand(quote:V2PayoutOnDemandQuote){
 return quote.status===1&&quote.asset===V2_TEST_TOKEN&&quote.decimals===18&&
  quote.walletBalance>=quote.fundingShortfall&&quote.gasWei>0n;
}
function sameRequest(a:V2PayoutOnDemandQuote,b:V2PayoutOnDemandQuote){
 return a.wallet===b.wallet&&a.requestId===b.requestId&&
  a.beneficiary===b.beneficiary&&a.asset===b.asset&&
  a.gross===b.gross&&a.fee===b.fee&&a.principal===b.principal;
}
export async function fundAndPayV2ApprovedWithdrawal(
 walletProvider:Eip1193Provider,wallet:string,
 preview:V2PayoutOnDemandQuote,report:(message:string,hash?:string)=>void=()=>{}
){
 let fresh=await readV2OnDemandPayout(walletProvider,wallet,preview.requestId);
 if(!sameRequest(preview,fresh)||fresh.fundingShortfall!==preview.fundingShortfall||
    !canFundV2PayoutOnDemand(fresh))
  throw Error('Approved request, liquidity, or TESTNET wallet balance changed. Refresh before signing.');
 const signer=await new BrowserProvider(walletProvider,undefined,{cacheTimeout:-1}).getSigner(wallet);
 const token=new Contract(V2_TEST_TOKEN,TOKEN_ABI,signer);
 const vault=new Contract(V2_ADDRESS,VAULT_ABI,signer);
 let fundingTxHash:string|null=null;
 if(fresh.fundingShortfall>0n){
  const amount=fresh.fundingShortfall;
  if(fresh.allowance<amount){
   if(fresh.allowance>0n){
    report('Confirm reset of existing TEST token allowance.');
    const reset=await token.approve(V2_ADDRESS,0n);
    if((await reset.wait(3))?.status!==1)throw Error('Test token allowance reset not confirmed.');
   }
   report('Approve ONLY the current required TEST token shortfall in your wallet.');
   const approve=await token.approve(V2_ADDRESS,amount);
   if((await approve.wait(3))?.status!==1)throw Error('Exact TEST token approval not confirmed.');
  }
  fresh=await readV2OnDemandPayout(walletProvider,wallet,preview.requestId);
  if(!sameRequest(preview,fresh)||fresh.fundingShortfall!==amount||
      !canFundV2PayoutOnDemand(fresh))
   throw Error('TESTNET cash needs changed during approval. Do not transfer; refresh.');
  await v2Session(walletProvider,wallet); // reverify chain and bytecode before writing
  await vault.fundPrincipalLiquidity.staticCall(V2_TEST_TOKEN,amount);
  report('Confirm actual on-demand TEST USDT funding transaction in your wallet.');
  const funded=await vault.fundPrincipalLiquidity(V2_TEST_TOKEN,amount);
  fundingTxHash=funded.hash;
  report('Funding sent. Waiting for 5 confirmations so V2 pinned reads include this transaction.',funded.hash);
  const receipt=await funded.wait(5);
  if(!receipt||receipt.status!==1)
   throw Error('Funding not confirmed. Inspect any broadcast transaction before retrying.');
  const fundedEvent=receipt.logs.some((log:Log)=>{
   if(log.address?.toLowerCase()!==V2_ADDRESS.toLowerCase())return false;
   try{
    const evt=EVENTS.parseLog({topics:log.topics,data:log.data});
    return evt?.name==='PrincipalLiquidityFunded'&&
     getAddress(evt.args.sender)===fresh.wallet&&
     getAddress(evt.args.asset)===V2_TEST_TOKEN&&BigInt(evt.args.amount)===amount;
   }catch{return false;}
  });
  if(!fundedEvent)throw Error('Funding event missing: inspect sent transaction before any retry.');
 }
 // No manager-paid shortcut: original approved beneficiary cannot be changed.
 // This second independent wallet transaction performs the actual transfer.
 const ready=await readV2OnDemandPayout(walletProvider,wallet,preview.requestId);
 if(!sameRequest(preview,ready)||ready.fundingShortfall!==0n)
  throw Error('TEST token funding may have happened but withdrawal is not payable; inspect chain before retrying.');
 await v2Session(walletProvider,wallet);
 await vault.payWithdrawal.staticCall(preview.requestId);
 report('Confirm FINAL TESTNET payout to the original withdrawal beneficiary.');
 const payment=await vault.payWithdrawal(preview.requestId);
 report('Payout broadcast. Verifying 3 on-chain confirmations.',payment.hash);
 const payoutReceipt=await payment.wait(3);
 if(!payoutReceipt||payoutReceipt.status!==1)throw Error('Payout unconfirmed. Review transaction.');
 const paidEvent=payoutReceipt.logs.some((log:Log)=>{
  if(log.address?.toLowerCase()!==V2_ADDRESS.toLowerCase())return false;
  try{
   const evt=EVENTS.parseLog({topics:log.topics,data:log.data});
   return evt?.name==='WithdrawalResolved'&&
    BigInt(evt.args.id)===BigInt(preview.requestId)&&Number(evt.args.status)===2;
  }catch{return false;}
 });
 if(!paidEvent)throw Error('Payout event missing: inspect transaction before another attempt.');
 return {
  status:'TESTNET_WITHDRAWAL_PAID' as const,requestId:preview.requestId,
  beneficiary:preview.beneficiary,gross:preview.gross,fee:preview.fee,
  fundingShortfall:preview.fundingShortfall,token:V2_TEST_TOKEN,chainId:V2_CHAIN_ID,
  fundingTxHash,paymentTxHash:payoutReceipt.hash,
  paymentExplorerUrl:V2_EXPLORER+'/tx/'+payoutReceipt.hash
 };
}
