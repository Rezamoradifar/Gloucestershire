// BNB Testnet only. One journalled vault deployment; existing users remain in the previous vault.
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {Contract,ContractFactory,FetchRequest,JsonRpcProvider,Wallet,Transaction,keccak256,getAddress,parseEther,formatEther} from 'ethers';
import {refreshMockFeeds} from './refresh-testnet-oracles.mjs';
export const PREVIOUS='0x7f19354B765920B9b17003d0840EEaA133883DcA';
export const NEW_OWNER='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
const check=(v,m)=>{if(!v)throw Error(m);};
const write=(file,data)=>{fs.writeFileSync(file+'.tmp',JSON.stringify(data,(_,v)=>typeof v==='bigint'?v.toString():v,2),{mode:0o600});fs.renameSync(file+'.tmp',file);};
export async function deployOwnerV2({provider,wallet,artifact,previous=PREVIOUS,owner=NEW_OWNER,dir,refresh}){
 check((await provider.getNetwork()).chainId===97n,'Only BNB Testnet 97 is allowed.');owner=getAddress(owner);previous=getAddress(previous);
 const old=new Contract(previous,artifact.abi,provider),options={blockTag:await provider.getBlockNumber()};
 const [token,bnbFeed,usdFeed,maxAge,operations,partners]=await Promise.all([old.usdt(options),old.bnbUsdFeed(options),old.usdtUsdFeed(options),old.maxOracleAge(options),old.dropshippingWallet(options),Promise.all(Array.from({length:7},(_,i)=>old.partnerWallets(i,options)))]);
 const args=[owner,token,bnbFeed,usdFeed,maxAge,partners,operations],request=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object).getDeployTransaction(...args);
 const deploymentData=request.data,fingerprint=keccak256(deploymentData),journal=path.join(dir,'deployment-private.json');fs.mkdirSync(dir,{recursive:true,mode:0o700});
 let state=fs.existsSync(journal)?JSON.parse(fs.readFileSync(journal,'utf8')):{chainId:97,previous,owner,deployer:wallet.address,fingerprint};
 check(state.chainId===97&&state.previous===previous&&state.owner===owner&&state.deployer===wallet.address&&state.fingerprint===fingerprint,'Saved deployment differs; preserve the journal and investigate.');
 const signer=wallet.connect(provider);
 if(!state.raw){
  check(await provider.getBalance(wallet.address)>=parseEther('0.03'),'Test deployer '+wallet.address+' needs at least 0.03 tBNB.');
  const gasPrice=(await provider.getFeeData()).gasPrice;check(gasPrice>0n&&gasPrice<=3000000000n,'Gas price exceeds 3 gwei.');
  if(refresh)await refresh();
  const gasLimit=await provider.estimateGas({...request,from:wallet.address})*125n/100n;
  check(gasLimit<=10000000n&&gasLimit*gasPrice<=parseEther('0.028'),'Vault deployment exceeds the 0.028 tBNB gas cap.');
  check((await provider.getNetwork()).chainId===97n,'RPC chain changed.');
  const nonce=await provider.getTransactionCount(wallet.address,'pending');
  state.raw=await signer.signTransaction({...request,chainId:97,type:0,gasPrice,gasLimit,nonce,value:0});state.hash=keccak256(state.raw);state.maxCost=(gasLimit*gasPrice).toString();write(journal,state);
 }
 const tx=Transaction.from(state.raw);
 check(tx.chainId===97n&&tx.from===wallet.address&&tx.to===null&&tx.value===0n&&tx.data===deploymentData&&keccak256(state.raw)===state.hash,'Journal transaction mismatch.');
 check(tx.gasLimit*(tx.gasPrice??0n)<=parseEther('0.028')&&(tx.gasPrice??0n)<=3000000000n,'Saved gas exceeds deployment cap.');
 let receipt=await provider.getTransactionReceipt(state.hash);
 if(!receipt){if(!await provider.getTransaction(state.hash)){try{await provider.broadcastTransaction(state.raw);}catch{check(await provider.getTransaction(state.hash),'Broadcast uncertain. Rerun with the same journal; do not delete it.');}}console.log('TESTNET_DEPLOY_TX https://testnet.bscscan.com/tx/'+state.hash);receipt=await provider.waitForTransaction(state.hash,1,45000);}
 check(receipt?.status===1&&receipt.contractAddress,'Deployment pending or reverted. Preserve the journal.');
 const address=getAddress(receipt.contractAddress),vault=new Contract(address,artifact.abi,provider);
 check((await provider.getNetwork()).chainId===97n&&await provider.getCode(address)!=='0x','Deployed code unavailable.');
 check(await vault.owner()===owner&&await vault.SALES_REFERRAL_MODEL_VERSION()===2n&&await vault.NETWORK_PLAN_VERSION()===2n,'Owner or contract model verification failed.');
 check(await vault.reporters(owner),'New owner must have reporter access.');
 for(const [name,value] of [['usdt',token],['bnbUsdFeed',bnbFeed],['usdtUsdFeed',usdFeed],['dropshippingWallet',operations]])check(await vault[name]()===value,'Asset/operations mismatch: '+name);
 for(let i=0;i<7;i++)check(await vault.partnerWallets(i)===partners[i],'Partner configuration mismatch.');
 for(const name of ['profitFeeBps','principalPenaltyBps','lockDuration','withdrawalCooldown','minDepositUsd','partnerVotesRequired'])check(await vault[name]()===await old[name](), 'Existing governed setting differs: '+name);
 for(let i=0;i<5;i++)check(JSON.stringify((await vault.tierConfig(i)).toArray(true),(_,v)=>typeof v==='bigint'?v.toString():v)===JSON.stringify((await old.tierConfig(i)).toArray(true),(_,v)=>typeof v==='bigint'?v.toString():v),'Tier configuration differs.');
 const mined=await provider.getTransaction(state.hash);check(mined?.data===deploymentData&&mined.from===wallet.address&&mined.chainId===97n,'Deployment creation provenance mismatch.');
 state.address=address;state.blockNumber=receipt.blockNumber;write(journal,state);
 const report={chainId:97,contractAddress:address,previousContract:previous,owner,usdt:token,bnbUsdFeed:bnbFeed,usdtUsdFeed:usdFeed,partners,dropshippingWallet:operations,salesModel:2,hash:state.hash,blockNumber:receipt.blockNumber,creationHash:fingerprint,verified:true,usersMigrated:false,maximumDeploymentGasCostTbnb:formatEther(BigInt(state.maxCost)),note:'Fresh testnet vault. Old balances/referrals remain in previousContract; do not treat this as a migration.'};
 write(path.join(dir,'deployment-public.json'),report);return report;
}
async function main(){
 const stateRoot='/root/global-testnet-v071/.testnet-server',key=path.join(stateRoot,'deployer.key');check(fs.existsSync(key)&&fs.lstatSync(key).isFile()&&(fs.statSync(key).mode&0o077)===0,'Existing private test deployer file is missing or permissions are not 600.');
 const wallet=new Wallet(fs.readFileSync(key,'utf8').trim());check(wallet.address==='0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2','Unexpected test deployer.');
 const rpc=new FetchRequest(process.env.BSC_TESTNET_RPC||'https://bsc-testnet-dataseed.bnbchain.org');rpc.timeout=15000;
 const provider=new JsonRpcProvider(rpc,undefined,{cacheTimeout:-1,batchMaxCount:1});provider.pollingInterval=2000;
 try{const artifact=JSON.parse(fs.readFileSync('artifacts/DropshippingVault.json')),feed=JSON.parse(fs.readFileSync('artifacts/MockFeed.json'));const result=await deployOwnerV2({provider,wallet,artifact,dir:path.join(stateRoot,'owner-v2-5bc282-20261015'),refresh:()=>refreshMockFeeds({provider,wallet,artifact:feed})});console.log(JSON.stringify(result,null,2));}finally{await provider.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e.shortMessage||e.message);process.exitCode=1;});
