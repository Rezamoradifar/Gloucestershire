// Testnet-only server deployer. Never uses the user's owner private key.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Wallet,JsonRpcProvider,ContractFactory,Contract,Transaction,keccak256,formatEther,getAddress} from 'ethers';
export async function deployTestnet({provider,wallet,config,dir,artifacts}) {
 if(Number((await provider.getNetwork()).chainId)!==97||config.chainId!==97)throw Error('Only BNB Testnet chain 97 is allowed.');
 config.initialOwner=getAddress(config.initialOwner);config.dropshippingWallet=getAddress(config.dropshippingWallet);
 config.partners=config.partners.map(getAddress);
 if(config.partners.length!==7||new Set(config.partners).size!==7)throw Error('Exactly seven unique partners required.');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const file=path.join(dir,'deployment-journal.json');
 const write=v=>{fs.writeFileSync(file+'.tmp',JSON.stringify(v,null,2),{mode:0o600});fs.renameSync(file+'.tmp',file);};
 const frozen={chainId:97,initialOwner:config.initialOwner,partners:config.partners,dropshippingWallet:config.dropshippingWallet,maxOracleAge:86400};
 let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{config:frozen,deployer:wallet.address,steps:[]};
 if(JSON.stringify(state.config)!==JSON.stringify(frozen)||state.deployer!==wallet.address)throw Error('Saved deployment configuration differs; do not delete the journal.');
 const names=['MockToken','MockFeed','MockFeed','DropshippingVault'];
 for(let i=0;i<4;i++){
  const args=i===0?[18]:i===1?[60000000000n]:i===2?[100000000n]:[config.initialOwner,state.steps[0].address,state.steps[1].address,state.steps[2].address,86400,config.partners,config.dropshippingWallet];
  const a=artifacts[names[i]],request=await new ContractFactory(a.abi,a.evm.bytecode.object).getDeployTransaction(...args);
  let step=state.steps[i];
  if(!step){
   const gas=await provider.estimateGas({...request,from:wallet.address});
   const fees=await provider.getFeeData();if(!fees.gasPrice)throw Error('RPC did not return gas price.');
   const gasLimit=gas*120n/100n,cost=gasLimit*fees.gasPrice;
   if(await provider.getBalance(wallet.address)<cost)throw Error(`Insufficient tBNB. Deployer: ${wallet.address}; this step needs approximately ${formatEther(cost)} tBNB.`);
   const nonce=await provider.getTransactionCount(wallet.address,'pending');
   const raw=await wallet.signTransaction({...request,chainId:97,type:0,gasPrice:fees.gasPrice,gasLimit,nonce,value:0});
   step={name:names[i],hash:keccak256(raw),raw};state.steps[i]=step;write(state); // Save BEFORE broadcast for safe retries.
  }
  const parsed=Transaction.from(step.raw);
  if(parsed.chainId!==97n||parsed.from!==wallet.address||parsed.to!==null||parsed.value!==0n||parsed.data!==request.data||keccak256(step.raw)!==step.hash)throw Error('Journal transaction mismatch.');
  let receipt=await provider.getTransactionReceipt(step.hash);
  if(!receipt){
   if(!await provider.getTransaction(step.hash)){
    try{await provider.broadcastTransaction(step.raw);}catch(e){if(!await provider.getTransaction(step.hash))throw Error('Broadcast not confirmed. Re-run the same command; the saved transaction will be reused.');}
   }
   console.log(`Step ${i+1}/4: https://testnet.bscscan.com/tx/${step.hash}`);
   receipt=await provider.waitForTransaction(step.hash,1,180000);
  }
  if(!receipt)throw Error('Pending transaction. Re-run the same command to resume.');
  if(receipt.status!==1)throw Error('Transaction reverted: '+step.hash+'; keep the journal for diagnosis.');
  if(!receipt.contractAddress||await provider.getCode(receipt.contractAddress)==='0x')throw Error('Deployed code missing.');
  step.address=receipt.contractAddress;step.blockNumber=receipt.blockNumber;step.gasUsed=receipt.gasUsed.toString();write(state);
  console.log(`Confirmed ${names[i]}: ${step.address}`);
 }
 const address=state.steps[3].address,v=new Contract(address,artifacts.DropshippingVault.abi,provider);
 if(await v.owner()!==config.initialOwner||await v.dropshippingWallet()!==config.dropshippingWallet)throw Error('Ownership or operations mismatch.');
 for(let i=0;i<7;i++)if(await v.partnerWallets(i)!==config.partners[i])throw Error('Partner mismatch.');
 const report={environment:'BNB Testnet only; mock token and mock price feeds',chainId:97,deployer:wallet.address,config:frozen,contracts:state.steps.map(({raw,...publicStep})=>publicStep),contractAddress:address,explorer:'https://testnet.bscscan.com/address/'+address,verified:true};
 fs.writeFileSync(path.join(dir,'deployment-public.json'),JSON.stringify(report,null,2));return report;
}
async function main(){
 const command=process.argv[2]||'address';if(!['init','address','deploy'].includes(command))throw Error('Usage: node scripts/server-testnet.mjs init|address|deploy');
 const dir=path.resolve('.testnet-server'),key=path.join(dir,'deployer.key');fs.mkdirSync(dir,{recursive:true,mode:0o700});
 if(command==='init'&&!fs.existsSync(key))fs.writeFileSync(key,Wallet.createRandom().privateKey+'\n',{flag:'wx',mode:0o600});
 if(!fs.existsSync(key))throw Error('Run init first.');
 if((fs.statSync(key).mode&0o077)!==0)throw Error('Run chmod 600 .testnet-server/deployer.key');
 const wallet=new Wallet(fs.readFileSync(key,'utf8').trim());
 console.log('TEST-ONLY DEPLOYER: '+wallet.address);
 if(command!=='deploy'){console.log('Fund this address with testnet tBNB ONLY. Owner is configured separately. Never share deployer.key.');return;}
 const rpc=process.env.BSC_TESTNET_RPC||'https://bsc-testnet-dataseed.bnbchain.org';
 const provider=new JsonRpcProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=2500;
 try{
  const config=JSON.parse(fs.readFileSync('config.example.json'));
  const artifacts=Object.fromEntries(['MockToken','MockFeed','DropshippingVault'].map(n=>[n,JSON.parse(fs.readFileSync(`artifacts/${n}.json`))]));
  const report=await deployTestnet({provider,wallet,config,dir,artifacts});console.log('VERIFIED CONTRACT: '+report.explorer);console.log('Share only .testnet-server/deployment-public.json');
 }finally{await provider.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e.shortMessage||e.message);process.exitCode=1;});
