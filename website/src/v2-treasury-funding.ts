// Explicit, user-signed funding of the EXISTING V2 BNB TESTNET vault.
// This moves an actual MOCK token balance; it never mints tokens, alters an
// off-chain ledger, signs for the operator or pretends to fund real USDT.
import {BrowserProvider,Contract,Interface,getAddress,parseUnits,type Eip1193Provider} from 'ethers';
import {V2_ADDRESS,V2_CHAIN_ID,V2_EXPLORER,v2Session} from './v2-chain';
import {V2_TEST_TOKEN} from './v2-live-deposit';

export const V2_TREASURY_TEST_AMOUNT='1000000';
const EXPECTED_DECIMALS=18;
const TOKEN_ABI=[
 'function balanceOf(address) view returns(uint256)',
 'function allowance(address,address) view returns(uint256)',
 'function approve(address,uint256) returns(bool)'
];
const VAULT_FUND_ABI=[
 'function fundPrincipalLiquidity(address,uint256) payable',
 'event PrincipalLiquidityFunded(address indexed sender,address indexed asset,uint256 amount)'
];
const EVENTS=new Interface(VAULT_FUND_ABI);
export type V2TreasuryFundingQuote={
 wallet:string;token:string;decimals:number;amount:bigint;
 walletBalance:bigint;allowance:bigint;vaultCash:bigint;
 principalLiability:bigint;profitLiability:bigint;block:number;
};

export function v2TreasuryHasTestFunds(q:V2TreasuryFundingQuote){
 return q.walletBalance>=q.amount&&q.amount===parseUnits(V2_TREASURY_TEST_AMOUNT,EXPECTED_DECIMALS)&&
  q.token.toLowerCase()===V2_TEST_TOKEN.toLowerCase()&&q.decimals===EXPECTED_DECIMALS;
}

export async function readV2TreasuryFundingQuote(walletProvider:Eip1193Provider,wallet:string):Promise<V2TreasuryFundingQuote>{
 const {provider,vault,options,block}=await v2Session(walletProvider,wallet);
 const [tokenAddress,decimalsBig]=await Promise.all([vault.usdt(options),vault.tokenDecimals(options)]);
 const token=getAddress(tokenAddress);
 const decimals=Number(decimalsBig);
 if(token!==V2_TEST_TOKEN||decimals!==EXPECTED_DECIMALS)
  throw Error('The deployed V2 test token identity or precision changed. Stop.');
 const amount=parseUnits(V2_TREASURY_TEST_AMOUNT,decimals);
 const testToken=new Contract(token,TOKEN_ABI,provider);
 const [balance,allowance,cash,principal,profit]=await Promise.all([
  testToken.balanceOf(wallet,options),testToken.allowance(wallet,V2_ADDRESS,options),
  vault.assetBalance(token,options),vault.principalLiability(token,options),
  vault.profitLiability(token,options)
 ]);
 return Object.freeze({
  wallet:getAddress(wallet),token,decimals,amount,
  walletBalance:BigInt(balance),allowance:BigInt(allowance),vaultCash:BigInt(cash),
  principalLiability:BigInt(principal),profitLiability:BigInt(profit),block:block.number
 });
}

// Requires deliberate approvals and independent signatures in the connected
// user's TESTNET wallet. Never load private keys on the VPS.
export async function fundV2TestnetTreasury(
 walletProvider:Eip1193Provider,wallet:string,preview:V2TreasuryFundingQuote,
 report:(message:string,hash?:string)=>void=()=>{}
){
 const fresh=await readV2TreasuryFundingQuote(walletProvider,wallet);
 if(preview.wallet!==fresh.wallet||preview.token!==fresh.token||preview.amount!==fresh.amount||
  !v2TreasuryHasTestFunds(fresh))
  throw Error('Treasury preflight changed or your wallet lacks 1,000,000 test tokens. Refresh first.');
 if(fresh.walletBalance<fresh.amount)throw Error('Not enough mock test tokens in the funding wallet.');
 const browser=new BrowserProvider(walletProvider,undefined,{cacheTimeout:-1});
 const signer=await browser.getSigner(wallet);
 const token=new Contract(V2_TEST_TOKEN,TOKEN_ABI,signer);
 if(fresh.allowance<fresh.amount){
  if(fresh.allowance>0n){
   report('Confirm the reset of the existing TEST token approval in your wallet.');
   const reset=await token.approve(V2_ADDRESS,0n);
   const resetReceipt=await reset.wait(3);
   if(resetReceipt?.status!==1)throw Error('Test-token approval reset not confirmed.');
  }
  report('Approve exactly 1,000,000 mock test tokens for the V2 vault in your wallet.');
  const approved=await token.approve(V2_ADDRESS,fresh.amount);
  const approvedReceipt=await approved.wait(3);
  if(approvedReceipt?.status!==1)throw Error('Exact test-token approval not confirmed.');
  report('Exact test-token approval confirmed.',approvedReceipt.hash);
 }
 // The chain, account and bytecode are checked again after any approval delays.
 await v2Session(walletProvider,wallet);
 const vault=new Contract(V2_ADDRESS,VAULT_FUND_ABI,signer);
 await vault.fundPrincipalLiquidity.staticCall(V2_TEST_TOKEN,fresh.amount);
 report('Confirm funding of 1,000,000 TEST USDT to the V2 contract. This is a separate wallet transaction.');
 const tx=await vault.fundPrincipalLiquidity(V2_TEST_TOKEN,fresh.amount);
 report('Funding broadcast. Verifying 3 on-chain confirmations.',tx.hash);
 const receipt=await tx.wait(3);
 if(!receipt||receipt.status!==1)throw Error('Funding transaction was not confirmed.');
 const matched=receipt.logs.some((raw:unknown)=>{
  const event=raw as {address:string;topics:string[];data:string};
  if(event.address?.toLowerCase()!==V2_ADDRESS.toLowerCase())return false;
  try{
   const parsed=EVENTS.parseLog({topics:event.topics,data:event.data});
   return parsed?.name==='PrincipalLiquidityFunded'&&
    getAddress(parsed.args.sender)===fresh.wallet&&
    getAddress(parsed.args.asset)===V2_TEST_TOKEN&&BigInt(parsed.args.amount)===fresh.amount;
  }catch{return false;}
 });
 if(!matched)throw Error('Funding receipt confirmed, but the exact funding event was not found. Inspect the transaction before retrying.');
 return {status:'TESTNET_FUNDING_CONFIRMED' as const,amount:fresh.amount,
  token:V2_TEST_TOKEN,contract:V2_ADDRESS,chainId:V2_CHAIN_ID,txHash:receipt.hash,
  explorerUrl:V2_EXPLORER+'/tx/'+receipt.hash};
}
