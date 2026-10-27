import {Interface,ZeroAddress,getAddress,getCreateAddress,keccak256,formatUnits} from './ethers.js';

const policy={owner:'0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632',operator:'0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2',token:'0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89'};
const releases=new Map([
 ['global-fresh-zero-v1',{artifactHash:'0x64f24990045d9ef3d268e97657ed6e6af013cb73fc8ec39b9a862929c069e8cf',fast:false}],
 ['global-fresh-fast-test-v1',{artifactHash:'0x008e37042763d39b139ead6cd867ef48a221a2eec1c8e8702a844fa5f269b11e',fast:true}]
]);
const proposalInterface=new Interface(['function setReporter(address,bool)']);
const expectedCalldata=proposalInterface.encodeFunctionData('setReporter',[policy.operator,true]),expectedProposalHash=keccak256(expectedCalldata);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value)&&!/^0x0{64}$/i.test(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const units=value=>typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value);
const signedUnits=value=>typeof value==='string'&&/^(0|-?[1-9][0-9]*)$/.test(value);
const fail=message=>{throw Error(message);};
function address(value){try{const result=getAddress(value);if(result!==ZeroAddress)return result;}catch{}return fail('The fresh contract identity is invalid.');}
const feedAddresses=['0xDA264c16Ec8832748a1A5A31b963deD9E48e337a','0xE7D68dF5e1e9B0F5BeB3201b4Ab1d64aC7761454'];
const hourlyPolicy=(value,fast)=>fast&&value?.periodSeconds===3600&&value.testMode===true&&value.releaseId==='global-fresh-fast-test-v1'&&value.testInterval==='hourly'&&value.fastTestnetVersion===1&&value.basis==='period-start-active-principal'&&value.includeReinvestment===true;
const hourlySelection=(value,fast)=>fast&&value?.testInterval==='hourly'&&value.allocationPeriodSeconds===3600;
const oracleError=value=>typeof value==='string'&&value!=='DAILY_AUTOMATION_NOT_INSPECTED_BY_ORACLE_REPAIR'&&(/ORACLE|STALE_PRICE|STALEPRICE/.test(value)||['TESTNET_GAS_COST_LIMIT','TOTAL_TEST_BNB_FEE_LIMIT_0_1','INSUFFICIENT_TEST_BNB','AUTOMATION_RPC_OR_EXECUTION_FAILED'].includes(value));

function oracleStatusOf(value,target){
 const observed=value.oracleMaintenance??value.automation?.oracles,inspection=value.oracleInspection;
 const errors=[...(value.blockers||[]),...(value.automation?.errors||[])].filter(oracleError);
 let verified=false,checkedAt;
 if(observed&&observed.status!=='not-configured'){
  if(observed.status!=='TESTNET_ORACLES_VALID'||observed.chainId!==97||!same(observed.vault,target)||!units(observed.maxOracleAge)||BigInt(observed.maxOracleAge)!==86400n||!Array.isArray(observed.observedFeeds)||observed.observedFeeds.length!==2||!Array.isArray(observed.transactions)||!observed.transactions.every(hash))fail('The oracle maintenance report is invalid.');
  for(let i=0;i<2;i++){
   const feed=observed.observedFeeds[i];
   if(!feed||!same(feed.address,feedAddresses[i])||!units(feed.answer)||BigInt(feed.answer)<=0n||!units(feed.updatedAt)||!units(feed.ageSeconds))fail('The oracle price report is invalid.');
  }
  if(observed.checkedAt!==undefined){
   checkedAt=Date.parse(observed.checkedAt)/1000;
   if(typeof observed.checkedAt!=='string'||!Number.isFinite(checkedAt))fail('The oracle maintenance time is invalid.');
  }
  verified=true;
 }
 if(inspection){
  if(inspection.version!==1||inspection.chainId!==97||!same(inspection.target,target)||typeof inspection.ready!=='boolean'||!integer(inspection.block)||inspection.block<1||!hash(inspection.blockHash)||!integer(inspection.timestamp)||!units(inspection.maxOracleAge)||BigInt(inspection.maxOracleAge)!==86400n||inspection.transactionsSent!==0||!Array.isArray(inspection.feeds)||inspection.feeds.length!==2||inspection.status!==(inspection.ready?'TESTNET_ORACLES_VALID':'ORACLE_REFRESH_REQUIRED'))fail('The current oracle inspection is invalid.');
  for(let i=0;i<2;i++){
   const feed=inspection.feeds[i];
   if(!feed||!same(feed.address,feedAddresses[i])||![feed.round,feed.updatedAt,feed.answeredInRound].every(units)||!signedUnits(feed.answer)||!signedUnits(feed.ageSeconds)||typeof feed.ready!=='boolean')fail('The current oracle inspection is invalid.');
   const round=BigInt(feed.round),updated=BigInt(feed.updatedAt),age=BigInt(inspection.timestamp)-updated;
   const ready=round>0n&&BigInt(feed.answer)>0n&&updated>0n&&age>=0n&&age<=86400n&&BigInt(feed.answeredInRound)>=round;
   if(BigInt(feed.ageSeconds)!==age||feed.ready!==ready)fail('The current oracle inspection is inconsistent.');
  }
  if(inspection.ready!==inspection.feeds.every(feed=>feed.ready))fail('The current oracle inspection is inconsistent.');
  checkedAt=inspection.timestamp;
  if(inspection.ready)verified=true;
  if(!inspection.ready)errors.push('ORACLE_CURRENT_QUOTES_UNAVAILABLE');
 }
 return {verified:verified&&errors.length===0,failed:errors.length>0,errors:[...new Set(errors)],checkedAt};
}

