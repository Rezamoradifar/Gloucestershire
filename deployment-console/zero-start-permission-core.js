// Permission-only testnet requests. No funding, deployment or private-key access.
import {Interface,ZeroAddress,getAddress,getCreateAddress,keccak256,toQuantity} from './ethers.js';

export const permissionPolicy=Object.freeze({
 chainId:97,target:'0x23C32Bb326DB63f89532f80e757B8463c75655b8',
 owner:'0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632',operator:'0xf2ad0FB5288785E58943070De6CF6A1f7a68FBB2',
 token:'0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89',
 artifactHash:'0x64f24990045d9ef3d268e97657ed6e6af013cb73fc8ec39b9a862929c069e8cf',
 delaySeconds:172800,requiredVotes:2,maxFeeWei:'10000000000000000',
 partners:Object.freeze(['0xA7705F5c98263Caae042626a5d49528Dd982Af5F','0x2F980aC9ae92DB23cA2AEAd1CE8188A5764a7Bfa','0x730C4664C58aE506C05b50e06c1CE73f71D82b87','0xa63AD5EEe7907D76B22eb140cC4009fDc3a6c977','0xba869ec421be39c5F5410033Cf7Ec203298B151a','0x4274d411FF49Cfd2FCf1eC97Fb05f51099d5E0A3','0x63c5B98AEfd69658B652d5F35FFda3C6c06847E3'])
});
const vaultInterface=new Interface([
 'function owner() view returns(address)','function withdrawalQueue() view returns(address)',
 'function AUTO_REWARD_GROUP_VERSION() view returns(uint256)','function REWARD_ACCRUAL_VERSION() view returns(uint256)',
 'function CONFIG_DELAY() view returns(uint256)','function partnerCount() view returns(uint8)',
 'function partnerWallets(uint256) view returns(address)','function partnerVotesRequired() view returns(uint8)',
 'function reporters(address) view returns(bool)','function queuedConfig(bytes32) view returns(uint256)',
 'function configRound(bytes32) view returns(uint256)','function configVotes(bytes32) view returns(uint8)',
 'function configVotesRequired(bytes32) view returns(uint8)','function hasConfigVoted(bytes32,uint256,address) view returns(bool)',
 'function queueConfiguration(bytes32)','function voteConfiguration(bytes32)','function setReporter(address,bool)'
]);
const queueInterface=new Interface(['function vault() view returns(address)','function APPROVAL_VERSION() view returns(uint256)']);
const enableData=vaultInterface.encodeFunctionData('setReporter',[permissionPolicy.operator,true]);
export const reporterProposalHash=keccak256(enableData);
const queueAddress=getCreateAddress({from:permissionPolicy.target,nonce:1});
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const isHash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value)&&!/^0x0{64}$/i.test(value);
const fail=code=>{throw Error(code);};
const safeNumber=value=>{const number=Number(BigInt(value));if(!Number.isSafeInteger(number)||number<0)fail('PERMISSION_INVALID_CHAIN_VALUE');return number;};
const rpc=(provider,method,params=[])=>{if(typeof provider?.request!=='function')fail('PERMISSION_WALLET_PROVIDER_REQUIRED');return provider.request({method,params});};
const quantity=value=>{try{const n=BigInt(value);if(n<0n)fail('PERMISSION_INVALID_CHAIN_VALUE');return n;}catch{fail('PERMISSION_INVALID_CHAIN_VALUE');}};
function accountAddress(value){try{const address=getAddress(value);if(address!==ZeroAddress)return address;}catch{}return fail('PERMISSION_VALID_ACCOUNT_REQUIRED');}
function identity(metadata,apiConfig){
 const p=permissionPolicy;
 if(metadata?.version!==1||metadata.kind!=='fresh-zero-daily-readiness'||metadata.releaseId!=='global-fresh-zero-v1'||metadata.chainId!==97||metadata.siteConnected!==true||metadata.approvalVersion!==1||metadata.automaticGroupVersion!==1||!same(metadata.target,p.target)||!same(metadata.contractAddress,p.target)||!same(metadata.owner,p.owner)||!same(metadata.operator,p.operator)||!same(metadata.token,p.token)||metadata.tokenDecimals!==18||!same(metadata.artifactHash,p.artifactHash)||!same(metadata.queue,queueAddress))fail('PERMISSION_FRESH_IDENTITY_MISMATCH');
 if(!isHash(metadata.hash)||!isHash(metadata.blockHash)||!isHash(metadata.runtimeHash)||!Number.isSafeInteger(metadata.block)||metadata.block<1)fail('PERMISSION_DEPLOYMENT_PROOF_REQUIRED');
 if(apiConfig?.version!==1||apiConfig.chainId!==97||!same(apiConfig.vaultAddress,p.target))fail('PERMISSION_SITE_TARGET_MISMATCH');
 if(!same(metadata.reporterProposal?.hash,reporterProposalHash)||!same(metadata.reporterProposal?.calldata,enableData))fail('PERMISSION_PROPOSAL_MISMATCH');
 return {hash:metadata.hash.toLowerCase(),block:metadata.block,blockHash:metadata.blockHash.toLowerCase(),runtimeHash:metadata.runtimeHash.toLowerCase(),queue:queueAddress};
}
async function currentAccount(provider,account){
 const normalized=accountAddress(account),accounts=await rpc(provider,'eth_accounts');
 if(!Array.isArray(accounts)||!same(accounts[0],normalized))fail('PERMISSION_WALLET_ACCOUNT_CHANGED');
 return normalized;
}
async function checkChain(provider){if(quantity(await rpc(provider,'eth_chainId'))!==97n)fail('PERMISSION_BNB_TESTNET_REQUIRED');}
async function block(provider,tag){
 const value=await rpc(provider,'eth_getBlockByNumber',[tag,false]);
 if(!value||!isHash(value.hash))fail('PERMISSION_CANONICAL_BLOCK_REQUIRED');
 return {number:safeNumber(value.number),hash:value.hash.toLowerCase(),timestamp:safeNumber(value.timestamp),gasLimit:quantity(value.gasLimit)};
}
async function canonical(provider,anchor){if((await block(provider,toQuantity(anchor.number))).hash!==anchor.hash)fail('PERMISSION_CHAIN_REORGANIZED');}
async function readAt({provider,metadata,apiConfig,account,anchor,checkAccount=true}){
 const deployment=identity(metadata,apiConfig);await checkChain(provider);
 const actor=account?checkAccount?await currentAccount(provider,account):accountAddress(account):null;
 anchor??=await block(provider,'latest');
 if(anchor.number<deployment.block)fail('PERMISSION_DEPLOYMENT_NOT_CONFIRMED');
 const tag=toQuantity(anchor.number),p=permissionPolicy;
 const call=async(name,args=[],address=p.target,iface=vaultInterface)=>{
  const value=await rpc(provider,'eth_call',[{to:address,data:iface.encodeFunctionData(name,args)},tag]);
  try{return iface.decodeFunctionResult(name,value)[0];}catch{fail('PERMISSION_CONTRACT_READ_FAILED');}
 };
 const [code,receipt,created]=await Promise.all([
  rpc(provider,'eth_getCode',[p.target,tag]),rpc(provider,'eth_getTransactionReceipt',[deployment.hash]),block(provider,toQuantity(deployment.block))
 ]);
 if(typeof code!=='string'||code==='0x'||!same(keccak256(code),deployment.runtimeHash))fail('PERMISSION_RUNTIME_MISMATCH');
 if(!receipt||quantity(receipt.status)!==1n||!same(receipt.transactionHash,deployment.hash)||!same(receipt.contractAddress,p.target)||!same(receipt.from,p.operator)||receipt.to!==null||safeNumber(receipt.blockNumber)!==deployment.block||!same(receipt.blockHash,deployment.blockHash)||created.hash!==deployment.blockHash)fail('PERMISSION_DEPLOYMENT_NOT_CANONICAL');
 const calls=[['owner'],['withdrawalQueue'],['AUTO_REWARD_GROUP_VERSION'],['REWARD_ACCRUAL_VERSION'],['CONFIG_DELAY'],['partnerCount'],['partnerVotesRequired'],['reporters',[p.operator]],['queuedConfig',[reporterProposalHash]],['configRound',[reporterProposalHash]],['configVotes',[reporterProposalHash]],['configVotesRequired',[reporterProposalHash]]];
 const results=[];
 for(let offset=0;offset<calls.length;offset+=4)results.push(...await Promise.all(calls.slice(offset,offset+4).map(([name,args])=>call(name,args))));
 const [owner,queue,groupVersion,rewardVersion,delay,count,quorum,reporterAuthorized,etaValue,roundValue,votesValue,requiredValue]=results;
 if(!same(owner,p.owner)||!same(queue,queueAddress)||groupVersion!==1n||rewardVersion!==1n||delay!==172800n||count!==7n||quorum!==2n)fail('PERMISSION_CONTRACT_CONFIGURATION_CHANGED');
 const [queueVault,queueVersion]=await Promise.all([call('vault',[],queueAddress,queueInterface),call('APPROVAL_VERSION',[],queueAddress,queueInterface)]);
 if(!same(queueVault,p.target)||queueVersion!==1n)fail('PERMISSION_APPROVAL_QUEUE_MISMATCH');
 const eta=safeNumber(etaValue),round=safeNumber(roundValue),votes=safeNumber(votesValue),storedRequired=safeNumber(requiredValue),queued=eta>0;
 if(votes>7||queued&&(round<1||storedRequired!==2)||!queued&&(votes!==0||storedRequired!==0))fail('PERMISSION_GOVERNANCE_STATE_INVALID');
 const partners=[];
 for(let offset=0;offset<7;offset+=4){
  const group=await Promise.all(p.partners.slice(offset,offset+4).map(async(expected,index)=>{
   const actual=await call('partnerWallets',[offset+index]);if(!same(actual,expected))fail('PERMISSION_PARTNER_CONFIGURATION_CHANGED');
   return {address:expected,voted:await call('hasConfigVoted',[reporterProposalHash,roundValue,expected])};
  }));partners.push(...group);
 }
 await canonical(provider,anchor);await checkChain(provider);if(actor&&checkAccount)await currentAccount(provider,actor);
 const isOwner=!!actor&&same(actor,p.owner),partner=partners.find(row=>same(row.address,actor)),isPartner=!!partner,hasVoted=partner?.voted===true;
 const reason=action=>reporterAuthorized?'PERMISSION_SERVER_ALREADY_AUTHORIZED':!actor?'PERMISSION_CONNECT_WALLET_REQUIRED':action==='propose'?!isOwner?'PERMISSION_OWNER_REQUIRED':queued?'PERMISSION_PROPOSAL_ALREADY_QUEUED':null:action==='vote'?!isPartner?'PERMISSION_PARTNER_REQUIRED':!queued?'PERMISSION_PROPOSAL_REQUIRED':hasVoted?'PERMISSION_PARTNER_ALREADY_VOTED':null:!isOwner?'PERMISSION_OWNER_REQUIRED':!queued?'PERMISSION_PROPOSAL_REQUIRED':votes<2?'PERMISSION_TWO_PARTNER_VOTES_REQUIRED':anchor.timestamp<eta?'PERMISSION_DELAY_NOT_ELAPSED':null;
 return {version:1,chainId:97,target:p.target,owner:p.owner,operator:p.operator,queue:queueAddress,account:actor,reporterAuthorized,block:anchor.number,blockHash:anchor.hash,timestamp:anchor.timestamp,gasLimit:anchor.gasLimit.toString(),deployment,proposal:{hash:reporterProposalHash,round,eta,votes,requiredVotes:2,queued,delayElapsed:queued&&anchor.timestamp>=eta},partners,isOwner,isPartner,hasVoted,actions:Object.fromEntries(['propose','vote','enable'].map(action=>{const message=reason(action);return [action,{enabled:message===null,reason:message}];}))};
}
export async function readPermissionState(options){return readAt(options);}
function actionData(action){
 if(action==='propose')return vaultInterface.encodeFunctionData('queueConfiguration',[reporterProposalHash]);
 if(action==='vote')return vaultInterface.encodeFunctionData('voteConfiguration',[reporterProposalHash]);
 if(action==='enable')return enableData;
 return fail('PERMISSION_ACTION_NOT_ALLOWED');
}
async function quote(provider,state,data){
 const request={from:state.account,to:permissionPolicy.target,data,value:'0x0',chainId:'0x61'};
 const [estimateValue,priceValue,balanceValue,latestNonce,pendingNonce]=await Promise.all([
  rpc(provider,'eth_estimateGas',[request]),rpc(provider,'eth_gasPrice'),rpc(provider,'eth_getBalance',[state.account,'latest']),rpc(provider,'eth_getTransactionCount',[state.account,'latest']),rpc(provider,'eth_getTransactionCount',[state.account,'pending'])
 ]);
 const estimate=quantity(estimateValue),gasLimit=(estimate*120n+99n)/100n,gasPrice=quantity(priceValue),maxFee=gasLimit*gasPrice;
 if(estimate===0n||gasPrice===0n||gasLimit>BigInt(state.gasLimit))fail('PERMISSION_GAS_ESTIMATE_UNAVAILABLE');
 if(maxFee>BigInt(permissionPolicy.maxFeeWei))fail('PERMISSION_TEST_BNB_FEE_LIMIT');
 if(quantity(balanceValue)<maxFee)fail('PERMISSION_OWNER_OR_PARTNER_NEEDS_TEST_BNB');
 if(quantity(latestNonce)!==quantity(pendingNonce))fail('PERMISSION_WALLET_HAS_PENDING_TRANSACTIONS');
 return {gasLimit,gasPrice,maxFee,balance:quantity(balanceValue),request:{...request,gas:toQuantity(gasLimit),gasPrice:toQuantity(gasPrice)}};
}
export async function preparePermissionAction(options){
 const data=actionData(options.action);if(!options.account)fail('PERMISSION_CONNECT_WALLET_REQUIRED');
 const state=await readPermissionState(options),action=state.actions[options.action];if(!action.enabled)fail(action.reason);
 const cost=await quote(options.provider,state,data);
 await canonical(options.provider,{number:state.block,hash:state.blockHash});await checkChain(options.provider);await currentAccount(options.provider,state.account);
 return {version:1,action:options.action,account:state.account,target:state.target,chainId:97,proposalHash:reporterProposalHash,round:state.proposal.round,eta:state.proposal.eta,deployment:state.deployment,data,gasLimit:cost.gasLimit.toString(),gasPrice:cost.gasPrice.toString(),maxFeeWei:cost.maxFee.toString(),request:cost.request};
}
function validatePrepared(prepared,deployment){
 if(prepared?.version!==1||prepared.chainId!==97||!same(prepared.target,permissionPolicy.target)||!same(prepared.proposalHash,reporterProposalHash)||!Number.isSafeInteger(prepared.round)||prepared.round<0||!Number.isSafeInteger(prepared.eta)||prepared.eta<0)fail('PERMISSION_REVIEW_REQUIRED');
 const data=actionData(prepared.action),account=accountAddress(prepared.account),gasLimit=quantity(prepared.gasLimit),gasPrice=quantity(prepared.gasPrice),maxFee=gasLimit*gasPrice;
 const request={from:account,to:permissionPolicy.target,data,value:'0x0',chainId:'0x61',gas:toQuantity(gasLimit),gasPrice:toQuantity(gasPrice)};
 if(!same(prepared.data,data)||gasLimit===0n||gasPrice===0n||maxFee>BigInt(permissionPolicy.maxFeeWei)||String(maxFee)!==prepared.maxFeeWei||JSON.stringify(prepared.deployment)!==JSON.stringify(deployment)||!prepared.request||Object.keys(prepared.request).sort().join(',')!==Object.keys(request).sort().join(',')||Object.keys(request).some(key=>prepared.request[key]!==request[key]))fail('PERMISSION_REVIEW_REQUEST_CHANGED');
 return request;
}
export async function submitPermissionAction({provider,metadata,apiConfig,account,prepared,beforeSend=()=>{}}){
 let transactionRequested=false;
 try{
  const deployment=identity(metadata,apiConfig),request=validatePrepared(prepared,deployment);
  if(!same(account,prepared.account))fail('PERMISSION_WALLET_ACCOUNT_CHANGED');
  const state=await readPermissionState({provider,metadata,apiConfig,account});
  if(!state.actions[prepared.action].enabled)fail(state.actions[prepared.action].reason);
  if(state.proposal.round!==prepared.round||state.proposal.eta!==prepared.eta)fail('PERMISSION_PROPOSAL_CHANGED_REVIEW_REQUIRED');
  const cost=await quote(provider,state,prepared.data);
  if(cost.gasLimit>BigInt(prepared.gasLimit)||cost.gasPrice>BigInt(prepared.gasPrice))fail('PERMISSION_FEE_CHANGED_REVIEW_REQUIRED');
  if(cost.balance<BigInt(prepared.maxFeeWei))fail('PERMISSION_OWNER_OR_PARTNER_NEEDS_TEST_BNB');
  // The UI persists its intent at this exact boundary, before the wallet request.
  await beforeSend(prepared);
  await canonical(provider,{number:state.block,hash:state.blockHash});await checkChain(provider);await currentAccount(provider,prepared.account);
  transactionRequested=true;
  const hash=await rpc(provider,'eth_sendTransaction',[request]);
  if(!isHash(hash))fail('PERMISSION_WALLET_RESPONSE_UNKNOWN');
  return hash;
 }catch(error){
  if(!error||typeof error!=='object')error=Error('PERMISSION_WALLET_REQUEST_FAILED');
  error.transactionRequested=transactionRequested&&Number(error.code)!==4001;
  throw error;
 }
}
export async function permissionActionCompleted({provider,metadata,apiConfig,prepared}){
 const deployment=identity(metadata,apiConfig);validatePrepared(prepared,deployment);
 await checkChain(provider);const head=await block(provider,'latest');if(head.number-3<deployment.block)return false;
 const anchor=await block(provider,toQuantity(head.number-3));
 const state=await readAt({provider,metadata,apiConfig,account:prepared.account,anchor,checkAccount:false});
 let complete;
 if(prepared.action==='propose')complete=state.reporterAuthorized||state.proposal.queued&&state.proposal.round>prepared.round;
 else if(prepared.action==='enable')complete=state.reporterAuthorized;
 else{
  const data=vaultInterface.encodeFunctionData('hasConfigVoted',[reporterProposalHash,prepared.round,prepared.account]);
  const raw=await rpc(provider,'eth_call',[{to:permissionPolicy.target,data},toQuantity(anchor.number)]);
  complete=vaultInterface.decodeFunctionResult('hasConfigVoted',raw)[0]===true;
 }
 await canonical(provider,anchor);await checkChain(provider);return complete;
}
