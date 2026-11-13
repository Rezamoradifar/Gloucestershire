#!/usr/bin/env node
// Fund precisely 1,000,000 valueless test-USDT on BNB TESTNET.
// No server environment keys, real USDT, synthetic ledger credits or automatic minting.
// Only a dedicated TESTNET encrypted JSON keystore with an interactive TTY is accepted.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {
 Contract,Interface,Wallet,getAddress,parseUnits,formatUnits,keccak256
} from 'ethers';
import {
 openVerifiedV2ReadProvider,V2_RPC_VAULT,V2_RPC_CODE_HASH,V2_RPC_CHAIN
} from '../server/v2-read-rpc.mjs';

const TOKEN=getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89');
const EXACT=parseUnits('1000000',18);
const MARKER='/var/lib/globaldroptrade-v2/treasury-funding/one-million-test-usdt.json';
const VAULT_ABI=[
 'function usdt() view returns(address)',
 'function tokenDecimals() view returns(uint8)',
 'function assetBalance(address) view returns(uint256)',
 'function principalLiability(address) view returns(uint256)',
 'function profitLiability(address) view returns(uint256)',
 'function fundPrincipalLiquidity(address,uint256) payable',
 'event PrincipalLiquidityFunded(address indexed sender,address indexed asset,uint256 amount)'
];
const TOKEN_ABI=[
 'function decimals() view returns(uint8)',
 'function balanceOf(address) view returns(uint256)',
 'function allowance(address,address) view returns(uint256)',
 'function approve(address,uint256) returns(bool)'
];
const events=new Interface(VAULT_ABI);
const fail=(message)=>{throw Error(message);};
const toText=(value)=>formatUnits(value,18);

async function readState(provider,address){
 const code=await provider.getCode(V2_RPC_VAULT,'latest');
 if(code==='0x'||keccak256(code).toLowerCase()!==V2_RPC_CODE_HASH)fail('V2_CONTRACT_BYTECODE_MISMATCH');
 const [chain,tokenCode]=await Promise.all([
  provider.send('eth_chainId',[]),provider.getCode(TOKEN,'latest')
 ]);
 if(Number(BigInt(chain))!==V2_RPC_CHAIN||tokenCode==='0x')fail('V2_TEST_CHAIN_OR_TOKEN_MISMATCH');
 const vault=new Contract(V2_RPC_VAULT,VAULT_ABI,provider);
 const token=new Contract(TOKEN,TOKEN_ABI,provider);
 const [actualToken,decimals,principal,profit,cash]=await Promise.all([
  vault.usdt(),vault.tokenDecimals(),vault.principalLiability(TOKEN),
  vault.profitLiability(TOKEN),vault.assetBalance(TOKEN)
 ]);
 if(getAddress(actualToken)!==TOKEN||Number(decimals)!==18||
  Number(await token.decimals())!==18)fail('V2_TEST_TOKEN_IDENTITY_OR_DECIMALS_MISMATCH');
 const result={
  chainId:97,contract:V2_RPC_VAULT,token:TOKEN,
  requiredTestTokens:'1000000',currentVaultCash:toText(cash),
  principalLiability:toText(principal),profitLiability:toText(profit),
  fundingWallet:address??null,availableTestTokens:null,
  approvedTestTokens:null,gasTestBNB:null,readyToSign:false
 };
 if(address){
  const [balance,allowance,gas]=await Promise.all([
   token.balanceOf(address),token.allowance(address,V2_RPC_VAULT),provider.getBalance(address)
  ]);
  result.availableTestTokens=toText(balance);
  result.approvedTestTokens=toText(allowance);
  result.gasTestBNB=formatUnits(gas,18);
  result.readyToSign=balance>=EXACT&&gas>0n;
 }
 return result;
}

