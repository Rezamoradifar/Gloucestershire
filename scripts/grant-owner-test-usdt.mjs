// One resumable grant of 10,000,000 existing test tokens. BNB Testnet 97 only.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Contract,ContractFactory,FetchRequest,JsonRpcProvider,Transaction,Wallet,ZeroAddress,formatUnits,parseEther,parseUnits} from 'ethers';
import {journalTransaction,writePrivateJson} from './migration-journal.mjs';
import {readPrivateKey} from './migration-signers.mjs';

export const TARGET={
 vault:'0x731Ba0644e8f44BbBd48124F945724ba534431eb',
 token:'0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89',
 recipient:'0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632',
 deployer:'0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2'
};
const ROOT='/var/lib/globaldroptrade/test-token-grants/owner-10m-20261019';
const AMOUNT=parseUnits('10000000',18),MAX_FEE=parseEther('0.001');
const LABEL='owner-test-usdt-10m-20261019';

export async function grantOwnerTestUsdt({provider,wallet,artifact,state,save,target=TARGET,confirmations=3,log=()=>{},transact=journalTransaction}){
 if(wallet.address!==target.deployer)throw Error('EXPECTED_DEPLOYER_KEY_REQUIRED');
 const token=new Contract(target.token,artifact.abi,provider);
 const vault=new Contract(target.vault,[
  'function usdt() view returns(address)', 'function owner() view returns(address)',
  'function tokenDecimals() view returns(uint8)'
 ],provider);
 let expectedRuntime;
 const guard=async()=>{
  if(Number(await provider.send('eth_chainId',[]))!==97)throw Error('TESTNET_ONLY');
  // Simulate creation without broadcasting. This resolves the decimals immutable
  // exactly, unlike comparing the compiler's unpatched runtime template.
  expectedRuntime??=await provider.call(await new ContractFactory(artifact.abi,artifact.evm.bytecode.object).getDeployTransaction(18));
  if(expectedRuntime==='0x'||(await provider.getCode(target.token)).toLowerCase()!==expectedRuntime.toLowerCase())throw Error('REVIEWED_TEST_TOKEN_REQUIRED');
  if(await vault.usdt()!==target.token||await vault.owner()!==target.recipient||await vault.tokenDecimals()!==18n)throw Error('ACTIVE_VAULT_TOKEN_MISMATCH');
  if(await token.decimals()!==18n||await token.name()!=='Test USDT'||await token.symbol()!=='TUSDT')throw Error('TEST_TOKEN_METADATA_MISMATCH');
 };
 await guard();
 const identity={version:1,chainId:97,...target,amount:AMOUNT.toString(),grant:LABEL};
 if(Object.keys(state).length&&JSON.stringify(state.identity)!==JSON.stringify(identity))throw Error('GRANT_JOURNAL_TARGET_MISMATCH');
 if(Object.keys(state.transactions||{}).some(key=>key!==LABEL))throw Error('UNEXPECTED_GRANT_TRANSACTION');
 const existing=state.transactions?.[LABEL];
 if(existing){
  const tx=Transaction.from(existing.raw);
  if(tx.gasPrice===null||tx.gasPrice*tx.gasLimit>MAX_FEE)throw Error('GRANT_TEST_BNB_FEE_LIMIT_0_001');
 }
 if(!state.identity){
  state.identity=identity;state.transactions={};
  state.balanceBefore=(await token.balanceOf(target.recipient)).toString();
  state.startedAt=new Date().toISOString();save();
 }
 const request={to:target.token,data:token.interface.encodeFunctionData('mint',[target.recipient,AMOUNT])};
 const receipt=await transact({provider,wallet,state,save,label:LABEL,request,guard,confirmations,timeout:180000,maxTotalFee:MAX_FEE,log});
 const transfers=receipt.logs.filter(row=>row.address.toLowerCase()===target.token.toLowerCase()).map(row=>{
  try{return token.interface.parseLog(row);}catch{return null;}
 }).filter(event=>event?.name==='Transfer');
 if(transfers.length!==1||transfers[0].args.from!==ZeroAddress||transfers[0].args.to!==target.recipient||transfers[0].args.value!==AMOUNT)throw Error('MINT_RECEIPT_MISMATCH');
 const balance=await token.balanceOf(target.recipient);
 const report={status:'TEST_USDT_GRANT_CONFIRMED',chainId:97,token:target.token,recipient:target.recipient,
  amountTestUsdt:'10000000',transaction:receipt.hash,block:receipt.blockNumber,blockHash:receipt.blockHash,
  balanceTestUsdt:formatUnits(balance,18),balanceCheckedAt:new Date().toISOString()};
 state.completed=true;state.report=report;save();return report;
}

