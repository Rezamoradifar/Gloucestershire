// Enroll only the existing, council-authorized server operator; never reads the owner key.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Contract,FetchRequest,JsonRpcProvider,Wallet,ZeroAddress,getAddress} from 'ethers';
import {deferredPolicy,verifyDeferredImport} from './deferred-migration-core.mjs';
import {blockAtTime,dailyAbi} from './daily-profit.mjs';
import {readPrivateKey} from './migration-signers.mjs';

export async function verifyDeferredAutomation({provider,artifact,hash,seed,address,policy=deferredPolicy}){
 const report=await verifyDeferredImport({provider,artifact,hash,seed,policy});
 if(getAddress(address)!==report.target)throw Error('AUTOMATION_TARGET_MISMATCH');
 const vault=new Contract(address,[...dailyAbi,'function paused() view returns(bool)'],provider);
 if(await vault.paused())throw Error('OWNER_ACTIVATION_REQUIRED');
 if(!await vault.reporters(policy.operator))throw Error('COUNCIL_AUTHORIZED_SERVER_REPORTER_REQUIRED');
 const assets=[ZeroAddress,await vault.usdt()];let funded=false;
 for(const asset of assets){const rewards=(await vault.ledgers(asset)).rewards;if(rewards>0n&&await vault.assetBalance(asset)>=rewards)funded=true;}
 if(!funded)throw Error('FUNDED_DAILY_REWARD_BUDGET_REQUIRED');
 if(await provider.getBalance(policy.operator)===0n)throw Error('SERVER_OPERATOR_TEST_BNB_REQUIRED');
 const latest=await provider.getBlock('latest'),created=await provider.getBlock(report.block);
 let probeAddress=report.target,first=report.block;
 if(created.timestamp>latest.timestamp-86400){probeAddress=policy.source;first=(await provider.getTransactionReceipt(policy.creationHash)).blockNumber;}
 let historical;
 try{
  historical=await blockAtTime(provider,latest.timestamp-86400,first,latest.number);
  const old=new Contract(probeAddress,['function owner() view returns(address)','function accounts(address,address) view returns(uint256,uint256,uint256,uint256)','function dailyTargetBps(address) view returns(uint16)'],provider);
  const options={blockTag:historical.number},member=report.inventory.members[0]||policy.owner;
  await old.owner(options);await old.accounts(member,assets[1],options);await old.dailyTargetBps(member,options);
 }catch{throw Error('ARCHIVE_RPC_REQUIRED_FOR_PERIOD_START_PRINCIPAL');}
 return {...report,historicalStateProbeBlock:historical.number};
}

async function main(){
 if(process.getuid?.()!==0||process.env.TRADES_CHAIN_ID!=='97'||!process.env.TRADES_RPC_URL||!process.env.TRADES_VAULT_ADDRESS)throw Error('ROOT_TESTNET_CONFIGURATION_REQUIRED');
 const marker=JSON.parse(fs.readFileSync('/var/www/globaldroptrade/migration-data/deferred-connection.json','utf8'));
 const seed=JSON.parse(fs.readFileSync('/var/www/globaldroptrade/migration-data/deferred-seed.json','utf8'));
 const artifact=JSON.parse(fs.readFileSync('artifacts/TestnetDeferredMigrationVault.json'));
 const request=new FetchRequest(process.env.TRADES_RPC_URL);request.timeout=15000;
 const provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 try{
  await verifyDeferredAutomation({provider,artifact,hash:marker.hash,seed,address:process.env.TRADES_VAULT_ADDRESS});
  const file='/etc/globaldroptrade/automation.key';
  let key=readPrivateKey(file);
  if(!key){
   key=readPrivateKey('/etc/globaldroptrade/migration-deployer.key')||readPrivateKey('/root/global-testnet-v071/.testnet-server/deployer.key');
   if(!key||new Wallet(key).address!==deferredPolicy.operator)throw Error('EXISTING_SERVER_OPERATOR_KEY_REQUIRED');
   fs.writeFileSync(file,key+'\n',{mode:0o600,flag:'wx'});
  }
  if(new Wallet(key).address!==deferredPolicy.operator)throw Error('AUTOMATION_KEY_IS_NOT_THE_AUTHORIZED_OPERATOR');
  console.log('AUTHORIZED_SERVER_OPERATOR_AND_ARCHIVE_RPC_VERIFIED');
 }finally{provider.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{
 console.error('DAILY_PLAN_ENABLE_STOPPED '+(/^[A-Z][A-Z0-9_]{2,100}$/.test(e.message||'')?e.message:'RPC_OR_VERIFICATION_FAILED'));process.exitCode=1;
});
