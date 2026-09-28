// Real BNB gas is spent only by the explicit `deploy` command. No token approvals/deposits.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Wallet,JsonRpcProvider,FetchRequest,Contract,ContractFactory,Transaction,keccak256,formatEther,parseEther,getAddress} from 'ethers';
export async function prepareMainnet(provider,c,artifact,from){
 if((await provider.getNetwork()).chainId!==56n||c.chainId!==56)throw Error('Expected BNB MAINNET chain 56.');
 const pins={usdt:'0x55d398326f99059ff775485246999027b3197955',bnbUsdFeed:'0x0567f2323251f0aab15c8dfb1967e4e8a7d42aee',usdtUsdFeed:'0xb97ad0e74fa7d920791e90258a6e2085088b4320'};
 for(const [key,address]of Object.entries(pins))if(c[key].toLowerCase()!==address||await provider.getCode(c[key])==='0x')throw Error('Wrong mainnet contract: '+key);
 const owner=getAddress(c.initialOwner),ops=getAddress(c.dropshippingWallet),partners=c.partners.map(getAddress);
 if(partners.length!==7||new Set(partners).size!==7||c.maxOracleAge!==3600)throw Error('Invalid configuration.');
 const block=await provider.getBlock('latest');const feeds=[];
 for(const [key,description]of [['bnbUsdFeed','BNB / USD'],['usdtUsdFeed','USDT / USD']]){
  const f=new Contract(c[key],['function description() view returns(string)','function decimals() view returns(uint8)','function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)'],provider);
  const [desc,d,round]=await Promise.all([f.description(),f.decimals(),f.latestRoundData()]);const [r,a,,t,ar]=round;
  if(desc!==description||d!==8n||r===0n||a<=0n||t===0n||t>BigInt(block.timestamp)||BigInt(block.timestamp)-t>3600n||ar<r)throw Error('Invalid/stale live feed: '+key);
  feeds.push({address:c[key],description:desc,updatedAt:t.toString(),answer:a.toString()});
 }
 const token=new Contract(c.usdt,['function decimals() view returns(uint8)','function symbol() view returns(string)'],provider);
 if(await token.decimals()!==18n||await token.symbol()!=='USDT')throw Error('Unexpected mainnet token.');
 const args=[owner,c.usdt,c.bnbUsdFeed,c.usdtUsdFeed,3600,partners,ops];
 const request=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object).getDeployTransaction(...args);
 const gas=await provider.estimateGas({...request,from,value:0}),fees=await provider.getFeeData();
 if(!fees.gasPrice)throw Error('No gas price');const gasLimit=gas*120n/100n,cost=gasLimit*fees.gasPrice;
 if(cost>parseEther('0.02'))throw Error('Estimated gas exceeds 0.02 BNB safety limit. No transaction sent.');
 return {request,args,gasLimit,gasPrice:fees.gasPrice,cost,feeds};
}
async function main(){
 const action=process.argv[2]||'prepare';if(!['prepare','deploy'].includes(action))throw Error('Use prepare or deploy');
 const dir=path.resolve('.mainnet-server');fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const key=path.join(dir,'deployer.key');
 if(!fs.existsSync(key)){
  if(action!=='prepare')throw Error('Run prepare first.');
  fs.writeFileSync(key,Wallet.createRandom().privateKey+'\n',{flag:'wx',mode:0o600});
 }
 if((fs.statSync(key).mode&0o077)!==0)throw Error('Key permissions must be 600.');
 const wallet=new Wallet(fs.readFileSync(key,'utf8').trim());
 const rpc=new FetchRequest(process.env.BSC_MAINNET_RPC||'https://bsc-dataseed-public.bnbchain.org');rpc.timeout=20000;
 const provider=new JsonRpcProvider(rpc,undefined,{cacheTimeout:-1,batchMaxCount:1});provider.pollingInterval=2500;
 try{
  const config=JSON.parse(fs.readFileSync('config.mainnet.json')),artifact=JSON.parse(fs.readFileSync('artifacts/DropshippingVault.json'));
  const p=await prepareMainnet(provider,config,artifact,wallet.address);
  const preview={chainId:56,deployer:wallet.address,constructorArguments:p.args,estimatedMaxGasBNB:formatEther(p.cost),transactionValueBNB:'0',feeds:p.feeds,contractDataHash:keccak256(p.request.data),auditStatus:'Not independently audited; owner may withdraw all vault liquidity.'};
  fs.writeFileSync(path.join(dir,'deployment-preview.json'),JSON.stringify(preview,null,2));
  console.log('MAINNET DEPLOYER: '+wallet.address);console.log('ESTIMATED GAS: '+formatEther(p.cost)+' BNB');console.log('OWNER: '+config.initialOwner);
  if(action==='prepare'){console.log('No transaction signed or sent. Fund ONLY the displayed MAINNET DEPLOYER for gas, then run deploy.');return;}
  const journal=path.join(dir,'deployment-signed.json');let state;
  if(fs.existsSync(journal))state=JSON.parse(fs.readFileSync(journal));
  else{
   if(await provider.getBalance(wallet.address)<p.cost)throw Error('Insufficient REAL BNB for gas. No transaction signed.');
   const raw=await wallet.signTransaction({...p.request,value:0,chainId:56,type:0,nonce:await provider.getTransactionCount(wallet.address,'pending'),gasLimit:p.gasLimit,gasPrice:p.gasPrice});
   state={raw,hash:keccak256(raw)};fs.writeFileSync(journal,JSON.stringify(state),{flag:'wx',mode:0o600});
  }
  const tx=Transaction.from(state.raw);
  if(tx.from!==wallet.address||tx.chainId!==56n||tx.to!==null||tx.value!==0n||tx.data!==p.request.data||keccak256(state.raw)!==state.hash||tx.gasLimit*tx.gasPrice>parseEther('0.02'))throw Error('Saved transaction mismatch.');
  let receipt=await provider.getTransactionReceipt(state.hash);
  if(!receipt){
   if(!await provider.getTransaction(state.hash))await provider.broadcastTransaction(state.raw);
   console.log('TX: https://bscscan.com/tx/'+state.hash);
   receipt=await provider.waitForTransaction(state.hash,2,180000);
  }
  if(!receipt||receipt.status!==1)throw Error('Not confirmed successfully. Keep journal and rerun to inspect.');
  if(!receipt.contractAddress||await provider.getCode(receipt.contractAddress)==='0x')throw Error('No deployed code');
  const v=new Contract(receipt.contractAddress,artifact.abi,provider);
  for(const [method,expected]of [['owner',config.initialOwner],['dropshippingWallet',config.dropshippingWallet],['usdt',config.usdt],['bnbUsdFeed',config.bnbUsdFeed],['usdtUsdFeed',config.usdtUsdFeed]])if(getAddress(await v[method]())!==getAddress(expected))throw Error('Post-deployment check failed: '+method);
  for(let i=0;i<7;i++)if(getAddress(await v.partnerWallets(i))!==getAddress(config.partners[i]))throw Error('Partner check failed');
  const report={...preview,contractAddress:receipt.contractAddress,transactionHash:state.hash,blockNumber:receipt.blockNumber,explorer:'https://bscscan.com/address/'+receipt.contractAddress,sourceVerification:'Not yet submitted'};
  fs.writeFileSync(path.join(dir,'deployment-public.json'),JSON.stringify(report,null,2));console.log('MAINNET CONTRACT: '+report.explorer);
 }finally{await provider.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e.shortMessage||e.message);process.exitCode=1;});
