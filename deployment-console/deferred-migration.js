import {BrowserProvider,ContractFactory,Interface,formatUnits,formatEther,getAddress,keccak256,parseEther} from './ethers.js';
import {connectMigrationWallet} from './wallet-bundle/wallet-client.js';
import {deferredPolicy as policy,deferredSourceAbi} from './deferred-migration-core.mjs';
import {bindMigrationTransaction,migrationFeeCommitted,migrationHasUnresolvedRequest,archiveConfirmedControl} from './deferred-wallet-journal.mjs';

const $=id=>document.getElementById(id),sourceInterface=new Interface(deferredSourceAbi);
const output=message=>{$('status').textContent=message;};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const budget=parseEther('0.1');
let artifact,key,state={records:{},history:[]},raw,provider,who='',metadata,prepared,busy=false,reportTimer;
function save(){localStorage.setItem(key,JSON.stringify(state));}
function role(){return $('role').value;}
function unresolved(){return migrationHasUnresolvedRequest(state);}
function accepted(){if(!$('accept').checked)throw Error('Review the testnet-copy limitations first.');}
function controls(){
 const owner=who===policy.owner,report=state.report,connected=!!provider,held=busy||unresolved();
 $('connect').disabled=busy;$('disconnect').disabled=busy||!connected;
 $('scan').disabled=held||!owner;
 $('pause').disabled=held||!owner||!state.inventory||!!report?.hash||!!metadata?.sourcePaused||metadata?.apiTarget!==policy.source;
 $('resume').disabled=held||!owner||!metadata?.sourcePaused||!!report?.hash;
 $('estimate').disabled=held||!owner||!metadata?.sourcePaused||!!report?.hash||metadata?.apiTarget!==policy.source;
 $('deploy').disabled=held||!owner||!prepared||!!report?.hash||!$('accept').checked;
 $('verify').disabled=busy||!report?.hash;
 $('download').disabled=busy||!report?.verified;
 $('activate').disabled=held||!owner||!report?.verified||!report.siteConnected||!report.targetPaused;
 const authorization=report?.reporterAuthorization,isPartner=authorization?.partners?.some(p=>p.address===who),eta=authorization?.eta||0;
 $('propose').disabled=held||!owner||!report?.siteConnected||report.targetPaused||report.serverReporterAuthorized||eta>0;
 $('vote').disabled=held||!isPartner||!report?.siteConnected||eta===0||authorization.partners.some(p=>p.address===who&&p.voted);
 $('enable-reporter').disabled=held||!owner||!report?.siteConnected||eta===0||Date.now()<eta*1000||authorization.votes<authorization.quorum||report.serverReporterAuthorized;
 $('recovery').hidden=!unresolved();
}
async function api(path){
 for(let attempt=0;attempt<120;attempt++){
  const response=await fetch('/api/migration/'+path,{cache:'no-store',signal:AbortSignal.timeout(14000)}),body=await response.json();
  if(body.error)throw Error(body.error);
  if(response.status===200&&body.ready)return body;
  if(response.status!==202)throw Error('Migration verification service is unavailable.');
  output(body.status==='EVENT_INDEX_NOT_READY'?'The server is building the complete event index. No wallet action has been requested.':String(body.status||'Checking the source…')+(body.through?' · Block '+body.through:''));
  await wait(3000);
 }
 throw Error('The read-only check is still running. Retry the same step; no transaction was sent.');
}
async function refreshSource(){
 metadata=await api('status');$('source-status').textContent=(metadata.sourcePaused?'Paused':'Active')+' · '+metadata.requestCount+' legacy withdrawal records';
 $('balances').replaceChildren();
 for(const asset of metadata.assets){
  const row=document.createElement('tr');
  for(const text of [asset.asset==='0x0000000000000000000000000000000000000000'?'tBNB':'Test USDT',...['0','1'].map(i=>formatUnits(asset.ledger[Number(i)],asset.asset===metadata.token?metadata.tokenDecimals:18)),formatUnits(asset.pending,asset.asset===metadata.token?metadata.tokenDecimals:18),formatUnits(asset.cash,asset.asset===metadata.token?metadata.tokenDecimals:18)]){const cell=document.createElement('td');cell.textContent=text;row.append(cell);}
  $('balances').append(row);
 }
 controls();return metadata;
}
async function refreshReport(stable=false){
 if(!state.report?.hash)return;
 const result=await api((stable?'stability':'verify')+'?hash='+encodeURIComponent(state.report.hash));
 state.report=result.report;save();const report=state.report,a=report.reporterAuthorization;
 $('target').textContent='Verified copied vault: '+report.target+' · Transaction: '+report.hash;
 $('server-step').textContent=report.siteConnected?'The website/API now point to this copied contract. The owner can activate it.':'Server connection required. Use MIGRATED_VAULT_TX='+report.hash+' with ubuntu-connect-migrated-deferred.sh from this reviewed checkout.';
 $('activation-status').textContent=report.targetPaused?'The copied vault is paused.':'The copied vault is active.';
 $('reporter-status').textContent=report.serverReporterAuthorized?'Server reporter is authorized. Fund the reward budget and enable the server timer.':a.eta?'Council votes: '+a.votes+' / '+a.quorum+' · Earliest execution: '+new Date(a.eta*1000).toLocaleString():'No server reporter proposal is queued.';
 controls();return report;
}
async function guardSigner(expectedRole='owner'){
 if(!raw||!provider)throw Error('Connect a wallet first.');
 if(Number(await raw.request({method:'eth_chainId'}))!==97)throw Error('Select BNB Testnet 97 in your wallet.');
 const accounts=await raw.request({method:'eth_accounts'});if(!accounts?.length||getAddress(accounts[0])!==who)throw Error('The wallet account changed. Reconnect.');
 if(expectedRole==='owner'&&who!==policy.owner)throw Error('The configured owner wallet is required.');
 if(expectedRole==='partner'&&!state.report?.reporterAuthorization?.partners.some(p=>p.address===who))throw Error('A copied council partner wallet is required.');
 return provider.getSigner(who);
}
async function readRecord(label){
 const record=state.records[label];if(!record?.hash)throw Error('Recover the saved wallet request before continuing.');
 const transaction=await provider.getTransaction(record.hash);if(!bindMigrationTransaction(record,transaction))throw Error('The nonce was used by a different transaction. Recover its hash for review.');
 let receipt=await provider.getTransactionReceipt(record.hash);
 if(!receipt||await provider.getBlockNumber()-receipt.blockNumber+1<4){output('Transaction saved: '+record.hash+' · Waiting for four confirmations…');receipt=await provider.waitForTransaction(record.hash,4,120000);}
 if(!receipt)throw Error('Transaction is pending. Reopen this step to check the saved hash.');
 if((await provider.getBlock(receipt.blockNumber))?.hash!==receipt.blockHash)throw Error('TRANSACTION_REORG');
 record.actualFee=(receipt.gasUsed*receipt.gasPrice).toString();record.block=receipt.blockNumber;record.failed=receipt.status!==1;record.uncertain=false;save();
 if(record.failed)throw Error('The saved transaction reverted. Review its receipt before retrying this step.');
 return receipt;
}
async function findExistingCopies(afterBlock=0){
 const found=await api('discover?afterBlock='+afterBlock);
 if(!found.complete)throw Error('Copy discovery is still indexing. Retry before requesting a signature.');
 if(found.copies.length){
  const copy=found.copies[found.copies.length-1];state.report={hash:copy.hash};prepared=null;save();
  await refreshReport();throw Error('An existing migration was found and recovered. Continue verification or server connection; no new deployment was sent.');
 }
}
async function submit(label,request,expectedRole='owner'){
 accepted();const signer=await guardSigner(expectedRole);
 let old=state.records[label];
 if(old){
  if(old.from!==who||old.to!==(request.to||null)||old.data!==request.data)throw Error('The reviewed request changed. Keep the saved journal for recovery.');
  if(!old.failed)return readRecord(label);
  state.history.push(old);delete state.records[label];save();
 }
 if(unresolved())throw Error('A wallet response is unresolved. Recover its hash first.');
 const latest=await provider.getTransactionCount(who,'latest'),pending=await provider.getTransactionCount(who,'pending');
 if(latest!==pending)throw Error('This wallet has pending transactions. Finish them before continuing.');
 if(label==='deploy'||label==='resume')await findExistingCopies(await provider.getBlockNumber());
 const gas=await signer.estimateGas({...request,value:0n}),gasLimit=gas*120n/100n,fees=await provider.getFeeData(),gasPrice=fees.gasPrice;
 if(!gasPrice||gasPrice<=0n||gasLimit>(await provider.getBlock('latest')).gasLimit)throw Error('Fee or block gas limit unavailable.');
 const maxFee=gasLimit*gasPrice;
 if(migrationFeeCommitted(state)+maxFee>budget)throw Error('The cumulative 0.1 tBNB fee budget would be exceeded.');
 if(await provider.getBalance(who)<maxFee)throw Error('Insufficient test BNB for the reviewed network fee.');
 await guardSigner(expectedRole);
 const record={from:who,to:request.to||null,data:request.data,nonce:pending,maxFee:maxFee.toString(),gasLimit:gasLimit.toString(),gasPrice:gasPrice.toString(),uncertain:true};
 state.records[label]=record;save();controls();output('Confirm the reviewed '+label+' request in your wallet.');
 try{
  const transaction=await signer.sendTransaction({...request,value:0n,chainId:97,type:0,nonce:pending,gasLimit,gasPrice});
  record.hash=transaction.hash;record.uncertain=false;save();
 }catch(e){
  if(e.code===4001||e.code==='ACTION_REJECTED'){delete state.records[label];save();}
  throw e;
 }
 return readRecord(label);
}
function action(id,callback){$(id).onclick=async()=>{if(busy)return;busy=true;controls();try{await callback();}catch(e){output(e.shortMessage||e.message||'Wallet request failed.');}finally{busy=false;controls();}};}
function invalidate(){provider=undefined;who='';prepared=null;$('wallet').textContent='Wallet changed. Reconnect the correct account.';controls();}
async function archivePriorControl(label){
 try{await readRecord(label);}catch(e){if(!state.records[label]?.failed)throw e;}
 archiveConfirmedControl(state,label);save();
}
action('connect',async()=>{
 raw=await connectMigrationWallet($('wallet-type').value);
 if(Number(await raw.request({method:'eth_chainId'}))!==97){await raw.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x61'}]});}
 const accounts=await raw.request({method:'eth_accounts'});who=getAddress(accounts[0]);provider=new BrowserProvider(raw,undefined,{cacheTimeout:-1});provider.pollingInterval=1500;
 if(role()==='owner'&&who!==policy.owner){invalidate();throw Error('Connect '+policy.owner+' for owner actions.');}
 raw.removeListener?.('accountsChanged',invalidate);raw.removeListener?.('chainChanged',invalidate);raw.on?.('accountsChanged',invalidate);raw.on?.('chainChanged',invalidate);
 $('wallet').textContent=who+' · BNB Testnet 97';await refreshSource();
 if(state.report?.hash)await refreshReport();
 output(unresolved()?'A saved wallet request needs its transaction hash.':'Wallet connected. Review the legacy balances and scan account history.');
});
action('disconnect',async()=>{await raw?.disconnect?.();invalidate();});
action('scan',async()=>{await guardSigner();await refreshSource();await findExistingCopies();const data=await api('inventory');state.inventory=data.inventory;save();$('inventory').textContent=data.inventory.members.length+' users · '+data.inventory.settlements.length+' sales · '+data.inventory.batches.length+' funded reward batches';output('Complete event history indexed. Review the testnet copy and pause the source.');});
action('pause',async()=>{
 await refreshSource();if(metadata.apiTarget!==policy.source)throw Error('The official target already changed. No new copy is allowed.');
 if(metadata.sourcePaused){state.pauseBlock=await provider.getBlockNumber();save();return;}
 if(state.records.pause)await archivePriorControl('pause');
 const receipt=await submit('pause',{to:policy.source,data:sourceInterface.encodeFunctionData('setPaused',[true])});state.pauseBlock=receipt.blockNumber;save();await wait(1000);await refreshSource();output('Old contract paused. Old claims remain independent. Estimate the copied deployment next.');
});
action('resume',async()=>{
 await guardSigner();await findExistingCopies(await provider.getBlockNumber());
 if(state.report?.hash||(state.records.deploy?.hash&&!state.records.deploy.failed))throw Error('A copied contract is already recorded. Preserve its report for review.');
 if(state.records.resume)await archivePriorControl('resume');
 await submit('resume',{to:policy.source,data:sourceInterface.encodeFunctionData('setPaused',[false])});prepared=null;state.inventory=null;delete state.pauseBlock;save();await refreshSource();output('Old contract resumed. No copied deployment was made.');
});
action('estimate',async()=>{
 accepted();const signer=await guardSigner();await refreshSource();if(!metadata.sourcePaused||metadata.apiTarget!==policy.source)throw Error('The source must be paused and remain the official target.');
 await findExistingCopies();state.pauseBlock??=await provider.getBlockNumber();save();
 const data=await api('inventory?afterBlock='+state.pauseBlock);state.inventory=data.inventory;save();
 const request=await new ContractFactory(artifact.abi,artifact.bytecode).getDeployTransaction(policy.source,state.inventory.members,state.inventory.settlements,state.inventory.batches);
 if((request.data.length-2)/2>49152)throw Error('The inventory exceeds the single-transaction initcode limit.');
 const gasLimit=(await signer.estimateGas(request))*120n/100n,gasPrice=(await provider.getFeeData()).gasPrice;
 if(!gasPrice||migrationFeeCommitted(state)+gasLimit*gasPrice>budget)throw Error('The cumulative 0.1 tBNB fee budget would be exceeded.');
 prepared=request;$('estimateText').textContent='Maximum deployment fee including gas margin: '+formatEther(gasLimit*gasPrice)+' tBNB';output('Estimate ready. The constructor copies the source atomically, including the original pending queue.');
});
action('deploy',async()=>{if(!prepared)throw Error('Estimate the copied deployment first.');const receipt=await submit('deploy',prepared);state.report={hash:receipt.hash,target:receipt.contractAddress};prepared=null;save();await refreshReport(true);output('Copied contract verified and paused. Connect this transaction on the server before activation.');});
action('verify',async()=>{await refreshReport(!state.report?.siteConnected);output(state.report.siteConnected?'Copied contract verified and connected. Owner activation is available.':'Copied contract verified. Provide its transaction hash for server connection.');});
action('activate',async()=>{await refreshReport();if(!state.report.siteConnected)throw Error('Connect the verified copied contract on the server first.');const i=new Interface(artifact.abi);await submit('activate',{to:state.report.target,data:i.encodeFunctionData('setPaused',[false])});await wait(1000);await refreshReport();output('Activation transaction confirmed. Fund the reward budget and complete reporter authorization.');});
action('download',async()=>{const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='global-deferred-migration-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
action('recover',async()=>{
 const hash=$('recovery-hash').value.trim();if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('Enter the saved wallet transaction hash.');
 if(!provider)throw Error('Connect the same wallet first.');
 const found=Object.entries(state.records).find(([,r])=>r.uncertain&&!r.hash);if(!found)throw Error('No unresolved request.');const [label,record]=found;
 const transaction=await provider.getTransaction(hash),matches=bindMigrationTransaction(record,transaction),receipt=await provider.getTransactionReceipt(hash);
 if(!receipt||await provider.getBlockNumber()-receipt.blockNumber+1<4||(await provider.getBlock(receipt.blockNumber))?.hash!==receipt.blockHash)throw Error('Wait for four canonical confirmations before recovery.');
 if(!matches){record.actualFee=(receipt.gasUsed*receipt.gasPrice).toString();record.replaced=true;record.hash=hash;record.uncertain=false;state.history.push(record);delete state.records[label];save();output('A confirmed replacement used this nonce. The original request was not executed; review the step before retrying.');return;}
 record.hash=hash;record.uncertain=false;save();await readRecord(label);
 if(label==='deploy'){state.report={hash,target:receipt.contractAddress};prepared=null;save();await refreshReport();}else await refreshSource();
 output('Saved request recovered. No duplicate transaction was sent.');
});
action('propose',async()=>{await refreshReport();const a=state.report.reporterAuthorization;if(!state.report.siteConnected||state.report.targetPaused||a.eta)throw Error('Check the connected contract and existing reporter proposal.');const i=new Interface(artifact.abi);await submit('reporter-proposal-'+(BigInt(a.round)+1n),{to:state.report.target,data:i.encodeFunctionData('queueConfiguration',[a.hash])});output('Reporter proposal confirmed. Council partners must vote; the two-day delay remains enforced.');});
action('vote',async()=>{await refreshReport();const a=state.report.reporterAuthorization;if(!state.report.siteConnected||!a.eta)throw Error('A connected reporter proposal is required.');const i=new Interface(artifact.abi);await submit('reporter-vote-'+a.round+'-'+who,{to:state.report.target,data:i.encodeFunctionData('voteConfiguration',[a.hash])},'partner');output('Council vote confirmed. Refresh the report for current quorum and timing.');});
action('enable-reporter',async()=>{await refreshReport();const a=state.report.reporterAuthorization;if(!state.report.siteConnected||!a.eta||Date.now()<a.eta*1000||a.votes<a.quorum)throw Error('The copied quorum and two-day delay are required.');await submit('reporter-enable-'+a.round,{to:state.report.target,data:a.calldata});output('Reporter authorization transaction confirmed. Enable the funded daily-plan timer on the server.');});
$('accept').onchange=controls;$('role').onchange=invalidate;
try{
 $('source').textContent=policy.source;$('owner').textContent=policy.owner;$('operator').textContent=policy.operator;
 const response=await fetch('TestnetDeferredMigrationVault.json',{cache:'no-store'});if(!response.ok)throw Error('Migration artifact unavailable.');artifact=await response.json();
 key='global-deferred-migration-'+policy.source+'-'+keccak256(artifact.bytecode);
 try{const stored=JSON.parse(localStorage.getItem(key)||'null');if(stored&&stored.records&&Array.isArray(stored.history))state=stored;}catch{}
 if(!state.report?.hash){try{const response=await fetch('/api/migration/connection',{cache:'no-store'});if(response.ok){const marker=await response.json();if(marker.source===policy.source&&/^0x[0-9a-f]{64}$/i.test(marker.hash))state.report={hash:marker.hash};}}catch{}}
 await refreshSource();if(state.report?.hash)await refreshReport();
 output('Ready. Connect the owner wallet for the copy, or a council wallet for reporter voting.');controls();
 reportTimer=setInterval(()=>{if(!busy&&state.report?.hash&&document.visibilityState==='visible'){busy=true;controls();refreshReport().catch(e=>output(e.message)).finally(()=>{busy=false;controls();});}},20000);
}catch(e){output(e.message);$('connect').disabled=true;}
