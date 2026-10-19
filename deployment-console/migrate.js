import {selectWalletProvider} from './wallet-provider.js?v=3';
import {BrowserProvider,Contract,ContractFactory,formatEther,getAddress} from './ethers.js';
const SOURCE='0x4f65014A86Af841bF7a72F49E9AEB4432a72Db8F';
const OWNER='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
const key='global-testnet-migration-v1-'+SOURCE;
const $=id=>document.getElementById(id),out=x=>{$('status').textContent=x;};
let provider,signer,source,artifact,inventory,report,request,gasLimit;
let busy=false;
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v);
function save(){localStorage.setItem(key,json({inventory,report}));}
async function guard(){if(Number((await provider.getNetwork()).chainId)!==97)throw Error('Only chain 97 is allowed.');const accounts=await provider.send('eth_accounts',[]);if(!accounts.length||getAddress(accounts[0])!==OWNER||getAddress(await signer.getAddress())!==OWNER)throw Error('The owner wallet changed. Reconnect.');if(await source.owner()!==OWNER)throw Error('The source owner changed.');}
function controls(){const connected=!!source;for(const id of ['connect','pause','scan','estimate','deploy','verify','activate','download'])$(id).disabled=busy;
 if(!busy){$('pause').disabled=!connected;$('scan').disabled=!connected;$('estimate').disabled=!inventory||!connected||!!report?.hash;$('deploy').disabled=!request||!$('accept').checked||!!report?.hash;$('verify').disabled=!connected||!report?.hash;$('activate').disabled=!connected||!report?.verified||!!report?.activated;$('download').disabled=!report?.verified;}}
