// Read-only evidence gate. A reported transaction hash is not a receipt.
import fs from 'node:fs';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import {FetchRequest, JsonRpcProvider, id} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
import {readNewDeployerPrivateText} from './connect-new-deployer-testnet.mjs';

const hash=value=>typeof value==='string' && /^0x[0-9a-f]{64}$/i.test(value);
const fail=code=>{throw Error(code);};
const topic=id('ProfitCredited(address,address,uint256,bytes32)').toLowerCase();

export function validateLiveStatus(config,status,target,now=Date.now()) {
 if(config?.chainId!==97 || (config.vaultAddress??config.address??config.target)?.toLowerCase?.()!==target.toLowerCase()) fail('FINAL_TESTNET_CONFIG_IDENTITY_REQUIRED');
 if(status?.chainId!==97 || (status.vaultAddress??status.address??status.target)?.toLowerCase?.()!==target.toLowerCase()) fail('FINAL_TESTNET_AUTOMATION_IDENTITY_REQUIRED');
 const timestamp=typeof status.checkedAt==='string'?Date.parse(status.checkedAt):NaN;
 if(status.fresh!==true || !Number.isFinite(timestamp) || timestamp>now+60000 || now-timestamp>900000) fail('FINAL_TESTNET_STATUS_STALE');
 if(status.schedulerActive!==true) fail('FINAL_TESTNET_SCHEDULER_NOT_CONFIRMED');
 if(!['running','credited'].includes(status.status)||!['ready','not_due','scheduled'].includes(status.dailyStatus)) fail('FINAL_TESTNET_AUTOMATION_NOT_READY');
 if(!Array.isArray(status.blockers)||status.blockers.length!==0) fail('FINAL_TESTNET_BLOCKERS_PRESENT_OR_INVALID');
 const last=status.lastCredit;
 if(!Number.isSafeInteger(last?.epoch)||last.epoch<0||!Array.isArray(last.batches)||last.batches.length===0||last.batches.length>100) fail('FINAL_TESTNET_CREDIT_EVIDENCE_REQUIRED');
 for(const row of last.batches) if(!hash(row?.transactionHash)||!hash(row?.blockHash)||!Number.isSafeInteger(row?.block)||row.block<0) fail('FINAL_TESTNET_LAST_CREDIT_INVALID');
 return last.batches;
}

export async function verifyCreditReceipts(provider,batches,target) {
 if((await provider.getNetwork()).chainId!==97n) fail('FINAL_TESTNET_RECEIPT_CHAIN_REQUIRED');
 const head=await provider.getBlockNumber();
 for(const row of batches) {
  const [receipt,block]=await Promise.all([provider.getTransactionReceipt(row.transactionHash),provider.getBlock(row.block)]);
  if(!receipt||receipt.status!==1||receipt.blockNumber!==row.block||receipt.blockHash?.toLowerCase()!==row.blockHash.toLowerCase()||block?.hash?.toLowerCase()!==row.blockHash.toLowerCase()||head-row.block<3) fail('FINAL_TESTNET_RECEIPT_UNCONFIRMED');
  if(!Array.isArray(receipt.logs)||!receipt.logs.some(log=>log.address?.toLowerCase()===target.toLowerCase() && log.topics?.[0]?.toLowerCase()===topic)) fail('FINAL_TESTNET_RECEIPT_PROFIT_EVENT_REQUIRED');
 }
}

async function main() {
 const [configFile,statusFile,target]=process.argv.slice(2);
 const config=JSON.parse(fs.readFileSync(configFile,'utf8')),status=JSON.parse(fs.readFileSync(statusFile,'utf8'));
 const batches=validateLiveStatus(config,status,target);
 const settings=parseEnv(readNewDeployerPrivateText('/etc/globaldroptrade/trades.env'));
 const rpc=readConfig(settings);
 if(rpc.chainId!==97||rpc.address?.toLowerCase()!==target.toLowerCase()||!rpc.rpcUrl) fail('FINAL_TESTNET_PRIVATE_RPC_IDENTITY_REQUIRED');
 const request=new FetchRequest(rpc.rpcUrl);request.timeout=15000;
 const provider=new JsonRpcProvider(request);
 try { await verifyCreditReceipts(provider,batches,target); } finally { provider.destroy(); }
 console.log(JSON.stringify({chainId:97,target,creditEpoch:status.lastCredit.epoch,verifiedReceipts:batches.length}));
 console.log('FINAL_TESTNET_CREDIT_RECEIPTS_VERIFIED');
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(error=>{console.error(/^FINAL_TESTNET_[A-Z_]+$/.test(error?.message||'')?error.message:'FINAL_TESTNET_RECEIPT_CHECK_FAILED');process.exitCode=1;});