export function parseActivationStatus(value,apiConfig,expectedIdentity){
 const release=releases.get(value?.releaseId);
 if(value?.version!==1||value.kind!=='fresh-zero-daily-readiness'||!release||value.chainId!==97||value.siteConnected!==true)fail('The fresh daily-plan status is unavailable.');
 if(release.fast&&(value.testMode!==true||value.initialServerReporter!==true||value.fastTestnetVersion!==1))fail('The fast testnet release markers are invalid.');
 if(!release.fast&&(value.testMode===true||value.initialServerReporter===true||value.fastTestnetVersion!==undefined||value.archive?.provisionalAccepted===true))fail('The standard release cannot use fast testnet permissions.');
 const hourlySelected=hourlySelection(value,release.fast);
 if((value.testInterval!==undefined||value.allocationPeriodSeconds!==undefined)&&!hourlySelected)fail('The hourly test selection is invalid.');
 const target=address(value.target),queue=address(value.queue);
 if(!same(value.contractAddress,target)||!same(value.owner,policy.owner)||!same(value.operator,policy.operator)||!same(value.token,policy.token)||value.tokenDecimals!==18||!same(value.artifactHash,release.artifactHash))fail('The daily-plan status does not match the fresh release.');
 if(!hash(value.hash)||!hash(value.runtimeHash)||!integer(value.block)||value.block<1||queue!==getCreateAddress({from:target,nonce:1}))fail('The fresh deployment identity is invalid.');
 if(apiConfig?.version!==1||apiConfig.chainId!==97||!same(apiConfig.vaultAddress,target))fail('The website and daily-plan status point to different contracts.');
 const identity={target,queue,hash:value.hash.toLowerCase(),runtimeHash:value.runtimeHash.toLowerCase(),block:value.block};
 if(expectedIdentity&&Object.keys(identity).some(key=>String(identity[key]).toLowerCase()!==String(expectedIdentity[key]).toLowerCase()))fail('The fresh contract changed. Reload this page.');
 if(typeof value.ready!=='boolean'||typeof value.paused!=='boolean'||typeof value.reporterAuthorized!=='boolean'||!Array.isArray(value.blockers)||!value.blockers.every(item=>typeof item==='string')||value.approvalVersion!==1||value.automaticGroupVersion!==1)fail('The daily-plan readiness data is invalid.');
 const checkpoint=value.checkpoint,a=value.reporterProposal;
 if(!checkpoint||!integer(checkpoint.timestamp)||!integer(checkpoint.block)||!hash(checkpoint.blockHash)||!a||!same(a.calldata,expectedCalldata)||!same(a.hash,expectedProposalHash)||![a.eta,a.round,a.votes,a.requiredVotes,a.currentQuorum].every(integer)||a.requiredVotes<2||a.requiredVotes>7||a.currentQuorum<2||a.currentQuorum>7||a.votes>7||a.delaySeconds!==172800||typeof a.queued!=='boolean'||a.queued!==(a.eta>0))fail('The reporter permission status is invalid.');
 const f=value.funding;
 if(!f||typeof f.ready!=='boolean'||!integer(f.maxDailyBps)||f.maxDailyBps>1000||!Array.isArray(f.assets)||f.assets.length!==2)fail('The daily funding status is invalid.');
 const combinedEstimate=f.estimateVersion===2;
 if(f.estimateVersion!==undefined&&f.estimateVersion!==1&&!combinedEstimate)fail('The daily funding estimate version is invalid.');
 if(combinedEstimate&&(!integer(f.maxReferralBps)||f.maxReferralBps>3400))fail('The daily referral funding estimate is invalid.');
 const assets=f.assets.map(entry=>{
  if(!entry||![entry.principal,entry.rewards,entry.cash,entry.estimatedDailyRequirement,entry.minimumBudgetRequired].every(units)||entry.decimals!==18||typeof entry.ready!=='boolean'||typeof entry.backed!=='boolean'||typeof entry.requiredForExistingPrincipal!=='boolean')fail('The reward budget data is invalid.');
  if(combinedEstimate&&![entry.estimatedReferralRequirement,entry.estimatedTotalDailyRequirement].every(units))fail('The combined reward budget data is invalid.');
  const asset=same(entry.asset,ZeroAddress)?ZeroAddress:address(entry.asset);
  if(asset!==ZeroAddress&&!same(asset,policy.token))fail('An unexpected reward asset was reported.');
  const principal=BigInt(entry.principal),rewards=BigInt(entry.rewards),cash=BigInt(entry.cash),estimate=(principal*BigInt(f.maxDailyBps)+9999n)/10000n;
  const referrals=combinedEstimate?(estimate*BigInt(f.maxReferralBps)+9999n)/10000n:0n,total=estimate+referrals,minimum=total>0n?total:1n;
  const backed=rewards>0n&&cash>=rewards,ready=rewards>=minimum&&cash>=minimum;
  if(combinedEstimate&&(BigInt(entry.estimatedReferralRequirement)!==referrals||BigInt(entry.estimatedTotalDailyRequirement)!==total))fail('The combined reward funding estimate is inconsistent.');
  if(BigInt(entry.estimatedDailyRequirement)!==estimate||BigInt(entry.minimumBudgetRequired)!==minimum||entry.requiredForExistingPrincipal!==(principal>0n)||entry.backed!==backed||entry.ready!==ready)fail('The reward funding estimate is inconsistent.');
  return {...entry,asset,symbol:asset===ZeroAddress?'tBNB':'Test USDT'};
 });
 if(new Set(assets.map(entry=>entry.asset.toLowerCase())).size!==2)fail('The reward assets are inconsistent.');
 const required=assets.filter(entry=>entry.requiredForExistingPrincipal),fundingReady=required.length?required.every(entry=>entry.ready):assets.some(entry=>entry.ready);
 if(f.ready!==fundingReady||!value.operatorGas||!units(value.operatorGas.balance)||value.operatorGas.positive!==(BigInt(value.operatorGas.balance)>0n)||!['supported','provisional','unavailable'].includes(value.archive?.status))fail('The daily service requirements are inconsistent.');
 const retention=value.archive.requiredRetentionSeconds;
 if(retention!==undefined&&retention!==86400&&!(retention===3600&&(hourlySelected||hourlyPolicy(value.automation?.policy,release.fast))))fail('The historical retention period is invalid.');
 const initialArchiveAccepted=release.fast&&value.archive.status==='provisional'&&value.archive.provisionalAccepted===true&&value.archive.fullyVerified===false;
 if(value.archive.provisionalAccepted===true&&!initialArchiveAccepted)fail('The initial testnet archive status is inconsistent.');
 if(value.ready&&(value.paused||!value.reporterAuthorized||!fundingReady||!value.operatorGas.positive||(value.archive.status!=='supported'&&!initialArchiveAccepted)||value.blockers.length))fail('The daily readiness result is inconsistent.');
 if(value.dailyAutomationActive!==undefined&&typeof value.dailyAutomationActive!=='boolean')fail('The server scheduling status is invalid.');
 if(release.fast&&((value.timerActive!==undefined&&typeof value.timerActive!=='boolean')||(value.dailyAutomationActive===true&&value.timerActive!==true)))fail('The fast testnet timer status is invalid.');
 if(!['not-inspected','waiting','scheduled','blocked'].includes(value.automationStatus))fail('The server scheduling status is invalid.');
 const automation=value.automation;
 if(automation){
  if(automation.version!==1||automation.kind!=='fresh-zero-server-automation'||automation.chainId!==97||!same(automation.target,target)||!['waiting','scheduled'].includes(automation.status)||automation.status!==value.automationStatus||!Array.isArray(automation.dailyCredits))fail('The server activity belongs to an invalid target.');
  if(automation.errors!==undefined&&(!Array.isArray(automation.errors)||!automation.errors.every(item=>typeof item==='string')))fail('The server error report is invalid.');
  if(automation.policy){
   const policy=automation.policy;
   const hourly=hourlyPolicy(policy,release.fast),supported=hourly||policy.periodSeconds===86400&&policy.testInterval===undefined;
   if(policy.version!==1||policy.chainId!==97||!same(policy.vaultAddress,target)||!same(policy.runtimeHash,value.runtimeHash)||policy.deploymentBlock!==value.block||!integer(policy.startTimestamp)||!supported||hourlySelected&&!hourly||!integer(automation.nextEpoch)||automation.firstPeriodEndsAt!==policy.startTimestamp+policy.periodSeconds||!integer(automation.firstPeriodEndsAt+automation.nextEpoch*policy.periodSeconds))fail('The daily period does not match the fresh contract.');
  }else if(automation.firstPeriodEndsAt!==undefined||automation.nextEpoch!==undefined)fail('The daily period has no established start time.');
  if(!automation.dailyCredits.every(batch=>batch&&hash(batch.id)&&['credited','already_credited'].includes(batch.status)&&(batch.status!=='credited'||hash(batch.transactionHash))))fail('The daily credit evidence is invalid.');
  if(automation.lastDailyCredit!==undefined&&automation.lastDailyCredit!==null){
   const history=automation.lastDailyCredit;
   if(!integer(history.epoch)||automation.nextEpoch!==undefined&&history.epoch>=automation.nextEpoch||!Array.isArray(history.batches)||!history.batches.length||history.batches.length>10000||!history.batches.every(batch=>batch&&hash(batch.id)&&hash(batch.transactionHash)&&integer(batch.block)&&batch.block>0&&hash(batch.blockHash))||new Set(history.batches.map(batch=>batch.id.toLowerCase())).size!==history.batches.length||new Set(history.batches.map(batch=>batch.transactionHash.toLowerCase())).size!==history.batches.length)fail('The completed credit history is invalid.');
  }

 }
 return {...value,...identity,identity,funding:{...f,assets},oracleStatus:oracleStatusOf(value,target)};
}