async function secretPassword(){
 if(!process.stdin.isTTY||!process.stdout.isTTY)fail('FUNDING_REQUIRES_INTERACTIVE_TERMINAL');
 const rl=createInterface({input:process.stdin,output:process.stdout});
 process.stdout.write('Encrypted TESTNET keystore password (hidden): ');
 const masked=spawnSync('stty',['-echo'],{stdio:'inherit'});
 if(masked.status!==0){rl.close();fail('CANNOT_HIDE_KEYSTORE_PASSWORD');}
 try{return await rl.question('');}
 finally{
  spawnSync('stty',['echo'],{stdio:'inherit'});
  process.stdout.write('\n');
  rl.close();
 }
}

function loadEncryptedKeystore(file){
 if(!path.isAbsolute(file)||!file.endsWith('.json')||file.startsWith(process.cwd()+path.sep))
  fail('USE_AN_ABSOLUTE_ENCRYPTED_TESTNET_KEYSTORE_OUTSIDE_REPOSITORY');
 const st=fs.lstatSync(file);
 if(!st.isFile()||(st.mode&0o077)!==0||st.size>200000||
  st.uid!==process.getuid())fail('TESTNET_KEYSTORE_MUST_BE_PRIVATE_0600_AND_OWNED_BY_OPERATOR');
 const input=fs.readFileSync(file,'utf8');
 const data=JSON.parse(input);
 if(!data.crypto&&!data.Crypto)fail('EXPECTED_ENCRYPTED_JSON_V3_KEYSTORE');
 return input;
}

function createIntent(wallet){
 fs.mkdirSync(path.dirname(MARKER),{recursive:true,mode:0o700});
 const dir=fs.lstatSync(path.dirname(MARKER));
 if(!dir.isDirectory()||dir.uid!==process.getuid()||(dir.mode&0o077)!==0)
  fail('UNSAFE_TESTNET_TREASURY_MARKER_DIRECTORY');
 const intent={status:'INTENT',chainId:97,address:V2_RPC_VAULT,asset:TOKEN,
  amount:'1000000',fundingWallet:wallet,createdAt:new Date().toISOString()};
 fs.writeFileSync(MARKER,JSON.stringify(intent,null,2)+'\n',{flag:'wx',mode:0o600});
 return intent;
}
function updateIntent(intent,state,txHash){
 Object.assign(intent,{status:state,updatedAt:new Date().toISOString()});
 if(txHash)intent.txHash=txHash;
 const next=MARKER+'.new';
 fs.writeFileSync(next,JSON.stringify(intent,null,2)+'\n',{mode:0o600});
 fs.renameSync(next,MARKER);
}

