import {formatEther,getAddress} from './ethers.js';
import {readPermissionState,preparePermissionAction,submitPermissionAction,permissionActionCompleted} from './zero-start-permission-core.js';

const target='0x23C32Bb326DB63f89532f80e757B8463c75655b8';
const actions={propose:'Propose server reporter permission',vote:'Vote for server reporter permission',enable:'Enable server reporter permission'};
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const requestId=()=>typeof crypto.randomUUID==='function'?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
const journalError=()=>Error('The saved wallet request cannot be verified. Check the wallet transaction history before continuing.');
const permissionMessages={
 PERMISSION_CONNECT_WALLET_REQUIRED:'Connect the owner or a listed partner wallet first.',
 PERMISSION_WALLET_PROVIDER_REQUIRED:'Open this page in the SafePal DApp browser.',
 PERMISSION_VALID_ACCOUNT_REQUIRED:'Connect the selected owner or listed partner account again.',
 PERMISSION_OWNER_REQUIRED:'This action requires the owner wallet shown above.',
 PERMISSION_PARTNER_REQUIRED:'This action requires one of the registered voting partner wallets.',
 PERMISSION_SERVER_ALREADY_AUTHORIZED:'The server operator is already authorized. No further permission action is needed.',
 PERMISSION_PROPOSAL_ALREADY_QUEUED:'The proposal is already registered. Listed partners can now vote.',
 PERMISSION_PROPOSAL_REQUIRED:'The owner must register the proposal before this action is available.',
 PERMISSION_PARTNER_ALREADY_VOTED:'This partner has already voted in the current proposal round.',
 PERMISSION_TWO_PARTNER_VOTES_REQUIRED:'Two different registered partner wallets must vote before the owner can enable this permission.',
 PERMISSION_DELAY_NOT_ELAPSED:'The contract requires 48 hours from the proposal timestamp. Check the execution time above.',
 PERMISSION_BNB_TESTNET_REQUIRED:'Select BNB Testnet, chain 97, then connect your wallet again.',
 PERMISSION_WALLET_ACCOUNT_CHANGED:'The selected wallet account changed. Connect again and review a new request.',
 PERMISSION_OWNER_OR_PARTNER_NEEDS_TEST_BNB:'This wallet needs test BNB for transaction fees. Use the official test BNB faucet link above, then refresh.',
 PERMISSION_WALLET_HAS_PENDING_TRANSACTIONS:'This wallet already has a pending transaction. Resolve it in SafePal before reviewing another request.',
 PERMISSION_FEE_CHANGED_REVIEW_REQUIRED:'The network fee changed. Review the action again to see its current maximum estimated fee.',
 PERMISSION_TEST_BNB_FEE_LIMIT:'The estimated fee exceeds this page\'s 0.01 test BNB limit. No transaction was requested.',
 PERMISSION_GAS_ESTIMATE_UNAVAILABLE:'The wallet could not estimate a valid transaction fee. Refresh the current contract status before trying again.',
 PERMISSION_PROPOSAL_CHANGED_REVIEW_REQUIRED:'The proposal changed after review. Refresh and review the current action again.',
 PERMISSION_REVIEW_REQUEST_CHANGED:'The reviewed request could not be verified. Refresh and review the action again.',
 PERMISSION_REVIEW_REQUIRED:'Review the action before asking SafePal to confirm it.',
 PERMISSION_CHAIN_REORGANIZED:'The checked chain history changed. Refresh before reviewing a new request.',
 PERMISSION_WALLET_RESPONSE_UNKNOWN:'The wallet response is uncertain. Check SafePal transaction history, then refresh. No request will be resent automatically.'
};
export function permissionErrorText(error){
 if(error?.code===4001||error?.code==='ACTION_REJECTED')return 'The wallet request was rejected. Nothing will be retried automatically.';
 if(error?.code===4902)return 'BNB Testnet is not available in this wallet. Use Select BNB Testnet to add it.';
 if(error?.name==='AbortError')return 'The server status request timed out. Refresh to try again.';
 if(permissionMessages[error?.message])return permissionMessages[error.message];
 if(error?.message==='PUBLIC_STATUS_UNAVAILABLE')return 'The verified server status is unavailable. Refresh after the daily service completes its next check.';
 if(/^(?:PERMISSION_(?:FRESH_IDENTITY_MISMATCH|SITE_TARGET_MISMATCH|PROPOSAL_MISMATCH|DEPLOYMENT_PROOF_REQUIRED|DEPLOYMENT_NOT_CANONICAL|DEPLOYMENT_NOT_CONFIRMED|RUNTIME_MISMATCH|CONTRACT_CONFIGURATION_CHANGED|PARTNER_CONFIGURATION_CHANGED|APPROVAL_QUEUE_MISMATCH|GOVERNANCE_STATE_INVALID))$/.test(error?.message||''))return 'The current contract identity or configuration does not match this permission page. No transaction was requested.';
 return 'The wallet or contract check did not complete. Confirm the owner or partner account and BNB Testnet, then refresh. Check wallet history if a transaction was requested.';
}