export function activationStatusView(report,nowSeconds=Date.now()/1000){
 const stale=nowSeconds-report.checkpoint.timestamp>900||report.checkpoint.timestamp-nowSeconds>120;
 const fast=report.releaseId==='global-fresh-fast-test-v1';
 const hourly=hourlyPolicy(report.automation?.policy,fast)||hourlySelection(report,fast),oracles=report.oracleStatus||oracleStatusOf(report,report.target),serviceErrors=report.automation?.errors||[];
 const oracleStale=oracles.checkedAt===undefined?stale:nowSeconds-oracles.checkedAt>900||oracles.checkedAt-nowSeconds>120;
 const active=report.dailyAutomationActive===true&&(!fast||report.timerActive===true)&&report.automationStatus==='scheduled'&&report.automation?.status==='scheduled'&&!!report.automation.policy&&report.ready&&!stale&&!oracles.failed&&!(oracles.verified&&oracleStale)&&serviceErrors.length===0;
 const workerWaiting=report.automationStatus==='waiting'&&report.automation?.status==='waiting';
 const title=stale?'Status needs a fresh check':oracles.failed?'Oracle prices need attention':oracles.verified&&oracleStale?'Oracle prices need a fresh check':active?(hourly?'Hourly test cycle is active':'Daily plan is active'):workerWaiting?(hourly?'Hourly test cycle is waiting':'Daily plan is waiting'):report.ready?(hourly?'Ready for hourly test activation':'Ready for server activation'):(hourly?'Hourly test cycle is waiting':'Daily plan is waiting');
 const summary=stale?'The latest server check is out of date. Current daily activity is unverified.':oracles.failed?'The latest oracle check failed. Valid contract quotes are required before investing.':oracles.verified&&oracleStale?'The latest oracle check is out of date. Current contract quotes are unverified.':active?(hourly?'The daily plan percentage is applied once per one-hour test cycle on BNB Testnet.':'The server reports that daily allocation processing is active.'):!report.reporterAuthorized?'Daily credits are blocked: the server operator is not authorized.':workerWaiting?'The worker is waiting for the current period checks to finish. Previously confirmed credits remain recorded.':report.ready?'Contract requirements are satisfied. Active server scheduling has not been verified.':'The server is checking the remaining requirements before daily credits can start.';
 const a=report.reporterProposal;
 const proposal=report.reporterAuthorized?(fast?'Testnet initial server permission was granted at deployment.':'The server operator is authorized.'):!a.queued?'Reporter authorization has not been proposed.':`Council approval: ${a.votes} of ${a.requiredVotes} votes recorded. ${report.checkpoint.timestamp<a.eta?'Authorization is unavailable before '+new Date(a.eta*1000).toLocaleString('en-US')+'.':'The recorded authorization delay has elapsed.'}`;
 const hourlyRetention=report.archive.requiredRetentionSeconds===3600;
 const checks=[
  {label:hourly?'Hourly test cycle':'Daily credits',value:active?'Active':stale?'Unverified':oracles.failed?'Oracle check failed':workerWaiting?'Worker waiting':report.ready?'Ready; scheduling unverified':'Waiting for requirements',ok:active},
  {label:'Oracle prices',value:oracles.failed?'Check failed: '+oracles.errors.join(', '):oracles.verified?(oracleStale?'Previously verified; fresh check required':'Both contract quotes verified'):'Not inspected',ok:oracles.verified&&!oracleStale},
  {label:fast?'Testnet initial server permission':'Server permission',value:report.reporterAuthorized?'Authorized':'Permission missing',ok:report.reporterAuthorized},
  {label:'Reward funding',value:report.funding.ready?(report.funding.estimateVersion===2?'Ready for the personal-profit and referral estimate':'Ready for the legacy personal-profit estimate'):'Funding required',ok:report.funding.ready},
  {label:'Transaction fees',value:report.operatorGas.positive?'Test BNB available':'Server operator needs test BNB',ok:report.operatorGas.positive},
  {label:'Historical account reads',value:report.archive.status==='supported'?(hourlyRetention?'1-hour test retention verified':'Verified'):fast&&report.archive.provisionalAccepted===true?`Initial test checkpoint verified; ${hourlyRetention?'1-hour':'24-hour'} retention pending`:report.archive.status==='provisional'?(hourlyRetention?'Waiting for a full hourly test period':'Waiting for a full daily period'):'Unavailable',ok:report.archive.status==='supported'},
  {label:'Contract operations',value:report.paused?'Paused':'Open',ok:!report.paused}
 ];
 const funding=report.funding.assets.map(entry=>({symbol:entry.symbol,principal:formatUnits(entry.principal,entry.decimals),rewards:formatUnits(entry.rewards,entry.decimals),cash:formatUnits(entry.cash,entry.decimals),minimum:formatUnits(entry.minimumBudgetRequired,entry.decimals),required:entry.requiredForExistingPrincipal,ready:entry.ready}));
 const automation=report.automation,period=automation?.policy,epoch=automation?.nextEpoch;
 const schedule=period?`Next ${hourly?'hourly test cycle':'daily period'}: ${epoch+1}. ${hourly?'Cycle':'Period'} ends ${new Date((automation.firstPeriodEndsAt+epoch*period.periodSeconds)*1000).toLocaleString('en-US')}.`:'A daily start time has not been established.';
 const credited=automation?.dailyCredits.filter(batch=>batch.status==='credited')||[];
 const latestCreditSummary=credited.length?`${credited.length} ${hourly?'hourly test':'daily'} credit ${credited.length===1?'batch was':'batches were'} confirmed in the latest server check.`:`No new ${hourly?'hourly test':'daily'} credit batches were reported in the latest server check.`;
 const previous=automation?.lastDailyCredit;
 const creditSummary=latestCreditSummary+(previous?` Last recorded completed ${hourly?'cycle':'period'}: ${previous.epoch+1}, with ${previous.batches.length} confirmed credit ${previous.batches.length===1?'transaction':'transactions'}.`:'');
 const creditTransactions=[...new Set([...credited.map(batch=>batch.transactionHash),...(previous?.batches||[]).map(batch=>batch.transactionHash)])];
 return {title,summary,active,stale,checks,funding,proposal,schedule,creditSummary,creditTransactions};
}

