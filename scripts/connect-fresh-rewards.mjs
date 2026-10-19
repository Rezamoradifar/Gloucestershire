// Read-only preflight; prepare private configuration without altering the live service.
import fs from 'node:fs';
import {parseEnv} from 'node:util';
import {Contract,ContractFactory,FetchRequest,JsonRpcProvider} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {renderSettings,verifyConnection} from './connect-settlement-feed.mjs';
const TARGET='0x731Ba0644e8f44BbBd48124F945724ba534431eb';
const OWNER='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
const PUBLIC_RPC='https://bsc-testnet-rpc.publicnode.com';
async function attempt(rpcOverride){
let provider,phase='REPORT';
try{
 const out=process.argv[2];if(!out)throw Error('OUTPUT_REQUIRED');
 const report=JSON.parse(fs.readFileSync('/var/lib/globaldroptrade/fresh-rewards-v1/deployment-public.json'));
 if(report.chainId!==97||report.kind!=='fresh-empty-deferred-rewards'||report.contractAddress!==TARGET||report.owner!==OWNER||!report.verified||report.accountsMigrated!==false)throw Error('REPORT_MISMATCH');
 const original=fs.readFileSync('/etc/globaldroptrade/trades.env','utf8'),settings=parseEnv(original);
 if(settings.TRADES_CHAIN_ID!=='97'||!settings.TRADES_RPC_URL)throw Error('TESTNET_RPC_REQUIRED');
 if(rpcOverride)settings.TRADES_RPC_URL=rpcOverride;
 phase='CHAIN';
 const request=new FetchRequest(settings.TRADES_RPC_URL);request.timeout=15000;
 provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 if(Number(await provider.send('eth_chainId',[]))!==97)throw Error('CHAIN_MISMATCH');
 phase='RECEIPT';
 const receipt=await provider.getTransactionReceipt(report.hash);
 if(!receipt||receipt.status!==1||receipt.contractAddress!==TARGET||receipt.blockHash!==report.blockHash)throw Error('RECEIPT_MISMATCH');
 phase='CONFIRMATIONS';
 const block=await provider.getBlock(receipt.blockNumber);
 if(block?.hash!==receipt.blockHash||await provider.getBlockNumber()<receipt.blockNumber+2)throw Error('CONFIRMATIONS_REQUIRED');
 phase='DEPLOYMENT_BYTECODE';
 const artifact=JSON.parse(fs.readFileSync(new URL('../deployment-console/DeferredRewardsVault.json',import.meta.url)));
 const c=report.config,expected=await new ContractFactory(artifact.abi,artifact.bytecode).getDeployTransaction(OWNER,c.token,c.bnbFeed,c.tokenFeed,c.age,c.partners,c.operations);
 const tx=await provider.getTransaction(report.hash);
 if(!tx||tx.from!=='0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2'||tx.to!==null||tx.data!==expected.data)throw Error('DEPLOYMENT_BYTECODE_MISMATCH');
 phase='CONTRACT_STATE';
 const vault=new Contract(TARGET,artifact.abi,provider);
 if(await vault.owner()!==OWNER||await vault.paused()||await vault.REWARD_ACCRUAL_VERSION()!==1n||await vault.withdrawalQueue()!==report.queue)throw Error('CONTRACT_STATE_MISMATCH');
 // PublicNode supports larger ranges. Keep the same history window with fewer requests.
 Object.assign(settings,{TRADES_CHAIN_ID:'97',TRADES_VAULT_ADDRESS:TARGET,TRADES_START_BLOCK:String(receipt.blockNumber),TRADES_LOG_PAGE_SIZE:settings.TRADES_RPC_URL===PUBLIC_RPC?'1000':'20',TRADES_PORT:'3115'});
 phase='EVENT_LOGS';
 const end=(await provider.getBlockNumber())-Number(settings.TRADES_CONFIRMATIONS||3);
 await provider.getLogs({address:TARGET,fromBlock:Math.max(receipt.blockNumber,end-Number(settings.TRADES_LOG_PAGE_SIZE)+1),toBlock:end,topics:[vault.interface.getEvent('SaleSettled').topicHash]});
 phase='FEED_AND_PLAN';
 const connection=await verifyConnection(readConfig(settings),{provider});
 if(!connection.requestedPlanChecksMatch||!connection.networkControlsSupported)throw Error('PLAN_MISMATCH');
 phase='STAGED_CONFIGURATION';
 fs.writeFileSync(out+'/trades.env',renderSettings(original,settings),{flag:'wx',mode:0o600});
 fs.writeFileSync(out+'/connection-public.json',JSON.stringify({...connection,rewardAccrualVersion:1,queue:report.queue},null,2),{flag:'wx',mode:0o600});
 console.log('FRESH_CONNECTION_PREFLIGHT_OK '+TARGET);return true;
}catch(e){
 const code=/^[A-Z][A-Z0-9_]+$/.test(e.message||'')?e.message:/^[A-Z][A-Z0-9_]+$/.test(e.code||'')?e.code:'CHECK_FAILED';
 const rpcCode=e.info?.error?.code??e.error?.code;
 console.error('CUTOVER_PREFLIGHT_FAILED phase='+phase+' code='+code+(Number.isInteger(rpcCode)?' rpcCode='+rpcCode:''));
 return false;
}finally{provider?.destroy();}
}
let connected=false;
for(const [index,rpc] of [PUBLIC_RPC,'https://bsc-testnet-dataseed.bnbchain.org','https://bsc-testnet.bnbchain.org','https://bsc-prebsc-dataseed.bnbchain.org'].entries()){
 console.log('RPC_CANDIDATE_CHECK '+(index+1));
 if(await attempt(rpc)){connected=true;break;}
}
if(!connected)process.exitCode=1;