async function main(){
 const mode=process.argv[2];
 if(mode!=='--check'&&mode!=='--fund')fail('USAGE: --check [PUBLIC_ADDRESS] OR --fund /abs/path/testnet-only-encrypted-keystore.json');
 if(mode==='--check'&&process.argv.length>4)fail('TOO_MANY_ARGUMENTS');
 if(mode==='--fund'&&process.argv.length!==4)fail('REQUIRE_ENCRYPTED_TESTNET_KEYSTORE_PATH');
 if(process.getuid?.()!==0)fail('ROOT_ONLY_FOR_PRIVATE_SERVER_TREASURY_MARKER');
 const provider=await openVerifiedV2ReadProvider();
 try{
  if(mode==='--check'){
   const address=process.argv[3]?getAddress(process.argv[3]):null;
   const view=await readState(provider,address);
   const previous=fs.existsSync(MARKER)?
    JSON.parse(fs.readFileSync(MARKER,'utf8')):null;
   console.log('GLOBAL_V2_TREASURY_SERVER_PREFLIGHT '+JSON.stringify({
    ...view,previousFundingIntent:previous?{
     status:previous.status,txHash:previous.txHash||null,createdAt:previous.createdAt
    }:null,transferPerformed:false
   }));
   return;
  }
  if(fs.existsSync(MARKER))fail('FUNDING_INTENT_ALREADY_EXISTS_INSPECT_TX_BEFORE_RETRY');
  const keystore=loadEncryptedKeystore(process.argv[3]);
  const password=await secretPassword();
  const wallet=await Wallet.fromEncryptedJson(keystore,password);
  const address=getAddress(wallet.address);
  let view=await readState(provider,address);
  console.log('TESTNET_TREASURY_REVIEW '+JSON.stringify(view));
  if(!view.readyToSign)fail('FUNDING_WALLET_LACKS_1M_TEST_TOKENS_OR_TEST_BNB_GAS');
  if(!process.stdin.isTTY)fail('NO_INTERACTIVE_CONFIRMATION');
  const rl=createInterface({input:process.stdin,output:process.stdout});
  const answer=await rl.question('Type FUND 1000000 TEST USDT exactly to approve the chain-97 transfer: ');
  rl.close();
  if(answer!=='FUND 1000000 TEST USDT')fail('OPERATOR_ABORTED');
  const intent=createIntent(address);
  const signer=wallet.connect(provider);
  const token=new Contract(TOKEN,TOKEN_ABI,signer);
  const vault=new Contract(V2_RPC_VAULT,VAULT_ABI,signer);
  try{
   const allowance=await token.allowance(address,V2_RPC_VAULT);
   if(allowance<EXACT){
    if(allowance>0n){
     updateIntent(intent,'RESET_ALLOWANCE_REQUESTED');
     const reset=await token.approve(V2_RPC_VAULT,0n);
     updateIntent(intent,'RESET_ALLOWANCE_BROADCAST',reset.hash);
     const receipt=await reset.wait(3);
     if(receipt?.status!==1)fail('RESET_ALLOWANCE_FAILED');
    }
    updateIntent(intent,'EXACT_APPROVAL_REQUESTED');
    const tx=await token.approve(V2_RPC_VAULT,EXACT);
    updateIntent(intent,'EXACT_APPROVAL_BROADCAST',tx.hash);
    if((await tx.wait(3))?.status!==1)fail('EXACT_APPROVAL_FAILED');
   }
   // Reconfirm that the funding wallet still has 1M valueless tokens.
   view=await readState(provider,address);
   if(!view.readyToSign)fail('TESTNET_WALLET_BALANCE_CHANGED_BEFORE_FUNDING');
   await vault.fundPrincipalLiquidity.staticCall(TOKEN,EXACT);
   updateIntent(intent,'FUNDING_REQUESTED');
   const tx=await vault.fundPrincipalLiquidity(TOKEN,EXACT);
   updateIntent(intent,'FUNDING_BROADCAST',tx.hash);
   console.log('V2_TESTNET_FUNDING_BROADCAST_TX '+tx.hash);
   const receipt=await tx.wait(3);
   if(receipt?.status!==1)fail('V2_TESTNET_FUNDING_NOT_CONFIRMED');
   const matched=receipt.logs.some(log=>{
    if(log.address?.toLowerCase()!==V2_RPC_VAULT.toLowerCase())return false;
    try{
     const parsed=events.parseLog({topics:log.topics,data:log.data});
     return parsed?.name==='PrincipalLiquidityFunded'&&
      getAddress(parsed.args.sender)===address&&
      getAddress(parsed.args.asset)===TOKEN&&BigInt(parsed.args.amount)===EXACT;
    }catch{return false;}
   });
   if(!matched)fail('EXACT_FUNDING_EVENT_NOT_VERIFIED_MANUAL_REVIEW');
   updateIntent(intent,'CONFIRMED',receipt.hash);
   console.log('V2_TESTNET_TREASURY_FUNDED '+JSON.stringify({
    amount:'1000000',token:'MOCK_TEST_USDT_NOT_REAL_TETHER',
    contract:V2_RPC_VAULT,chainId:97,transaction:receipt.hash,
    confirmations:3,receiptVerified:true
   }));
  }catch(error){
   updateIntent(intent,'REVIEW_REQUIRED');
   throw error;
  }
 }finally{provider.destroy();}
}
main().catch(error=>{
 console.error('V2_TESTNET_SERVER_FUND_BLOCKED:',error?.message||'UNKNOWN_ERROR');
 process.exitCode=1;
});
