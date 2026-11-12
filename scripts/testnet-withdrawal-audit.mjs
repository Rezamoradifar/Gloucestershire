// Read-only confirmed BNB Testnet vault and owner-approved withdrawal queue audit.
// Records are not promises of payout: liability, cash, and queue state are distinct.
import fs from 'node:fs';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {Contract,FetchRequest,JsonRpcProvider,getAddress,formatUnits,ZeroAddress} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
const target=getAddress('0x4C0F6141b18971db4b14e45c0bE8CddB09febc14');
const labels=['pending','paid','cancelled','approved'];
export function statusName(status){
 const n=Number(status);
 if(!Number.isSafeInteger(n)||n<0||n>=labels.length)throw Error('WITHDRAWAL_AUDIT_STATUS_INVALID');
 return labels[n];
}
export function summarizeQueueAudit({cash,pending,principal,profit,rewards,feeReserve,decimals=18}){
 const v=[cash,pending,principal,profit,rewards,feeReserve];
 if(v.some(value=>typeof value!=='bigint'||value<0n)||!Number.isInteger(decimals)||decimals<0||decimals>18)
  throw Error('WITHDRAWAL_AUDIT_ACCOUNTING_REQUIRED');
 // Queued claims are only one component. We do NOT treat surplus as backing
 // all external deposit and earned-profit claims.
 return {vaultCash:formatUnits(cash,decimals),
  queuedProfitLiability:formatUnits(pending,decimals),
  ledgerPrincipal:formatUnits(principal,decimals),
  ledgerCreditedProfit:formatUnits(profit,decimals),
  rewardBudget:formatUnits(rewards,decimals),
  feeReserve:formatUnits(feeReserve,decimals),
  queuedProfitCoveredByCurrentCash:cash>=pending,
  cashMinusQueuedProfit:formatUnits(cash>=pending?cash-pending:0n,decimals),
  allLiabilitiesCovered:null,
  note:'Current cash covering queued profit alone does not guarantee principal, accrued profit, or approved withdrawals will be paid.'};
}
async function main(){
 if(process.getuid?.()!==0||process.argv.length!==2)throw Error('WITHDRAWAL_AUDIT_ROOT_REQUIRED');
 const env=fs.readFileSync('/etc/globaldroptrade/trades.env','utf8'),
  config=readConfig(parseEnv(env));
 if(config.chainId!==97||getAddress(config.address)!==target||!config.rpcUrl)
  throw Error('WITHDRAWAL_AUDIT_TARGET_REQUIRED');
 const request=new FetchRequest(config.rpcUrl);request.timeout=15000;
 const provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 try{
  if(Number(await provider.send('eth_chainId',[]))!==97)throw Error('WITHDRAWAL_AUDIT_WRONG_CHAIN');
  const height=Math.max(0,(await provider.getBlockNumber())-Math.max(3,config.confirmations));
  const at=await provider.getBlock(height);
  if(!at?.hash)throw Error('WITHDRAWAL_AUDIT_BLOCK_REQUIRED');
  const vault=new Contract(target,[
   'function withdrawalQueue() view returns(address)',
   'function usdt() view returns(address)',
   'function tokenDecimals() view returns(uint8)',
   'function ledgers(address) view returns(uint256 principal,uint256 profit,uint256 feeReserve,uint256 rewards)',
   'function assetBalance(address) view returns(uint256)'
  ],provider);
  const options={blockTag:height},queueAddress=getAddress(await vault.withdrawalQueue(options));
  const queue=new Contract(queueAddress,[
   'function vault() view returns(address)',
   'function requestCount() view returns(uint256)',
   'function requests(uint256) view returns(address user,address asset,uint256 gross,uint256 fee,uint256 dueAt,uint8 status)',
   'function principalRequests(uint256) view returns(bool exists,uint256 position)',
   'function pending(address) view returns(uint256)'
  ],provider);
  if(getAddress(await queue.vault(options))!==target||
   await provider.getCode(queueAddress,height)==='0x')
   throw Error('WITHDRAWAL_AUDIT_QUEUE_IDENTITY_REQUIRED');
  const asset=getAddress(await vault.usdt(options)),decimals=Number(await vault.tokenDecimals(options));
  const [cash,pending,ledger,count]=await Promise.all([
   vault.assetBalance(asset,options),queue.pending(asset,options),
   vault.ledgers(asset,options),queue.requestCount(options)
  ]);
  const sample=[];
  const n=Number(count);
  if(!Number.isSafeInteger(n)||n<0)throw Error('WITHDRAWAL_AUDIT_REQUEST_COUNT_INVALID');
  for(let i=n-1;i>=Math.max(0,n-10);i--){
   const q=await queue.requests(BigInt(i),options),p=await queue.principalRequests(BigInt(i),options);
   sample.push({requestId:i,user:q.user,asset:q.asset,status:statusName(q.status),
    kind:p.exists?'principal':'profit',gross:formatUnits(q.gross,q.asset===ZeroAddress?18:decimals),
    fee:formatUnits(q.fee,q.asset===ZeroAddress?18:decimals),
    dueAt:new Date(Number(q.dueAt)*1000).toISOString()});
  }
  if((await provider.getBlock(height))?.hash!==at.hash)throw Error('WITHDRAWAL_AUDIT_REORG');
  console.log(JSON.stringify({version:1,kind:'read-only-confirmed-withdrawal-audit',
   chainId:97,vault:target,queue:queueAddress,snapshotBlock:height,
   requestCount:n,latestRequests:sample,
   stablecoin:summarizeQueueAudit({cash,pending,principal:ledger.principal,
    profit:ledger.profit,rewards:ledger.rewards,feeReserve:ledger.feeReserve,decimals}),
   signerOpened:false,transactionsSent:0},null,2));
 }finally{provider.destroy();}
}
let invoked;
try{if(process.argv[1])invoked=pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href;}catch{}
if(invoked===import.meta.url)main().catch(error=>{
 console.error(/^WITHDRAWAL_AUDIT_[A-Z0-9_]+$/.test(error?.message||'')?
  error.message:'WITHDRAWAL_AUDIT_RPC_OR_STATE_UNAVAILABLE');
 process.exitCode=1;
});
