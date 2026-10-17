// Read-only: no signer, private key, transaction or activation.
import fs from 'node:fs';
import {Contract,JsonRpcProvider,FetchRequest,getAddress,keccak256,ZeroAddress} from 'ethers';
import {readConfig} from '../server/trades-api.mjs';
const config=readConfig();
if(config.chainId!==97)throw Error('This preflight is restricted to BNB testnet (97).');
const address=getAddress(config.address);
const rpc=process.env.TRADES_RPC_URL;
if(!rpc)throw Error('TRADES_RPC_URL is required.');
const request=new FetchRequest(rpc);request.timeout=20000;
const provider=new JsonRpcProvider(request,97,{staticNetwork:true,batchMaxCount:1});
try{
 if(Number(await provider.send('eth_chainId',[]))!==97)throw Error('RPC chain mismatch.');
 const block=await provider.getBlock('latest');if(!block)throw Error('No confirmed block.');
 const options={blockTag:block.number},code=await provider.getCode(address,block.number);
 if(code==='0x')throw Error('Source contract has no code.');
 const artifact=JSON.parse(fs.readFileSync(new URL('../artifacts/DropshippingVault.json',import.meta.url)));
 const v=new Contract(address,artifact.abi,provider);
 const fields=['owner','pendingOwner','paused','usdt','bnbUsdFeed','usdtUsdFeed','maxOracleAge','dropshippingWallet','minDepositUsd','profitFeeBps','principalPenaltyBps','lockDuration','withdrawalCooldown','partnerVotesRequired','volumeJobCount'];
 const settings={};for(const name of fields)settings[name]=await v[name](options);
 const partners=[];for(let i=0;i<7;i++)partners.push(await v.partnerWallets(i,options));
 const assets=[];
 for(const asset of [ZeroAddress,settings.usdt]){
  const l=await v.ledgers(asset,options);
  assets.push({asset,cash:await v.assetBalance(asset,options),principal:l.principal,profit:l.profit,feeReserve:l.feeReserve,rewards:l.rewards,ownerCapitalOutstanding:await v.ownerCapitalOutstanding(asset,options)});
 }
 const canonical=await provider.getBlock(block.number);
 if(canonical?.hash!==block.hash)throw Error('Snapshot block changed; retry.');
 console.log(JSON.stringify({kind:'migration-preflight-only',chainId:97,address,block:block.number,blockHash:block.hash,codeHash:keccak256(code),settings,partners,assets,activationReady:false,blockers:['No user-state migration has been implemented or executed.','Pause does not disable legacy withdrawals. A balance copy alone does not prevent double claims.','A complete account, position, referral, group and consumed-volume inventory is required.'],transactionsSent:0},(_,value)=>typeof value==='bigint'?value.toString():value,2));
}catch{console.error('Preflight failed; no transaction or configuration change was made. Check RPC access and existing contract configuration.');process.exitCode=1;}finally{provider.destroy();}
