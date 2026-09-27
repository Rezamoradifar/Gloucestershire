// BNB TESTNET ONLY. Sends at most 0.02 tBNB principal per new run, plus gas.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Wallet,JsonRpcProvider,Contract,ContractFactory,parseEther,getAddress,ZeroAddress,keccak256,toUtf8Bytes} from 'ethers';
const TARGET='0x8C77C442F6CB8C2462a12bB395186be944259504';
export async function liveHealth({provider,wallet,config,deployment,artifacts,dir}){
 if(Number((await provider.getNetwork()).chainId)!==97||deployment.chainId!==97)throw Error('Only BNB Testnet 97 is allowed.');
 const v=new Contract(deployment.contractAddress,artifacts.DropshippingVault.abi,wallet.connect(provider));
 if(wallet.address===getAddress(config.initialOwner))throw Error('Use the separate test deployer, not the owner wallet.');
 const destination=[await v.FEE_WALLET_1(),await v.FEE_WALLET_2(),await v.dropshippingWallet()];
 if(await v.owner()!==getAddress(config.initialOwner)||destination[2]!==getAddress(config.dropshippingWallet))throw Error('Configured owner/operations do not match.');
 for(let i=0;i<7;i++)if(await v.partnerWallets(i)!==getAddress(config.partners[i]))throw Error('Partner mismatch.');
 const addresses=[await v.usdt(),await v.bnbUsdFeed(),await v.usdtUsdFeed(),v.target];
 // Check exact original creation inputs before interacting with test mocks.
 for(let i=0;i<4;i++){
  const row=deployment.contracts[i],name=['MockToken','MockFeed','MockFeed','DropshippingVault'][i];
  const args=i===0?[18]:i===1?[60000000000n]:i===2?[100000000n]:[config.initialOwner,...addresses.slice(0,3),86400,config.partners,config.dropshippingWallet];
  const a=artifacts[name],expected=await new ContractFactory(a.abi,a.evm.bytecode.object).getDeployTransaction(...args);
  const tx=await provider.getTransaction(row.hash),receipt=await provider.getTransactionReceipt(row.hash);
  if(!tx||tx.chainId!==97n||tx.to!==null||tx.value!==0n||tx.data!==expected.data||receipt?.status!==1||receipt.contractAddress!==addresses[i])throw Error('Deployment provenance mismatch at step '+i);
 }
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const reportPath=path.join(dir,'health-public.json'),marker=path.join(dir,'health-run.json');
 if(fs.existsSync(marker)){
  const old=JSON.parse(fs.readFileSync(marker));
  if(old.contract!==v.target||old.wallet!==wallet.address)throw Error('Existing test belongs to a different contract or wallet.');
  if(fs.existsSync(reportPath)){
   const report=JSON.parse(fs.readFileSync(reportPath));
   if(report.status==='completed'){console.log('Previously completed; no new transactions sent.');return report;}
  }
  throw Error('A previous run started but did not complete. Do not delete health-run.json; inspect health-public.json before retrying.');
 }
 if(await provider.getBalance(wallet.address)<parseEther('0.03'))throw Error('Test deployer needs at least 0.03 tBNB: 0.02 deposit plus gas margin.');
 fs.writeFileSync(marker,JSON.stringify({contract:v.target,wallet:wallet.address,startedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
 const report={chainId:97,contract:v.target,tester:wallet.address,status:'running',checks:[],transactions:[],notTested:['Owner-authorized profit settlement and funded profit withdrawal','Live VIP level-four commission distribution','Principal refund after 90 days','Full security audit or financial solvency'],warning:'Test token and mock feeds only. Deposit principal leaves the vault; no withdrawal guarantee.'};
 const save=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
 const pass=(name,details={})=>{report.checks.push({name,status:'PASS',...details});console.log('PASS: '+name);save();};
 const equal=(a,b,message)=>{if(a!==b)throw Error(message);};
 const send=async(name,promise)=>{const tx=await promise;report.transactions.push({name,hash:tx.hash});save();const receipt=await tx.wait(1,180000);if(receipt?.status!==1)throw Error('Transaction failed: '+name);return receipt;};
 const rejected=async(name,fn,errorName)=>{
  try{await fn();}catch(e){
   const data=e.data||e.info?.error?.data?.result||e.info?.error?.data;
   let parsed;try{if(typeof data==='string')parsed=v.interface.parseError(data);}catch{}
   if(e.code==='CALL_EXCEPTION'&&(parsed?.name===errorName||e.revert?.name===errorName)){pass(name,{expectedError:errorName,simulationOnly:true});return;}
   throw Error('Could not confirm expected revert for '+name+'; RPC errors are not counted as passing.');
  }
  throw Error('Expected rejection did not occur: '+name);
 };
 try{
  pass('Deployed bytecode inputs, owner, operations wallet and seven partners match');
  const token=new Contract(addresses[0],artifacts.MockToken.abi,wallet.connect(provider));
  for(const [address,price]of [[addresses[1],60000000000n],[addresses[2],100000000n]]){
   const feed=new Contract(address,artifacts.MockFeed.abi,wallet.connect(provider));
   const block=await provider.getBlock('latest');const [,answer,,updated]=await feed.latestRoundData();
   if(answer!==price||BigInt(block.timestamp)-updated>3600n)await send('Refresh TEST mock feed',feed.set(price,block.timestamp,1,1));
  }
  pass('Test feeds are current');
  const u=await v.users(wallet.address),parent=u.registered?u.referrer:ZeroAddress;
  await rejected('Below-minimum deposit rejected',()=>v.deposit.staticCall(token.target,parseEther('1'),parent),'Insufficient');
  await rejected('Non-owner capital withdrawal rejected',()=>v.ownerWithdrawCapital.staticCall(token.target,wallet.address,1),'OwnableUnauthorizedAccount');
  await rejected('Non-reporter profit settlement rejected',()=>v.settleSalesProfit.staticCall(keccak256(toUtf8Bytes('health-check')),token.target,wallet.address,1,1,keccak256(toUtf8Bytes('test-only'))),'Unauthorized');
  for(const [asset,amount,label]of [[token.target,parseEther('100'),'TEST USDT'],[ZeroAddress,parseEther('0.02'),'test BNB']]){
   if(asset!==ZeroAddress){await send('Mint 100 TEST tokens',token.mint(wallet.address,amount));await send('Approve 100 TEST tokens',token.approve(v.target,amount));}
   const before=await Promise.all(destination.map(a=>asset===ZeroAddress?provider.getBalance(a):token.balanceOf(a)));
   const principal=(await v.accounts(wallet.address,asset)).principal;
   const index=await v.positionCount(wallet.address);
   const receipt=await send('Deposit '+label,v.deposit(asset,amount,parent,{value:asset===ZeroAddress?amount:0n}));
   const after=await Promise.all(destination.map(a=>asset===ZeroAddress?provider.getBalance(a,receipt.blockNumber):token.balanceOf(a,{blockTag:receipt.blockNumber})));
   const share=amount/10n;
   [share,share,amount-2n*share].forEach((expected,i)=>equal(after[i]-before[i],expected,label+' routing balance mismatch (check concurrent transfers).'));
   equal((await v.accounts(wallet.address,asset,{blockTag:receipt.blockNumber})).principal-principal,amount,'Recorded principal mismatch');
   pass(label+' deposit routed 10/10/80 and full principal recorded',{transaction:receipt.hash,amount:amount.toString(),shares:[share.toString(),share.toString(),(amount-2n*share).toString()]});
   await rejected(label+' principal locked before 90 days',()=>v.withdrawPrincipal.staticCall(index,amount),'Locked');
  }
  const tokenLedger=await v.accounts(wallet.address,token.target);
  if(tokenLedger.profit===0n&&await v.assetBalance(token.target)===0n)await rejected('Profit withdrawal with no liquidity rejected',()=>v.withdrawProfit.staticCall(token.target,1),'InsufficientLiquidity');
  else report.checks.push({name:'Empty-vault profit withdrawal',status:'SKIPPED',reason:'Vault or tester already has a funded balance; initial-state assumption not satisfied.'});
  report.status='completed';report.completedAt=new Date().toISOString();save();console.log('Report: '+reportPath);return report;
 }catch(e){report.status='failed';report.error=e.shortMessage||e.message;save();throw e;}
}
async function main(){
 const dir=path.resolve('.testnet-server'),key=path.join(dir,'deployer.key');
 if(!fs.existsSync(key)||((fs.statSync(key).mode&0o077)!==0))throw Error('Test deployer key missing or permissions are not 600.');
 const deployment=JSON.parse(fs.readFileSync(path.join(dir,'deployment-public.json')));
 if(getAddress(deployment.contractAddress)!==TARGET)throw Error('This command is pinned to the approved GLOBAL testnet contract.');
 const config=JSON.parse(fs.readFileSync('config.example.json'));
 const artifacts=Object.fromEntries(['MockToken','MockFeed','DropshippingVault'].map(n=>[n,JSON.parse(fs.readFileSync(`artifacts/${n}.json`))]));
 const provider=new JsonRpcProvider(process.env.BSC_TESTNET_RPC||'https://bsc-testnet-dataseed.bnbchain.org',undefined,{cacheTimeout:-1});provider.pollingInterval=2500;
 try{await liveHealth({provider,wallet:new Wallet(fs.readFileSync(key,'utf8').trim()),config,deployment,artifacts,dir});}finally{await provider.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e.shortMessage||e.message);process.exitCode=1;});