export function selectPermissionProvider(scope){
 const candidates=[scope.safepalProvider,...(Array.isArray(scope.ethereum?.providers)?scope.ethereum.providers:[]).filter(p=>p?.isSafePal),scope.ethereum];
 return candidates.find(provider=>typeof provider?.request==='function')||null;
}
export function permissionJournalKey(account){return 'global-zero-permission-v1:97:'+target.toLowerCase()+':'+getAddress(account).toLowerCase();}
function validateIntent(value,account){
 const p=value?.prepared;
 if(value?.version!==1||value.chainId!==97||!same(value.target,target)||!same(value.account,account)||typeof value.id!=='string'||!value.id||!Number.isFinite(Date.parse(value.createdAt))||!Object.prototype.hasOwnProperty.call(actions,value.action)||!['requesting','broadcast'].includes(value.status)||!p||p.version!==1||p.action!==value.action||!same(p.account,account)||!same(p.target,target)||p.chainId!==97||!Number.isSafeInteger(p.round)||p.round<0||!p.request||!same(p.request.from,account)||!same(p.request.to,target)||p.request.value!=='0x0'||p.request.chainId!=='0x61'||(value.status==='broadcast'?!hash(value.hash):value.hash!==null))throw journalError();
 return value;
}
export function readPermissionIntent(storage,account){
 let raw;try{raw=storage.getItem(permissionJournalKey(account));}catch{throw Error('Wallet request storage is unavailable. Enable site storage before continuing.');}
 if(raw===null)return null;
 try{if(raw.length>32768)throw journalError();return validateIntent(JSON.parse(raw),account);}catch{throw journalError();}
}
export function savePermissionIntent(storage,value){
 validateIntent(value,value.account);
 const key=permissionJournalKey(value.account),old=readPermissionIntent(storage,value.account);
 if(old&&old.id!==value.id)throw Error('Another wallet request is already waiting. Refresh its status first.');
 const raw=JSON.stringify(value);
 try{storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw journalError();}catch{throw Error('The wallet request could not be saved. No new request will be sent.');}
}
export function clearPermissionIntent(storage,account,id){
 const old=readPermissionIntent(storage,account);if(!old)return;
 if(old.id!==id)throw Error('The saved wallet request changed. Refresh the page.');
 try{storage.removeItem(permissionJournalKey(account));if(storage.getItem(permissionJournalKey(account))!==null)throw journalError();}catch{throw Error('The confirmed wallet request could not be cleared. Refresh before continuing.');}
}