function startStatusPage(){
 const $=id=>document.getElementById(id);let identity,controller,timer,loading=false,stopped=false;
 function clear(message){$('headline').textContent='Daily status unavailable';$('summary').textContent=message;$('checks').replaceChildren();$('funding').replaceChildren();$('proposal').textContent='';$('schedule').textContent='';$('credits').textContent='';$('checked').textContent='';$('identity').hidden=true;}
 async function json(path,signal){const response=await fetch(path,{cache:'no-store',signal});if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw Error('The server status is temporarily unavailable.');return response.json();}
 async function refresh(){
  if(stopped||loading||document.visibilityState==='hidden')return;loading=true;$('refresh').disabled=true;const request=new AbortController();controller=request;const timeout=setTimeout(()=>request.abort(),12000);
  try{
   const [data,api]=await Promise.all([json('/deploy/zero-start-activation.json',request.signal),json('/api/config',request.signal)]);
   if(stopped)return;const report=parseActivationStatus(data,api,identity),view=activationStatusView(report);identity=report.identity;
   $('headline').textContent=view.title;$('summary').textContent=view.summary;$('checks').replaceChildren();
   for(const check of view.checks){const row=document.createElement('div'),label=document.createElement('span'),value=document.createElement('strong');row.className='status-row';label.textContent=check.label;value.textContent=check.value;value.className=check.ok?'complete':'waiting';row.append(label,value);$('checks').append(row);}
   $('proposal').textContent=view.proposal;$('schedule').textContent=view.schedule;$('credits').textContent=view.creditSummary;
   const links=$('credit-transactions');if(links)links.replaceChildren(...view.creditTransactions.map((hash,index)=>{const link=document.createElement('a');link.href='https://testnet.bscscan.com/tx/'+hash;link.target='_blank';link.rel='noopener noreferrer';link.textContent='View confirmed credit '+(index+1);link.style.marginRight='1em';return link;}));$('funding').replaceChildren();
   for(const asset of view.funding){const row=document.createElement('tr');for(const text of [asset.symbol,asset.principal,asset.rewards,asset.cash,asset.required?asset.minimum:'No active principal',asset.ready?'Ready':asset.required?'Funding needed':'No active principal']){const cell=document.createElement('td');cell.textContent=text;row.append(cell);}$('funding').append(row);}
   $('target').textContent=report.target;$('owner').textContent=report.owner;$('operator').textContent=report.operator;$('creation').textContent=report.hash;$('creation').href='https://testnet.bscscan.com/tx/'+report.hash;$('identity').hidden=false;
   $('checked').textContent='Server checkpoint: '+new Date(report.checkpoint.timestamp*1000).toLocaleString('en-US')+' · Block '+report.checkpoint.block+(view.stale?' · Out of date':'');
  }catch(error){request.abort();if(!stopped)clear(error.name==='AbortError'?'The server check timed out. It will be retried automatically.':error.message||'The server status is temporarily unavailable.');}
  finally{clearTimeout(timeout);loading=false;if(!stopped)$('refresh').disabled=false;}
 }
 $('refresh').addEventListener('click',()=>void refresh());
 const visible=()=>{if(document.visibilityState==='visible')void refresh();};document.addEventListener('visibilitychange',visible);
 const stop=()=>{stopped=true;controller?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};window.addEventListener('pagehide',stop);
 window.addEventListener('pageshow',()=>{if(stopped){stopped=false;document.addEventListener('visibilitychange',visible);timer=setInterval(()=>void refresh(),20000);void refresh();}});
 timer=setInterval(()=>void refresh(),20000);void refresh();
}
if(typeof document!=='undefined')startStatusPage();
