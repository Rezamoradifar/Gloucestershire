import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Contract,ContractFactory,FetchRequest,JsonRpcProvider,Wallet,ZeroAddress} from 'ethers';
import {readPrivateKey} from './migration-signers.mjs';
import {journalTransaction,writePrivateJson} from './migration-journal.mjs';

// Reads constructor settings only. Never pauses or writes to the old contract.
export async function deployFreshRewards({provider,wallet,source,owner,artifact,state,save,confirmations=3,log=()=>{},verifySource=async()=>{}}) {
 const guard=async()=>{if(Number(await provider.send('eth_chainId',[]))!==97)throw Error('TESTNET_ONLY');await verifySource();};
 await guard();
 if(!state.config){
  const block=await provider.getBlock('latest'),o={blockTag:block.number};
  const partners=[];for(let i=0;i<7;i++)partners.push(await source.partnerWallets(i,o));
  state.config={chainId:97,owner,source:await source.getAddress(),token:await source.usdt(o),bnbFeed:await source.bnbUsdFeed(o),tokenFeed:await source.usdtUsdFeed(o),age:(await source.maxOracleAge(o)).toString(),partners,operations:await source.dropshippingWallet(o)};
  save();
 }
 const c=state.config;
 if(c.chainId!==97||c.owner!==owner||c.source!==await source.getAddress())throw Error('FRESH_CONFIGURATION_MISMATCH');
 const args=[owner,c.token,c.bnbFeed,c.tokenFeed,c.age,c.partners,c.operations];
 const request=await new ContractFactory(artifact.abi,artifact.bytecode).getDeployTransaction(...args);
 const receipt=await journalTransaction({provider,wallet,state,save,label:'fresh-deploy',request,guard,log,confirmations});
 const vault=new Contract(receipt.contractAddress,artifact.abi,provider),o={blockTag:receipt.blockNumber};
 if(await vault.owner(o)!==owner||await vault.paused(o)||await vault.REWARD_ACCRUAL_VERSION(o)!==1n||await vault.volumeJobCount(o)!==0n)throw Error('FRESH_VERIFY_FAILED');
 for(const [method,expected] of [['usdt',c.token],['bnbUsdFeed',c.bnbFeed],['usdtUsdFeed',c.tokenFeed],['dropshippingWallet',c.operations]])if(await vault[method](o)!==expected)throw Error('FRESH_SETTINGS_MISMATCH');
 if(await vault.maxOracleAge(o)!==BigInt(c.age))throw Error('FRESH_SETTINGS_MISMATCH');
 for(let i=0;i<7;i++)if(await vault.partnerWallets(i,o)!==c.partners[i])throw Error('FRESH_PARTNER_MISMATCH');
 for(const asset of [ZeroAddress,c.token])if((await vault.ledgers(asset,o)).some(value=>value!==0n))throw Error('FRESH_LEDGER_NOT_EMPTY');
 const queue=await vault.withdrawalQueue(o);
 if(queue===ZeroAddress||await provider.getCode(queue,receipt.blockNumber)==='0x')throw Error('FRESH_QUEUE_MISSING');
 if((await provider.getBlock(receipt.blockNumber))?.hash!==receipt.blockHash)throw Error('FRESH_REORG');
 return {chainId:97,kind:'fresh-empty-deferred-rewards',contractAddress:receipt.contractAddress,owner,deployer:wallet.address,hash:receipt.hash,block:receipt.blockNumber,blockHash:receipt.blockHash,queue,config:c,verified:true,accountsMigrated:false,siteConnected:false};
}

async function main(){
 let provider;
 try{
  if(process.getuid?.()!==0)throw Error('ROOT_REQUIRED');
  if(process.env.TRADES_CHAIN_ID!=='97'||!process.env.TRADES_RPC_URL)throw Error('TESTNET_RPC_REQUIRED');
  const key=readPrivateKey('/etc/globaldroptrade/migration-deployer.key')||readPrivateKey('/root/global-testnet-v071/.testnet-server/deployer.key');
  if(!key)throw Error('DEPLOYER_KEY_NOT_FOUND');
  const transport=new FetchRequest(process.env.TRADES_RPC_URL);transport.timeout=20000;
  provider=new JsonRpcProvider(transport,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  const wallet=new Wallet(key,provider);
  if(wallet.address!=='0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2')throw Error('EXPECTED_DEPLOYER_KEY_REQUIRED');
  const dir='/var/lib/globaldroptrade/fresh-rewards-v1';fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const stat=fs.lstatSync(dir);if(!stat.isDirectory()||stat.uid!==0||(stat.mode&0o077)!==0)throw Error('PRIVATE_DIRECTORY_REQUIRED');
  const file=path.join(dir,'journal.json');
  if(fs.existsSync(file)){const s=fs.lstatSync(file);if(!s.isFile()||s.uid!==0||(s.mode&0o077)!==0)throw Error('PRIVATE_JOURNAL_REQUIRED');}
  const state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{transactions:{}};
  const load=name=>JSON.parse(fs.readFileSync(new URL('../deployment-console/'+name+'.json',import.meta.url)));
  const source=new Contract('0x4f65014A86Af841bF7a72F49E9AEB4432a72Db8F',load('DropshippingVault').abi,provider);
  const report=await deployFreshRewards({provider,wallet,source,owner:'0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632',artifact:load('DeferredRewardsVault'),state,save:()=>writePrivateJson(file,state),log:console.log});
  writePrivateJson(path.join(dir,'deployment-public.json'),report);
  console.log('FRESH_REWARDS_DEPLOYED');console.log('NEW_CONTRACT='+report.contractAddress);console.log('REPORT='+path.join(dir,'deployment-public.json'));
  console.log('No accounts migrated. Website/API still require connection to the new address.');
 }catch(e){console.error('FRESH_DEPLOY_STOPPED '+(/^[A-Z][A-Z0-9_]{2,100}$/.test(e.message||'')?e.message:'RPC_OR_VERIFICATION_FAILED'));console.error('Keep the fresh journal and rerun the same command to resume.');process.exitCode=1;}
 finally{provider?.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