function privatePath(file,directory=false){
 const s=fs.lstatSync(file);
 if(!(directory?s.isDirectory():s.isFile())||s.uid!==0||(s.mode&0o077)!==0)throw Error('ROOT_ONLY_STATE_REQUIRED');
}
async function main(){
 let provider;
 try{
  if(process.getuid?.()!==0)throw Error('ROOT_REQUIRED');
  if(process.env.TRADES_CHAIN_ID!=='97'||process.env.TRADES_VAULT_ADDRESS!==TARGET.vault||!process.env.TRADES_RPC_URL)throw Error('ACTIVE_TESTNET_TARGET_REQUIRED');
  privatePath(ROOT,true);
  // The launcher holds the oracle lock. Do not consume a nonce reserved by a
  // previously interrupted maintenance transaction, even if it is not in the pool.
  const oracleJournal='/var/lib/globaldroptrade/oracle-maintenance-v1/journal.json';
  if(fs.existsSync(oracleJournal)){
   privatePath(oracleJournal);
   if(JSON.parse(fs.readFileSync(oracleJournal,'utf8')).pending)throw Error('RESUME_PENDING_ORACLE_MAINTENANCE_FIRST');
  }
  const file=path.join(ROOT,'journal.json');
  if(fs.existsSync(file))privatePath(file);
  const state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
  const key=readPrivateKey('/etc/globaldroptrade/migration-deployer.key')||readPrivateKey('/root/global-testnet-v071/.testnet-server/deployer.key');
  if(!key)throw Error('DEPLOYER_KEY_NOT_FOUND');
  const transport=new FetchRequest(process.env.TRADES_RPC_URL);transport.timeout=15000;
  provider=new JsonRpcProvider(transport,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});provider.pollingInterval=2000;
  const artifact=JSON.parse(fs.readFileSync(new URL('../artifacts/MockToken.json',import.meta.url)));
  const report=await grantOwnerTestUsdt({provider,wallet:new Wallet(key,provider),artifact,state,save:()=>writePrivateJson(file,state),log:console.log});
  writePrivateJson(path.join(ROOT,'grant-public.json'),report);
  console.log(report.status);
  console.log('RECIPIENT='+report.recipient);
  console.log('AMOUNT_TEST_USDT='+report.amountTestUsdt);
  console.log('BALANCE_TEST_USDT='+report.balanceTestUsdt);
  console.log('TX=https://testnet.bscscan.com/tx/'+report.transaction);
 }catch(e){
  const code=e.message==='TOTAL_TEST_BNB_FEE_LIMIT_0_1'?'GRANT_TEST_BNB_FEE_LIMIT_0_001':
   /^[A-Z][A-Z0-9_]{2,100}$/.test(e.message||'')?e.message:/^[A-Z][A-Z0-9_]{2,100}$/.test(e.code||'')?e.code:'GRANT_CHECK_FAILED';
  console.error('TEST_USDT_GRANT_STOPPED '+code);
  console.error('Keep the journal. Re-run the same launcher to resume the same grant.');process.exitCode=1;
 }finally{provider?.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