function action(id,fn){$(id).onclick=async()=>{if(busy)return;busy=true;controls();try{await fn();}catch(e){out(e.shortMessage||e.message);}finally{busy=false;controls();}};}
$('source').textContent=SOURCE;$('accept').onchange=controls;
action('connect',async()=>{
 source=undefined;request=undefined;
 const injected=selectWalletProvider(window);
 if(!injected)throw Error('No wallet detected. Open the link in the SafePal DApp browser.');
 out('Waiting for SafePal connection approval. Confirm in your wallet.');
 await injected.request({method:'eth_requestAccounts'});
 if(Number(await injected.request({method:'eth_chainId'}))!==97){
  out('Approve switching to BNB Testnet in your wallet.');
  try{await injected.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x61'}]});}
  catch{throw Error('Select BNB Testnet (97) in your wallet and connect again.');}
 }
 provider=new BrowserProvider(injected);signer=await provider.getSigner();
 out('Verifying the owner and loading contract data…');
 const [old,next]=await Promise.all(['DropshippingVault','TestnetMigratedRewardsVault'].map(async name=>{const r=await fetch(name+'.json');if(!r.ok)throw Error('Artifact missing');return r.json();}));artifact=next;source=new Contract(SOURCE,old.abi,signer);try{await guard();}catch(e){source=undefined;throw e;}
 try{const saved=JSON.parse(localStorage.getItem(key)||'{}');inventory=saved.inventory;report=saved.report;}catch{}
 $('wallet').textContent=OWNER;out('Owner and network verified.'+(report?.hash?' A previous transaction was found. Select Verify accounts.':''));
});
action('pause',async()=>{await guard();if(!await source.paused()){await source.setPaused.staticCall(true);await guard();const tx=await source.setPaused(true);out('Waiting for pause confirmation: '+tx.hash);await tx.wait();}out('Source paused. Legacy withdrawals remain possible.');});
action('scan',async()=>{
 await guard();if(report?.hash)throw Error('A previous deployment is recorded. Verify it first.');if(!await source.paused())throw Error('Pause the source first.');
 request=undefined;inventory=undefined;save();
 const end=await provider.getBlockNumber(),block=await provider.getBlock(end);let low=0,high=end;
 if(await provider.getCode(SOURCE,end)==='0x')throw Error('Source contract not found.');
 while(low<high){const mid=Math.floor((low+high)/2);if(await provider.getCode(SOURCE,mid)==='0x')low=mid+1;else high=mid;out('Locating the contract creation block… '+low+' / '+high);}
 const members=new Set(),settlements=new Set(),ids=new Set();let start=low,span=2000;
 const topics=['Registered','SaleSettled','ProfitCredited'].map(x=>source.interface.getEvent(x).topicHash);
 while(start<=end){const stop=Math.min(end,start+span-1);let logs;
  try{logs=await provider.getLogs({address:SOURCE,fromBlock:start,toBlock:stop,topics:[topics]});}
  catch(e){if(span<=20)throw Error('Scan incomplete. The RPC must support historical event logs. Try again.');span=Math.max(20,Math.floor(span/2));continue;}
  for(const log of logs){if(log.removed)throw Error('The chain changed. Repeat the scan.');const e=source.interface.parseLog(log);if(e.name==='Registered')members.add(getAddress(e.args.user));if(e.name==='SaleSettled')settlements.add(e.args.id);if(e.name==='ProfitCredited')ids.add(e.args.id);}
  start=stop+1;out(`Scanning ${stop} / ${end} — ${members.size} users`);
 }
 const batches=[];for(const id of ids)if(await source.usedRewardBatch(id,{blockTag:end}))batches.push(id);
 if((await provider.getBlock(end))?.hash!==block.hash)throw Error('The scanned block changed. Try again.');
 inventory={members:[...members].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1),settlements:[...settlements].sort(),batches:batches.sort(),fromBlock:low,block:end,blockHash:block.hash};save();
 $('inventory').textContent=`${members.size} users, ${settlements.size} sales, ${batches.length} reward batches`;out('Scan complete. Deployment rejects inconsistent or changed account data.');
});
action('estimate',async()=>{
 request=undefined;gasLimit=undefined;
 await guard();if(!$('accept').checked)throw Error('Read and accept the testnet migration limitations.');
 const factory=new ContractFactory(artifact.abi,artifact.bytecode,signer);
 const candidate=await factory.getDeployTransaction(SOURCE,inventory.members,inventory.settlements,inventory.batches);
 if((candidate.data.length-2)/2>49152){request=undefined;throw Error('Migration data exceeds the single-transaction limit. Nothing was deployed.');}
 const gas=await provider.estimateGas({...candidate,from:OWNER});gasLimit=gas*120n/100n;
 const block=await provider.getBlock('latest');if(gasLimit>block.gasLimit){request=undefined;throw Error('Migration exceeds the block gas limit. A batched migration is required.');}
 const fees=await provider.getFeeData();if(fees.maxFeePerGas===null&&fees.gasPrice===null)throw Error('Gas price unavailable');request=candidate;$('estimateText').textContent=`Gas including margin: ${gasLimit} — Estimated fee: ${formatEther(gasLimit*(fees.maxFeePerGas||fees.gasPrice))} tBNB`;
 out('Estimate successful. Deployment reads the source state again.');
});
action('deploy',async()=>{
 await guard();if(!$('accept').checked||!request)throw Error('Estimate the fee and accept the limitations first.');
 // Re-estimation catches state changes since review; never use an unbounded gas override.
 await provider.estimateGas({...request,from:OWNER});await guard();
 const tx=await signer.sendTransaction({...request,gasLimit});report={chainId:97,source:SOURCE,owner:OWNER,hash:tx.hash,inventory,verified:false,activated:false,legacyClaimsExtinguished:false};save();out('Transaction saved: '+tx.hash+' — After confirmation, select Verify accounts.');
 const receipt=await tx.wait();if(receipt.status!==1)throw Error('Deployment failed. Inspect the saved transaction.');report.target=receipt.contractAddress;report.block=receipt.blockNumber;save();$('target').textContent=report.target;out('New contract deployed. The website is not connected yet. Select Verify accounts.');
});
action('verify',async()=>{
 report.verified=false;report.activated=false;save();
 await guard();const receipt=await provider.getTransactionReceipt(report.hash);if(!receipt)throw Error('The transaction is not confirmed yet.');if(receipt.status!==1||!receipt.contractAddress)throw Error('Deployment was not successful.');
 const transaction=await provider.getTransaction(report.hash);const expected=await new ContractFactory(artifact.abi,artifact.bytecode).getDeployTransaction(SOURCE,report.inventory.members,report.inventory.settlements,report.inventory.batches);
 if(transaction.from!==OWNER||transaction.to!==null||transaction.data!==expected.data)throw Error('The transaction does not match the reviewed migration.');
 const n=new Contract(receipt.contractAddress,artifact.abi,provider),o={blockTag:receipt.blockNumber},token=await source.usdt(o);
 const compare=async(name,args=[])=>{if(json(await n[name](...args,o))!==json(await source[name](...args,o)))throw Error('Mismatch: '+name+' '+args.join(' '));};
 for(const name of ['owner','usdt','bnbUsdFeed','usdtUsdFeed','maxOracleAge','dropshippingWallet','minDepositUsd','profitFeeBps','principalPenaltyBps','lockDuration','withdrawalCooldown','partnerVotesRequired'])await compare(name);
 for(let i=0;i<7;i++)await compare('partnerWallets',[i]);for(let i=0;i<5;i++)await compare('tierConfig',[i]);
 for(const who of report.inventory.members){
  for(const name of ['users','qualifiedDirects','positionCount','networkBranchCount','rewardGroupCount'])await compare(name,[who]);
  for(const asset of ['0x0000000000000000000000000000000000000000',token]){await compare('accounts',[who,asset]);await compare('cumulativeReinvested',[who,asset]);}
  for(let j=0n;j<await source.positionCount(who,o);j++)await compare('positionOf',[who,j]);
  for(let j=0n;j<await source.networkBranchCount(who,o);j++){await compare('networkBranch',[who,j]);const b=await source.networkBranch(who,j,o);await compare('branchVolumeUsd',[who,b]);await compare('groupedBranch',[who,b]);}
  for(let j=0n;j<await source.rewardGroupCount(who,o);j++){await compare('rewardGroup',[who,j]);const g=await source.rewardGroup(who,j,o);for(let k=0;k<g.branches.length;k++)await compare('rewardBranch',[who,j,k]);}
  out('Verifying user '+who);
 }
 await compare('volumeJobCount');for(let j=0n;j<await source.volumeJobCount(o);j++)await compare('volumeJobs',[j]);
 for(const asset of ['0x0000000000000000000000000000000000000000',token])for(const name of ['ledgers','ownerCapitalOutstanding','retainedPrincipalPenalties'])await compare(name,[asset]);
 for(const id of report.inventory.settlements)await compare('usedSettlement',[id]);for(const id of report.inventory.batches)await compare('usedRewardBatch',[id]);
 if(await n.REWARD_ACCRUAL_VERSION()!==1n)throw Error('Incorrect reward version.');
 report={...report,target:receipt.contractAddress,block:receipt.blockNumber,blockHash:receipt.blockHash,queue:await n.withdrawalQueue(),verified:true};save();$('target').textContent=report.target;out('Accounts match at the deployment block. Legacy withdrawals remain independent. Download the report.');
});
action('activate',async()=>{
 await guard();if(!$('accept').checked||!report.verified)throw Error('Verify accounts and accept the limitations first.');if(!await source.paused())throw Error('The source was reactivated. Operation stopped.');
 const n=new Contract(report.target,artifact.abi,signer);if(await n.owner()!==OWNER)throw Error('The destination owner differs.');
 const tx=await n.setPaused(false);out('Waiting for activation: '+tx.hash);await tx.wait();report.activated=true;report.activationHash=tx.hash;save();out('New rewards activated. Download the report and provide the new address for website connection.');
});
action('download',async()=>{const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='global-testnet-migration.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
controls();

out('Page ready. Select Connect owner wallet.');
