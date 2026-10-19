// Scheduled maintenance for the existing test mocks. Never uses the owner key or mainnet.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {FetchRequest,Interface,JsonRpcProvider,Wallet,parseEther} from 'ethers';
import {readPrivateKey} from './migration-signers.mjs';
import {journalTransaction,writePrivateJson} from './migration-journal.mjs';
import {inspectMockFeeds,refreshMockFeeds} from './refresh-testnet-oracles.mjs';

const TARGET='0x731Ba0644e8f44BbBd48124F945724ba534431eb';
const OWNER='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
const DEPLOYER='0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2';
const ROOT='/var/lib/globaldroptrade/oracle-maintenance-v1';

export async function maintainOracles({provider,wallet,artifact,vaultAddress,feedAddresses,state,save,confirmations=3,log=()=>{},transact=journalTransaction}){
 const identity={chainId:97,vault:vaultAddress,feeds:feedAddresses,deployer:wallet.address};
 const guard=async()=>{
  if(Number(await provider.send('eth_chainId',[]))!==97)throw Error('TESTNET_ONLY');
  await inspectMockFeeds({provider,artifact,vaultAddress,feedAddresses});
 };
 await guard();
 if(state.identity&&JSON.stringify(state.identity)!==JSON.stringify(identity))throw Error('ORACLE_JOURNAL_TARGET_MISMATCH');
 state.identity=identity;state.transactions??={};save();
 const resume=async()=>{
  const {label,request}=state.pending;
  if(!feedAddresses.some(a=>a.toLowerCase()===request.to?.toLowerCase())||new Interface(artifact.abi).parseTransaction(request)?.name!=='set')throw Error('ORACLE_TRANSACTION_TARGET_MISMATCH');
  const receipt=await transact({provider,wallet,state,save,label,request,guard,confirmations,timeout:60000,maxTotalFee:parseEther('0.1'),log});
  delete state.pending;save();return receipt;
 };
 // Resume the identical signed transaction after interruption, before creating another.
 if(state.pending)await resume();
 const result=await refreshMockFeeds({provider,wallet,artifact,vaultAddress,feedAddresses,execute:async request=>{
  if(!feedAddresses.some(a=>a.toLowerCase()===request.to.toLowerCase()))throw Error('ORACLE_TRANSACTION_TARGET_MISMATCH');
  state.sequence=(state.sequence||0)+1;
  state.pending={label:'oracle-refresh-'+state.sequence,request:{to:request.to,data:request.data}};
  save();return resume();
 }});
 return {...result,checkedAt:new Date().toISOString(),feeBudgetTestBnb:'0.1',maxFeesReservedWei:Object.values(state.transactions).reduce((sum,t)=>sum+BigInt(t.maxFee),0n).toString()};
}

function privateDirectory(dir){
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const s=fs.lstatSync(dir);if(!s.isDirectory()||s.uid!==0||(s.mode&0o077)!==0)throw Error('PRIVATE_DIRECTORY_REQUIRED');
}
async function main(){
 let provider;
 try{
  if(process.getuid?.()!==0)throw Error('ROOT_REQUIRED');
  if(process.env.TRADES_CHAIN_ID!=='97'||process.env.TRADES_VAULT_ADDRESS!==TARGET||!process.env.TRADES_RPC_URL)throw Error('ACTIVE_TESTNET_TARGET_REQUIRED');
  const report=JSON.parse(fs.readFileSync('/var/lib/globaldroptrade/fresh-rewards-v1/deployment-public.json','utf8'));
  if(report.chainId!==97||report.kind!=='fresh-empty-deferred-rewards'||report.contractAddress!==TARGET||report.owner!==OWNER||report.deployer!==DEPLOYER||!report.verified)throw Error('FRESH_REPORT_MISMATCH');
  const feedAddresses=[report.config.bnbFeed,report.config.tokenFeed];
  const artifact=JSON.parse(fs.readFileSync(new URL('../artifacts/MockFeed.json',import.meta.url)));
  const transport=new FetchRequest(process.env.TRADES_RPC_URL);transport.timeout=15000;
  provider=new JsonRpcProvider(transport,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});provider.pollingInterval=2000;
  if(Number(await provider.send('eth_chainId',[]))!==97)throw Error('TESTNET_ONLY');
  await inspectMockFeeds({provider,artifact,vaultAddress:TARGET,feedAddresses});
  if(process.argv.includes('--check')){console.log('TESTNET_MOCK_ORACLES_VERIFIED');return;}
  const key=readPrivateKey('/etc/globaldroptrade/migration-deployer.key')||readPrivateKey('/root/global-testnet-v071/.testnet-server/deployer.key');
  if(!key)throw Error('DEPLOYER_KEY_NOT_FOUND');
  const wallet=new Wallet(key,provider);if(wallet.address!==DEPLOYER)throw Error('EXPECTED_DEPLOYER_KEY_REQUIRED');
  privateDirectory(ROOT);
  const file=path.join(ROOT,'journal.json');
  if(fs.existsSync(file)){const s=fs.lstatSync(file);if(!s.isFile()||s.uid!==0||(s.mode&0o077)!==0)throw Error('PRIVATE_JOURNAL_REQUIRED');}
  const state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
  const result=await maintainOracles({provider,wallet,artifact,vaultAddress:TARGET,feedAddresses,state,save:()=>writePrivateJson(file,state),log:console.log});
  writePrivateJson(path.join(ROOT,'status.json'),result);
  console.log('TESTNET_ORACLES_VALID refreshed='+result.transactions.length+' checkedAt='+result.checkedAt);
 }catch(e){
  const known={
   'Only BNB Testnet 97 is allowed':'TESTNET_ONLY',
   'Unexpected feeds: stopped':'ORACLE_FEED_MISMATCH',
   'Feed is not the reviewed MockFeed: stopped':'ORACLE_RUNTIME_MISMATCH',
   'Oracle age is too short for this five-minute maintenance schedule':'ORACLE_AGE_TOO_SHORT',
   'Invalid mock price data: stopped':'ORACLE_INVALID_ROUND',
   'Unexpected test gas price or cost':'TESTNET_GAS_COST_LIMIT',
   'Mock feed refresh not confirmed':'ORACLE_REFRESH_NOT_CONFIRMED'
  };
  const code=known[e.message]||(/^[A-Z][A-Z0-9_]{2,100}$/.test(e.message||'')?e.message:/^[A-Z][A-Z0-9_]{2,100}$/.test(e.code||'')?e.code:'ORACLE_VALIDATION_FAILED');
  console.error('ORACLE_MAINTENANCE_STOPPED '+code+' — keep the journal and check this service again.');process.exitCode=1;
 }finally{provider?.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