export async function confirmedPermissionReceipt(provider,intent){
 if(!hash(intent?.hash))return null;
 const receipt=await provider.request({method:'eth_getTransactionReceipt',params:[intent.hash]});
 if(!receipt)return null;
 if(!same(receipt.transactionHash,intent.hash)||!hash(receipt.blockHash)||!/^0x[0-9a-f]+$/i.test(receipt.blockNumber)||!['0x0','0x1'].includes(receipt.status))throw journalError();
 const [head,block,transaction,chain]=await Promise.all([
  provider.request({method:'eth_blockNumber',params:[]}),
  provider.request({method:'eth_getBlockByNumber',params:[receipt.blockNumber,false]}),
  provider.request({method:'eth_getTransactionByHash',params:[intent.hash]}),
  provider.request({method:'eth_chainId',params:[]})
 ]);
 if(BigInt(chain)!==97n||!same(block?.hash,receipt.blockHash)||!same(transaction?.hash,intent.hash)||!same(transaction?.from,intent.account)||!same(transaction?.to,target)||!same(transaction?.input??transaction?.data,intent.prepared.data)||BigInt(transaction?.value??'-1')!==0n)throw journalError();
 if(BigInt(head)-BigInt(receipt.blockNumber)+1n<3n)return null;
 const canonical=await provider.request({method:'eth_getBlockByNumber',params:[receipt.blockNumber,false]});
 if(!same(canonical?.hash,receipt.blockHash))throw journalError();
 return {hash:intent.hash,success:receipt.status==='0x1'};
}

