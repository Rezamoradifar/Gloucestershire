// Testnet-only capped native tBNB gas top-up to a separate V3 accrual keeper.
// Uses exactly the old known testnet deployment signer; it NEVER transfers
// ERC20 tokens, investor assets, vault reserves, or real BNB mainnet. Requires
// operator's explicit TTY confirmation and verifies a confirmed on-chain receipt.
import fs from 'node:fs';
import {createInterface} from 'node:readline/promises';
import {
 Contract,FetchRequest,JsonRpcProvider,Wallet,getAddress,
 formatEther,parseEther,keccak256
} from 'ethers';
import {waitV3KeeperReceipt} from './v3-keeper-receipt-poll.mjs';

const CHAIN=97;
const CONTRACT=getAddress('0x81B55ab9A1B36CccE355aFC4FfC579BA861f74e7');
const TOKEN=getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89');
const ADMIN=getAddress('0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632');
const OLD=getAddress('0xCf6Eb63ba4D2174CA2759eff57a720a54416b71d');
const CONFIG='/etc/globaldroptrade/v3-keeper-testnet.json';
const NEW_KEY='/etc/globaldroptrade/v3-keeper-testnet-gas-only.key';
const OLD_FILES=[
 '/etc/globaldroptrade/new-deployer-testnet-v1/deployer.key',
 '/root/global-testnet-v071/.testnet-server/deployer.key'
];
const TARGET_GAS=parseEther('0.005');
const MAX_GAS_COST=parseEther('0.001');
const MIN_OLD_REMAINING=parseEther('0.005');
const CONTRACT_ABI=[
 'function asset() view returns(address)',
 'function MANAGER_ROLE() view returns(bytes32)',
 'function FUNDER_ROLE() view returns(bytes32)',
 'function DEFAULT_ADMIN_ROLE() view returns(bytes32)',
 'function GUARDIAN_ROLE() view returns(bytes32)',
 'function hasRole(bytes32,address) view returns(bool)'
];
const fail=(msg)=>{throw Error(msg);};
function loadKey(file){
 const st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid()||
    (st.mode&0o077)!==0||st.size>128)
  fail('TESTNET_SIGNING_KEY_FILE_UNSAFE');
 const raw=fs.readFileSync(file,'utf8').trim();
 if(!/^(?:0x)?[a-fA-F0-9]{64}$/.test(raw))fail('INVALID_TESTNET_SIGNER_FORMAT');
 return new Wallet(raw.startsWith('0x')?raw:'0x'+raw);
}
function expectedConfig(){
 const st=fs.lstatSync(CONFIG);
 if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid()||
    (st.mode&0o077)!==0)fail('V3_PINNED_CONFIG_PERMISSIONS_INVALID');
 const config=JSON.parse(fs.readFileSync(CONFIG,'utf8'));
 if(config.network!=='BNB_TESTNET_ONLY'||config.chainId!==CHAIN||
    getAddress(config.contract)!==CONTRACT||getAddress(config.token)!==TOKEN||
    !/^0x[a-fA-F0-9]{64}$/.test(config.runtimeHash))
  fail('V3_PINNED_TESTNET_CONTRACT_MISMATCH');
 return config;
}
async function providerFor(config){
 for(const url of [
  'https://bsc-testnet-dataseed.bnbchain.org','https://bsc-testnet-rpc.publicnode.com'
 ]){
  const req=new FetchRequest(url);req.timeout=9000;
  const p=new JsonRpcProvider(req,CHAIN,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  try{
   const [chain,code]=await Promise.all([
    p.send('eth_chainId',[]),p.getCode(CONTRACT)
   ]);
   if(Number(BigInt(chain))!==CHAIN||code==='0x'||
      keccak256(code).toLowerCase()!==config.runtimeHash.toLowerCase())
    fail('V3_DEPLOYED_RUNTIME_NOT_PINNED');
   const v=new Contract(CONTRACT,CONTRACT_ABI,p);
   if(getAddress(await v.asset())!==TOKEN)fail('V3_TOKEN_NOT_EXPECTED_TESTNET_MOCK');
   return {provider:p,vault:v};
  }catch{p.destroy();}
 }
 fail('VERIFIED_V3_TESTNET_RPC_NOT_AVAILABLE');
}
async function confirm(){
 if(!process.stdin.isTTY||!process.stdout.isTTY)
  fail('V3_TESTNET_GAS_TRANSFER_REQUIRES_INTERACTIVE_OPERATOR_TTY');
 const rl=createInterface({input:process.stdin,terminal:false});
 let accepted=false;
 try{
  for(let n=0;n<5;n++){
   process.stdout.write('Type FUND V3 GAS BNB TESTNET ONLY to approve this capped valueless gas transfer: ');
   if((await rl.question('')).trim()==='FUND V3 GAS BNB TESTNET ONLY'){
    accepted=true;break;
   }
   if(n<4)process.stdout.write('TESTNET_GAS_CONFIRMATION_NOT_MATCHED. Retry while this process is open.\n');
  }
 }finally{rl.close();}
 if(!accepted)fail('GAS_TRANSFER_CANCELLED_BY_OPERATOR');
}
async function main(){
 const mode=process.argv[2];
 if(process.argv.length!==3||!['--check','--fund'].includes(mode))
  fail('USAGE: node scripts/fund-v3-keeper-gas-from-old-deployer.mjs --check|--fund');
 if(process.getuid?.()!==0)fail('ROOT_REQUIRED_FOR_GAS_ONLY_BOOTSTRAP');
 const config=expectedConfig();
 const key=loadKey(NEW_KEY);
 if(getAddress(key.address)===OLD||getAddress(key.address)===ADMIN)
  fail('GAS_ONLY_KEEPER_MUST_HAVE_SEPARATE_KEY');
 const oldFile=OLD_FILES.find(f=>fs.existsSync(f));
 if(!oldFile)fail('KNOWN_PREVIOUS_TESTNET_DEPLOYER_KEY_NOT_FOUND');
 const source=loadKey(oldFile);
 if(getAddress(source.address)!==OLD)fail('ORIGINAL_DEPLOYER_WALLET_ADDRESS_MISMATCH');
 const {provider,vault}=await providerFor(config);
 try{
  const roles=await Promise.all([
   vault.DEFAULT_ADMIN_ROLE(),vault.MANAGER_ROLE(),
   vault.FUNDER_ROLE(),vault.GUARDIAN_ROLE()
  ]);
  if((await Promise.all(roles.map(role=>vault.hasRole(role,key.address)))).some(Boolean))
   fail('GAS_ONLY_SIGNER_HAS_UNSAFE_PRIVILEGED_ROLE');
  const [oldBalance,keeperBalance,feeData]=await Promise.all([
   provider.getBalance(OLD),provider.getBalance(key.address),provider.getFeeData()
  ]);
  const add=keeperBalance>=TARGET_GAS?0n:TARGET_GAS-keeperBalance;
  const price=feeData.gasPrice;
  if(!price||price<=0n||price*21000n>MAX_GAS_COST)
   fail('TESTNET_GAS_PRICE_TOO_HIGH');
  const fee=price*21000n;
  const enough=oldBalance>=add+fee+MIN_OLD_REMAINING;
  console.log('V3_KEEPER_GAS_TOPUP_PREFLIGHT '+JSON.stringify({
   chainId:97,fromOldTestnetDeployer:OLD,toSeparateGasOnlyWallet:key.address,
   originalTestBNB:formatEther(oldBalance),
   keeperTestBNB:formatEther(keeperBalance),
   exactTransferTestBNB:formatEther(add),maximumTestGasSpendBNB:formatEther(fee),
   sourceWalletRemainsSeparateFromManager:true,enoughTestBNB:enough,
   tokenTransfer:false,mainnet:false,transactionSent:false
  }));
  if(mode==='--check'||add===0n)return;
  if(!enough)fail('OLD_TESTNET_DEPLOYER_HAS_INSUFFICIENT_GAS_BUDGET');
  await confirm();
  const signer=source.connect(provider);
  const tx=await signer.sendTransaction({
   chainId:97,to:key.address,value:add,gasLimit:21000n,gasPrice:price
  });
  console.log('V3_KEEPER_TESTNET_GAS_TRANSFER_BROADCAST '+JSON.stringify({
   txHash:tx.hash,chainId:97,from:OLD,to:key.address,
   amountTestBNB:formatEther(add)
  }));
  const receipt=await waitV3KeeperReceipt(provider,tx.hash,{confirmations:2});
  if(getAddress(receipt.from)!==OLD||getAddress(receipt.to)!==key.address)
   fail('GAS_TRANSFER_CONFIRMED_RECEIPT_ACCOUNT_MISMATCH');
  const chainTx=await provider.getTransaction(tx.hash);
  if(!chainTx||chainTx.value!==add||getAddress(chainTx.to)!==key.address)
   fail('GAS_TRANSFER_CHAIN_VALUE_MISMATCH');
  console.log('V3_KEEPER_GAS_ONLY_TRANSFER_CONFIRMED '+JSON.stringify({
   chainId:97,txHash:receipt.hash,gasWallet:key.address,
   amountTestBNB:formatEther(add),confirmations:2,noERC20TokensMoved:true
  }));
 }finally{provider.destroy();}
}
main().catch(e=>{
 console.error('V3_KEEPER_GAS_TOPUP_BLOCKED '+String(e?.message||e));
 process.exitCode=1;
});
