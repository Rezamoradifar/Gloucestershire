import fs from 'node:fs';
import path from 'node:path';
import {Contract,ContractFactory,FetchRequest,JsonRpcProvider,ZeroAddress,getAddress,Transaction} from 'ethers';
import {loadMigrationSigners} from './migration-signers.mjs';
import {scanInventory,verifyCopy} from './migration-core.mjs';
import {journalTransaction,writePrivateJson} from './migration-journal.mjs';

const SOURCE='0x4f65014A86Af841bF7a72F49E9AEB4432a72Db8F';
const OWNER='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
const folder='/var/lib/globaldroptrade/migration-v1';
const keyfile='/etc/globaldroptrade/migration-owner.key';
const statefile=path.join(folder,'journal.json');
const reportfile=path.join(folder,'report.json');
let provider,phase='preflight';
const log=x=>console.log(new Date().toISOString(),x);
try {
 if(process.getuid?.()!==0)throw Error('ROOT_REQUIRED');
 if(process.env.TRADES_CHAIN_ID!=='97'||getAddress(process.env.TRADES_VAULT_ADDRESS||'')!==SOURCE)throw Error('SOURCE_CONFIGURATION_MISMATCH');
 const rpc=process.env.TRADES_RPC_URL;if(!rpc)throw Error('RPC_REQUIRED');
 const transport=new FetchRequest(rpc);transport.timeout=20000;
 provider=new JsonRpcProvider(transport,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 const {deployer,ownerWallet}=loadMigrationSigners({provider,owner:OWNER,ownerFile:keyfile,deployerFile:process.env.MIGRATION_DEPLOYER_KEY_FILE||'/etc/globaldroptrade/migration-deployer.key'});
 log('DEPLOYER='+deployer.address+' OWNER='+OWNER);
 const load=name=>JSON.parse(fs.readFileSync(new URL('../deployment-console/'+name+'.json',import.meta.url),'utf8'));
 const old=load('DropshippingVault'),artifact=load('TestnetMigratedRewardsVault');
 const source=new Contract(SOURCE,old.abi,provider);
 const guard=async()=>{
  if(Number(await provider.send('eth_chainId',[]))!==97)throw Error('TESTNET_ONLY');
  if(await source.owner()!==OWNER)throw Error('SOURCE_OWNER_CHANGED');
 };
 await guard();
 fs.mkdirSync(folder,{recursive:true,mode:0o700});
 const folderstat=fs.lstatSync(folder);
 if(!folderstat.isDirectory()||folderstat.uid!==0||(folderstat.mode&0o077)!==0)throw Error('PRIVATE_STATE_DIRECTORY_REQUIRED');
 for(const file of [statefile,reportfile])if(fs.existsSync(file)&&(!fs.lstatSync(file).isFile()||(fs.statSync(file).mode&0o077)!==0))throw Error('PRIVATE_REGULAR_STATE_FILE_REQUIRED');
 const state=fs.existsSync(statefile)?JSON.parse(fs.readFileSync(statefile,'utf8')):{chainId:97,source:SOURCE,owner:OWNER,transactions:{}};
 if(state.chainId!==97||state.source!==SOURCE||state.owner!==OWNER)throw Error('STATE_SOURCE_MISMATCH');
 const save=()=>writePrivateJson(statefile,state);
 const send=(label,request)=>{
  let wallet=label==='deploy'?deployer:ownerWallet;
  if(state.transactions[label]){
   const expected=Transaction.from(state.transactions[label].raw).from;
   wallet=[deployer,ownerWallet].find(w=>w?.address===expected);
   if(!wallet)throw Error('JOURNAL_SIGNER_KEY_REQUIRED');
  }
  if(!wallet){
   writePrivateJson(path.join(folder,'owner-action.json'),{chainId:97,owner:OWNER,action:label,to:request.to,data:request.data,value:'0',report:label==='activate'?reportfile:null});
   log('OWNER_ACTION_REQUIRED='+label+' FILE='+path.join(folder,'owner-action.json'));
   throw Error('OWNER_SIGNATURE_REQUIRED');
  }
  if(label!=='deploy'&&wallet.address!==OWNER)throw Error('OWNER_SIGNATURE_REQUIRED');
  return journalTransaction({provider,wallet,state,save,label,request,guard,log});
 };
 const treasury=async()=>{
  for(const asset of [ZeroAddress,await source.usdt()]){
   const ledger=await source.ledgers(asset);
   if(await source.assetBalance(asset)!==0n||ledger.feeReserve!==0n||ledger.rewards!==0n)throw Error('SOURCE_TREASURY_NOT_EMPTY_NO_FUNDS_MOVED');
  }
 };
 if(!state.transactions.deploy){
  await treasury();
  if(await source.pendingOwner()!==ZeroAddress)throw Error('PENDING_OWNER');
  if(!await source.paused()&&!ownerWallet){phase='pause';await send('pause',await source.setPaused.populateTransaction(true));}
  // Complete a read-only log scan before pausing, so unsupported RPCs don't interrupt the site.
  phase='scan-before-pause';await scanInventory(provider,source,log);
  phase='pause';
  if(state.transactions.pause||!await source.paused())await send('pause',await source.setPaused.populateTransaction(true));
  if(!await source.paused())throw Error('SOURCE_NOT_PAUSED');
  phase='scan';state.inventory=await scanInventory(provider,source,log);save();
 }
 if(!await source.paused())throw Error('SOURCE_REACTIVATED');
 const inventory=state.inventory;if(!inventory)throw Error('MISSING_JOURNAL_INVENTORY');
 if((await provider.getBlock(inventory.block))?.hash!==inventory.blockHash)throw Error('INVENTORY_REORG');
 const factory=new ContractFactory(artifact.abi,artifact.bytecode);
 const request=await factory.getDeployTransaction(SOURCE,inventory.members,inventory.settlements,inventory.batches);
 if((request.data.length-2)/2>49152)throw Error('INIT_CODE_LIMIT');
 phase='deploy';const receipt=await send('deploy',request);
 phase='verify';
 const result=await verifyCopy(provider,source,artifact,receipt,inventory,log);
 const report={chainId:97,source:SOURCE,owner:OWNER,deployer:Transaction.from(state.transactions.deploy.raw).from,hash:state.transactions.deploy.hash,inventory,...result,activated:false,legacyClaimsExtinguished:false,siteConnected:false};
 writePrivateJson(reportfile,report);
 phase='activate';await guard();
 if(!await source.paused())throw Error('SOURCE_REACTIVATED');
 const target=new Contract(result.target,artifact.abi,provider);
 if(await target.owner()!==OWNER)throw Error('TARGET_OWNER_MISMATCH');
 if(state.transactions.activate||await target.paused())await send('activate',await target.setPaused.populateTransaction(false));
 if(await target.paused())throw Error('TARGET_STILL_PAUSED');
 report.activated=true;report.activationHash=state.transactions.activate?.hash;writePrivateJson(reportfile,report);
 log('TESTNET_MIGRATION_COMPLETE');log('NEW_CONTRACT='+result.target);log('REPORT='+reportfile);
 log('Legacy claims remain independent. Site/API address is unchanged.');
} catch(e) {
 // Never print provider errors: they can contain RPC credentials or signed payloads.
 const safe=typeof e.message==='string'&&/^[A-Z][A-Z0-9_]{2,100}$/.test(e.message)?e.message:'RPC_OR_STATE_CHECK_FAILED';
 console.error('MIGRATION_STOPPED phase='+phase+' code='+safe);
 console.error('Keep the journal. Re-run the same command to resume; do not delete it or start a separate wallet deployment.');
 process.exitCode=1;
} finally {provider?.destroy();}
