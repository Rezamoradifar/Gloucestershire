// Read-only preflight; prepare private configuration without altering the live service.
import fs from 'node:fs';
import {parseEnv} from 'node:util';
import {Contract,ContractFactory,FetchRequest,JsonRpcProvider} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {renderSettings,verifyConnection} from './connect-settlement-feed.mjs';
const TARGET='0x731Ba0644e8f44BbBd48124F945724ba534431eb';
const OWNER='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
let provider;
try{
 const out=process.argv[2];if(!out)throw Error('OUTPUT_REQUIRED');
 const report=JSON.parse(fs.readFileSync('/var/lib/globaldroptrade/fresh-rewards-v1/deployment-public.json'));
 if(report.chainId!==97||report.kind!=='fresh-empty-deferred-rewards'||report.contractAddress!==TARGET||report.owner!==OWNER||!report.verified||report.accountsMigrated!==false)throw Error('REPORT_MISMATCH');
 const original=fs.readFileSync('/etc/globaldroptrade/trades.env','utf8'),settings=parseEnv(original);
 if(settings.TRADES_CHAIN_ID!=='97'||!settings.TRADES_RPC_URL)throw Error('TESTNET_RPC_REQUIRED');
 const request=new FetchRequest(settings.TRADES_RPC_URL);request.timeout=15000;
 provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 if(Number(await provider.send('eth_chainId',[]))!==97)throw Error('CHAIN_MISMATCH');
 const receipt=await provider.getTransactionReceipt(report.hash);
 if(!receipt||receipt.status!==1||receipt.contractAddress!==TARGET||receipt.blockHash!==report.blockHash)throw Error('RECEIPT_MISMATCH');
 const block=await provider.getBlock(receipt.blockNumber);
 if(block?.hash!==receipt.blockHash||await provider.getBlockNumber()<receipt.blockNumber+2)throw Error('CONFIRMATIONS_REQUIRED');
 const artifact=JSON.parse(fs.readFileSync(new URL('../deployment-console/DeferredRewardsVault.json',import.meta.url)));
 const c=report.config,expected=await new ContractFactory(artifact.abi,artifact.bytecode).getDeployTransaction(OWNER,c.token,c.bnbFeed,c.tokenFeed,c.age,c.partners,c.operations);
 const tx=await provider.getTransaction(report.hash);
 if(!tx||tx.from!=='0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2'||tx.to!==null||tx.data!==expected.data)throw Error('DEPLOYMENT_BYTECODE_MISMATCH');
 const vault=new Contract(TARGET,artifact.abi,provider);
 if(await vault.owner()!==OWNER||await vault.paused()||await vault.REWARD_ACCRUAL_VERSION()!==1n||await vault.withdrawalQueue()!==report.queue)throw Error('CONTRACT_STATE_MISMATCH');
 Object.assign(settings,{TRADES_CHAIN_ID:'97',TRADES_VAULT_ADDRESS:TARGET,TRADES_START_BLOCK:String(receipt.blockNumber),TRADES_LOG_PAGE_SIZE:'20',TRADES_PORT:'3115'});
 const connection=await verifyConnection(readConfig(settings),{provider});
 if(!connection.requestedPlanChecksMatch||!connection.networkControlsSupported)throw Error('PLAN_MISMATCH');
 fs.writeFileSync(out+'/trades.env',renderSettings(original,settings),{flag:'wx',mode:0o600});
 fs.writeFileSync(out+'/connection-public.json',JSON.stringify({...connection,rewardAccrualVersion:1,queue:report.queue},null,2),{flag:'wx',mode:0o600});
 console.log('FRESH_CONNECTION_PREFLIGHT_OK '+TARGET);
}catch(e){console.error('CUTOVER_PREFLIGHT_FAILED '+(/^[A-Z][A-Z0-9_]+$/.test(e.message||'')?e.message:'RPC_OR_REPORT_CHECK_FAILED'));process.exitCode=1;}finally{provider?.destroy();}