function startPermissionPage(){
 const $=id=>document.getElementById(id);
 let provider=null,account=null,state=null,metadata=null,apiConfig=null,prepared=null,intent=null,busy=false,refreshing=false,revision=0,stopped=false;
 const message=(text,error=false)=>{$('status').textContent=text;$('status').className='status'+(error?' error':'');};
 function transactionLink(value){$('transaction').hidden=!hash(value);if(hash(value))$('transaction').href='https://testnet.bscscan.com/tx/'+value;}
 function dropReview(){prepared=null;$('review').hidden=true;}
 function controls(){
  $('connect').disabled=busy;$('switch').disabled=busy;$('refresh').disabled=busy||!account;
  for(const action of Object.keys(actions))$(action).disabled=busy||!!prepared||!!intent||!state?.actions?.[action]?.enabled;
  $('confirm').disabled=busy||!prepared||!!intent;$('cancel').disabled=busy;
 }
 function disconnect(text){revision++;account=null;state=null;intent=null;dropReview();$('wallet').textContent=text;$('network').textContent='Connect again';$('permission').textContent='Connect your wallet to verify the current contract state.';$('votes').textContent='Not checked';$('delay').textContent='Not checked';$('partners').replaceChildren();transactionLink(null);controls();}
 function render(){
  $('wallet').textContent='Connected: '+account;$('network').textContent='BNB Testnet · 97';
  $('permission').textContent=state.reporterAuthorized?'The server operator is authorized as a contract reporter.':'The server operator is not authorized yet.';
  $('votes').textContent=state.proposal.queued?state.proposal.votes+' of '+state.proposal.requiredVotes+' votes · Round '+state.proposal.round:'No proposal has been registered.';
  $('delay').textContent=state.reporterAuthorized?'Permission enabled':!state.proposal.queued?'The 48-hour delay starts when the proposal is confirmed.':state.proposal.delayElapsed?'The contract delay has elapsed.':'Available after '+new Date(state.proposal.eta*1000).toLocaleString('en-US');
  $('partners').replaceChildren();for(const partner of state.partners){const item=document.createElement('li'),code=document.createElement('code');code.textContent=partner.address;item.append(code);item.append(document.createTextNode(partner.voted?'Vote recorded':'No vote recorded'));$('partners').append(item);}
  const available={propose:'The owner can propose this exact reporter permission.',vote:'This registered partner can vote once for this proposal round.',enable:'The required votes and delay are satisfied. The owner can review execution.'};
  for(const action of Object.keys(actions))$(action+'-reason').textContent=state.actions[action].enabled?available[action]:permissionMessages[state.actions[action].reason]||'This action is unavailable for the selected wallet.';
  controls();
 }
 async function readJson(url){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);try{const response=await fetch(url,{cache:'no-store',signal:controller.signal});if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw Error('PUBLIC_STATUS_UNAVAILABLE');return await response.json();}finally{clearTimeout(timeout);}}
 async function inputs(){const result=await Promise.all([readJson('/deploy/zero-start-activation.json'),readJson('/api/config')]);return {metadata:result[0],apiConfig:result[1]};}
 const errorText=permissionErrorText;
 async function refresh({silent=false}={}){
  if(!account||busy||refreshing||stopped)return;refreshing=true;const generation=revision,actor=account;
  try{
   const currentAccounts=await provider.request({method:'eth_accounts',params:[]});if(!same(currentAccounts?.[0],actor)){disconnect('The wallet account changed. Connect the selected account again.');return;}
   const current=await inputs();const result=await readPermissionState({provider,...current,account:actor});
   if(generation!==revision||stopped)return;
   metadata=current.metadata;apiConfig=current.apiConfig;state=result;intent=readPermissionIntent(localStorage,actor);
   if(intent){
    transactionLink(intent.hash);
    const confirmed=intent.hash?await confirmedPermissionReceipt(provider,intent):null;
    const completed=!intent.hash&&await permissionActionCompleted({provider,metadata,apiConfig,prepared:intent.prepared});
    if(generation!==revision||stopped)return;
    if(confirmed||completed){const previous=intent;clearPermissionIntent(localStorage,actor,previous.id);intent=null;message(confirmed&&!confirmed.success?'The transaction reverted. Its request is closed; review the current contract status before trying again.':'The permission transaction is confirmed. The contract status has been refreshed.',!!confirmed&&!confirmed.success);}
    else message(intent.hash?'The saved transaction is waiting for three confirmations. Refresh checks its existing hash; it will not send another transaction.':'A wallet request was already opened, but its transaction hash is unknown. Check SafePal transaction history, then refresh. No duplicate request will be sent.');
   }else if(!silent)message('Contract and wallet verified. Review the action available to this account.');
   render();
  }catch(error){if(generation===revision){state=null;dropReview();message(errorText(error),true);controls();}}
  finally{refreshing=false;}
 }
 function attach(next){
  if(provider===next)return;provider=next;
  provider.on?.('accountsChanged',()=>{disconnect('The wallet account changed. Connect the selected account again.');message('Reconnect the wallet before reviewing another action.');});
  provider.on?.('chainChanged',()=>{disconnect('The wallet network changed. Select BNB Testnet and connect again.');message('The transaction review was cleared after the network changed.');});
 }
 async function connect(){if(busy)return;busy=true;dropReview();controls();try{const selected=selectPermissionProvider(window);if(!selected)throw Error('WALLET_BROWSER_REQUIRED');attach(selected);const accounts=await provider.request({method:'eth_requestAccounts',params:[]});account=getAddress(accounts?.[0]);revision++;state=null;intent=null;transactionLink(null);message('Checking the selected wallet and existing fresh contract…');}catch(error){disconnect('Open this page inside the SafePal DApp browser.');message(error.message==='WALLET_BROWSER_REQUIRED'?'Open this page inside SafePal: DApps → enter this page address.':errorText(error),true);}finally{busy=false;controls();}await refresh();}
 async function switchNetwork(){if(busy)return;busy=true;dropReview();controls();try{const selected=selectPermissionProvider(window);if(!selected)throw Error('WALLET_BROWSER_REQUIRED');attach(selected);try{await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x61'}]});}catch(error){if(error?.code!==4902)throw error;await provider.request({method:'wallet_addEthereumChain',params:[{chainId:'0x61',chainName:'BSC Testnet',nativeCurrency:{name:'Test BNB',symbol:'tBNB',decimals:18},rpcUrls:['https://bsc-testnet-dataseed.bnbchain.org'],blockExplorerUrls:['https://testnet.bscscan.com']}]});await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x61'}]});}if(BigInt(await provider.request({method:'eth_chainId',params:[]}))!==97n)throw Error('WRONG_CHAIN');disconnect('BNB Testnet selected. Connect your wallet to continue.');message('BNB Testnet selected. Connect the owner or a listed partner wallet.');}catch(error){message(errorText(error),true);}finally{busy=false;controls();}}
 async function review(action){if(busy||!account||intent)return;busy=true;dropReview();controls();const generation=revision;try{const current=await inputs(),result=await preparePermissionAction({provider,...current,account,action});if(generation!==revision)return;metadata=current.metadata;apiConfig=current.apiConfig;prepared=result;$('review-action').textContent=actions[action];$('review-account').textContent=prepared.account;$('review-target').textContent=prepared.target;$('review-fee').textContent=formatEther(prepared.maxFeeWei)+' tBNB';$('review').hidden=false;$('review').scrollIntoView({behavior:'smooth',block:'start'});message('Review the exact action and fee. Your wallet has not been asked to send it.');}catch(error){message(errorText(error),true);}finally{busy=false;controls();}}
 async function confirm(){
  if(busy||!prepared||!account||intent)return;busy=true;controls();const currentPrepared=prepared,actor=account;let saved=null;
  try{
   const current=await inputs();
   const transactionHash=await submitPermissionAction({provider,...current,account:actor,prepared:currentPrepared,beforeSend:()=>{
    if(!same(account,actor))throw Error('WALLET_ACCOUNT_CHANGED');
    if(readPermissionIntent(localStorage,actor))throw Error('WALLET_REQUEST_ALREADY_EXISTS');
    saved={version:1,chainId:97,target,account:actor,action:currentPrepared.action,createdAt:new Date().toISOString(),id:requestId(),status:'requesting',hash:null,prepared:currentPrepared};savePermissionIntent(localStorage,saved);intent=saved;dropReview();message('Confirm the permission transaction in SafePal. This request will not be repeated automatically.');controls();
   }});
   if(!saved)throw Error('WALLET_REQUEST_NOT_SAVED');saved={...saved,status:'broadcast',hash:transactionHash};savePermissionIntent(localStorage,saved);intent=saved;transactionLink(transactionHash);message('The wallet returned a transaction hash. Refresh checks confirmation; it never resends this request.');
  }catch(error){
   if(saved&&error?.transactionRequested===false){try{clearPermissionIntent(localStorage,actor,saved.id);if(same(account,actor))intent=null;}catch{}}
   if(saved&&error?.transactionRequested!==false)message('The wallet response is uncertain. Check SafePal transaction history, then refresh. The saved request blocks duplicates.',true);else message(errorText(error),true);
  }finally{dropReview();busy=false;controls();}
  await refresh({silent:true});
 }
 $('connect').addEventListener('click',()=>void connect());$('switch').addEventListener('click',()=>void switchNetwork());$('refresh').addEventListener('click',()=>void refresh());
 for(const action of Object.keys(actions))$(action).addEventListener('click',()=>void review(action));
 $('confirm').addEventListener('click',()=>void confirm());$('cancel').addEventListener('click',()=>{dropReview();message('Review cancelled. No wallet transaction was requested.');controls();});
 window.addEventListener('storage',event=>{if(account&&event.key===permissionJournalKey(account)){dropReview();state=null;controls();void refresh();}});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refresh({silent:true});});
 window.addEventListener('pagehide',()=>{stopped=true;dropReview();});window.addEventListener('pageshow',()=>{stopped=false;void refresh({silent:true});});
 const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh({silent:true});},30000);window.addEventListener('beforeunload',()=>clearInterval(timer));controls();
}
if(typeof document!=='undefined')startPermissionPage();
