import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,Interface,ZeroAddress,getCreateAddress,keccak256,parseEther,toQuantity,toUtf8Bytes} from 'ethers';
import {permissionPolicy as p,reporterProposalHash,readPermissionState,preparePermissionAction,submitPermissionAction,permissionActionCompleted} from '../deployment-console/zero-start-permission-core.js';

const abi=new Interface(JSON.parse(fs.readFileSync(new URL('../artifacts/AutomaticGroupVault.json',import.meta.url))).abi);
const queueAbi=new Interface(['function vault() view returns(address)','function APPROVAL_VERSION() view returns(uint256)']);
const hash=n=>keccak256(toUtf8Bytes('permission-test-'+n));
const targetQueue=getCreateAddress({from:p.target,nonce:1}),bytecode='0x6001600055';
const proposalData=abi.encodeFunctionData('setReporter',[p.operator,true]);
function fixture(){
 const metadata={version:1,kind:'fresh-zero-daily-readiness',releaseId:'global-fresh-zero-v1',chainId:97,siteConnected:true,approvalVersion:1,automaticGroupVersion:1,target:p.target,contractAddress:p.target,owner:p.owner,operator:p.operator,token:p.token,tokenDecimals:18,artifactHash:p.artifactHash,queue:targetQueue,hash:hash('creation'),block:100,blockHash:hash(100),runtimeHash:keccak256(bytecode),reporterProposal:{hash:reporterProposalHash,calldata:proposalData}};
 const apiConfig={version:1,chainId:97,vaultAddress:p.target};
 const chain={chainId:97,account:p.owner,head:1000,now:2000000,eta:0,round:0,votes:0,required:0,authorized:false,voted:new Set(),sent:[],calls:[],gas:100000n,gasPrice:1000000000n,balance:10n**18n,pending:false,code:bytecode,owner:p.owner,receiptStatus:'0x1',overrides:{},reorg:null};
 const provider={async request({method,params=[]}){
  chain.calls.push({method,params});
  if(method==='eth_chainId')return toQuantity(chain.chainId);
  if(method==='eth_accounts')return [chain.account];
  if(method==='eth_getBlockByNumber'){
   const number=params[0]==='latest'?chain.head:Number(BigInt(params[0]));
   return {number:toQuantity(number),hash:chain.reorg===number?hash('orphaned-'+number):hash(number),timestamp:toQuantity(number===chain.head?chain.now:chain.now-(chain.head-number)),gasLimit:toQuantity(30000000)};
  }
  if(method==='eth_getCode')return chain.code;
  if(method==='eth_getTransactionReceipt')return {transactionHash:metadata.hash,contractAddress:p.target,from:p.operator,to:null,status:chain.receiptStatus,blockNumber:toQuantity(metadata.block),blockHash:metadata.blockHash};
  if(method==='eth_gasPrice')return toQuantity(chain.gasPrice);
  if(method==='eth_getBalance')return toQuantity(chain.balance);
  if(method==='eth_estimateGas')return toQuantity(chain.gas);
  if(method==='eth_getTransactionCount')return toQuantity(params[1]==='pending'&&chain.pending?2:1);
  if(method==='eth_sendTransaction'){
   chain.sent.push(params[0]);if(chain.sendError)throw chain.sendError;
   return chain.sendHash??hash('sent');
  }
  if(method==='eth_call'){
   const [request]=params,iface=request.to===targetQueue?queueAbi:abi;
   const call=iface.parseTransaction(request),name=call.name,args=call.args;
   let result;
   if(Object.hasOwn(chain.overrides,name))result=chain.overrides[name];
   else if(name==='vault')result=p.target;
   else if(name==='APPROVAL_VERSION'||name==='AUTO_REWARD_GROUP_VERSION'||name==='REWARD_ACCRUAL_VERSION')result=1n;
   else if(name==='owner')result=chain.owner;
   else if(name==='withdrawalQueue')result=targetQueue;
   else if(name==='CONFIG_DELAY')result=172800n;
   else if(name==='partnerCount')result=7n;
   else if(name==='partnerVotesRequired')result=2n;
   else if(name==='partnerWallets')result=p.partners[Number(args[0])];
   else if(name==='reporters')result=chain.authorized;
   else if(name==='queuedConfig')result=BigInt(chain.eta);
   else if(name==='configRound')result=BigInt(chain.round);
   else if(name==='configVotes')result=BigInt(chain.votes);
   else if(name==='configVotesRequired')result=BigInt(chain.required);
   else if(name==='hasConfigVoted')result=chain.voted.has(String(args[1])+':'+args[2].toLowerCase());
   else throw Error('Unexpected contract read '+name);
   return iface.encodeFunctionResult(name,[result]);
  }
  throw Error('Unexpected RPC '+method);
 }};
 const options={provider,metadata,apiConfig,account:p.owner};
 const queue=()=>{chain.eta=chain.now+172800;chain.round=1;chain.required=2;};
 return {chain,provider,metadata,apiConfig,options,queue};
}

test('reads only the pinned fresh target and reports explicit owner/partner actions',async()=>{
 const f=fixture(),s=await readPermissionState(f.options);
 assert.equal(s.target,p.target);assert.equal(s.isOwner,true);assert.equal(s.isPartner,false);
 assert.equal(s.proposal.hash,'0x0372513decee12267353becc648db33c523d83a511f9d71f03bd933133944eb5');
 assert.equal(s.actions.propose.enabled,true);assert.equal(s.actions.vote.enabled,false);assert.equal(s.actions.enable.enabled,false);
 assert.equal(f.chain.sent.length,0);
 assert.ok(f.chain.calls.filter(c=>c.method==='eth_call').every(c=>c.params[1]==='0x3e8'));
});

test('rejects wrong chain, forged identity, missing creation proof and unrelated active API',async()=>{
 for(const [change,error]of [
  [f=>f.chain.chainId=56,/BNB_TESTNET_REQUIRED/],
  [f=>f.metadata.target=p.owner,/FRESH_IDENTITY_MISMATCH/],
  [f=>f.metadata.runtimeHash=hash('wrong-runtime'),/RUNTIME_MISMATCH/],
  [f=>f.chain.receiptStatus='0x0',/DEPLOYMENT_NOT_CANONICAL/],
  [f=>f.apiConfig.vaultAddress=p.owner,/SITE_TARGET_MISMATCH/],
  [f=>f.metadata.reporterProposal.calldata='0x12345678',/PROPOSAL_MISMATCH/],
  [f=>f.chain.reorg=100,/DEPLOYMENT_NOT_CANONICAL/],
  [f=>f.chain.overrides.CONFIG_DELAY=1n,/CONTRACT_CONFIGURATION_CHANGED/],
  [f=>f.chain.overrides.partnerWallets=p.owner,/PARTNER_CONFIGURATION_CHANGED/],
 ]){
  const f=fixture();change(f);await assert.rejects(readPermissionState(f.options),error);assert.equal(f.chain.sent.length,0);
 }
});

test('previews exact zero-value proposal, partner vote and delayed owner execution without sending',async()=>{
 const f=fixture();
 const proposal=await preparePermissionAction({...f.options,action:'propose'});
 assert.equal(proposal.request.data,abi.encodeFunctionData('queueConfiguration',[reporterProposalHash]));
 assert.equal(proposal.gasLimit,'120000');assert.equal(proposal.maxFeeWei,'120000000000000');
 assert.equal(proposal.request.value,'0x0');assert.equal(proposal.request.to,p.target);assert.equal(proposal.request.chainId,'0x61');
 f.queue();f.chain.account=p.partners[0];
 const vote=await preparePermissionAction({...f.options,account:p.partners[0],action:'vote'});
 assert.equal(vote.data,abi.encodeFunctionData('voteConfiguration',[reporterProposalHash]));
 f.chain.account=p.owner;f.chain.now=f.chain.eta;f.chain.votes=2;
 const enable=await preparePermissionAction({...f.options,action:'enable'});
 assert.equal(enable.data,proposalData);assert.equal(f.chain.sent.length,0);
});

test('owner authority, distinct partner voting, delay and funding gas guards fail closed',async()=>{
 const cases=[
  [f=>{f.chain.account=p.partners[0];f.options.account=p.partners[0];},'propose',/OWNER_REQUIRED/],
  [f=>f.queue(),'vote',/PARTNER_REQUIRED/],
  [f=>{f.queue();f.chain.account=p.partners[0];f.options.account=p.partners[0];f.chain.voted.add('1:'+p.partners[0].toLowerCase());},'vote',/ALREADY_VOTED/],
  [f=>{f.queue();f.chain.votes=2;},'enable',/DELAY_NOT_ELAPSED/],
  [f=>{f.queue();f.chain.now=f.chain.eta;f.chain.votes=1;},'enable',/TWO_PARTNER_VOTES_REQUIRED/],
  [f=>f.chain.balance=0n,'propose',/NEEDS_TEST_BNB/],
  [f=>f.chain.gasPrice=10n**14n,'propose',/TEST_BNB_FEE_LIMIT/],
  [f=>f.chain.pending=true,'propose',/HAS_PENDING_TRANSACTIONS/],
  [f=>f.chain.authorized=true,'propose',/ALREADY_AUTHORIZED/],
 ];
 for(const [change,action,error]of cases){const f=fixture();change(f);await assert.rejects(preparePermissionAction({...f.options,action}),error);assert.equal(f.chain.sent.length,0);}
});

test('submit revalidates the reviewed request and journals before one explicit wallet request',async()=>{
 const f=fixture(),prepared=await preparePermissionAction({...f.options,action:'propose'});let saved=false;
 const original=f.provider.request;
 f.provider.request=async request=>{if(request.method==='eth_sendTransaction')assert.equal(saved,true);return original(request);};
 const result=await submitPermissionAction({...f.options,prepared,beforeSend:()=>{saved=true;}});
 assert.equal(result,hash('sent'));assert.equal(f.chain.sent.length,1);assert.deepEqual(f.chain.sent[0],prepared.request);
});

test('changed requests, rounds, accounts, chains or higher fees require review before the wallet is requested',async()=>{
 const cases=[
  [f=>f.prepared.request.to=p.owner,/REVIEW_REQUEST_CHANGED/],
  [f=>f.prepared.request.value='0x1',/REVIEW_REQUEST_CHANGED/],
  [f=>f.prepared.request.data=proposalData,/REVIEW_REQUEST_CHANGED/],
  [f=>f.prepared.action='withdraw',/ACTION_NOT_ALLOWED/],
  [f=>f.chain.round=1,/PROPOSAL_CHANGED_REVIEW_REQUIRED/],
  [f=>f.chain.account=p.partners[0],/WALLET_ACCOUNT_CHANGED/],
  [f=>f.chain.chainId=56,/BNB_TESTNET_REQUIRED/],
  [f=>f.chain.gasPrice*=2n,/FEE_CHANGED_REVIEW_REQUIRED/],
  [f=>f.chain.gas*=2n,/FEE_CHANGED_REVIEW_REQUIRED/],
 ];
 for(const [change,error]of cases){const f=fixture();f.prepared=await preparePermissionAction({...f.options,action:'propose'});change(f);await assert.rejects(submitPermissionAction({...f.options,prepared:f.prepared}),e=>error.test(e.message)&&e.transactionRequested===false);assert.equal(f.chain.sent.length,0);}
});

test('a lower fresh gas price never bypasses the balance needed for the reviewed request',async()=>{
 const f=fixture(),prepared=await preparePermissionAction({...f.options,action:'propose'});let journaled=0;
 f.chain.gasPrice/=2n;
 f.chain.balance=BigInt(prepared.maxFeeWei)*3n/4n;
 assert.ok(f.chain.balance>BigInt(prepared.gasLimit)*f.chain.gasPrice);
 assert.ok(f.chain.balance<BigInt(prepared.maxFeeWei));
 await assert.rejects(submitPermissionAction({...f.options,prepared,beforeSend:()=>{journaled++;}}),error=>error.message==='PERMISSION_OWNER_OR_PARTNER_NEEDS_TEST_BNB'&&error.transactionRequested===false);
 assert.equal(journaled,0);assert.equal(f.chain.sent.length,0);
});

test('pre-send storage failures and account/chain changes never request a wallet transaction',async()=>{
 for(const change of [()=>{throw Error('STORAGE_FAILED');},f=>{f.chain.chainId=56;},f=>{f.chain.account=p.partners[0];},f=>{f.chain.reorg=1000;}]){
  const f=fixture(),prepared=await preparePermissionAction({...f.options,action:'propose'});
  await assert.rejects(submitPermissionAction({...f.options,prepared,beforeSend:()=>change(f)}),e=>e.transactionRequested===false);
  assert.equal(f.chain.sent.length,0);
 }
});

test('wallet rejection is distinguished from an unknown signed response and neither is resent',async()=>{
 for(const [error,requested]of [[Object.assign(Error('Rejected'),{code:4001}),false],[Object.assign(Error('Response lost'),{code:-32000}),true]]){
  const f=fixture(),prepared=await preparePermissionAction({...f.options,action:'propose'});f.chain.sendError=error;
  await assert.rejects(submitPermissionAction({...f.options,prepared}),e=>e.transactionRequested===requested);
  assert.equal(f.chain.sent.length,1);
 }
 const f=fixture(),prepared=await preparePermissionAction({...f.options,action:'propose'});f.chain.sendHash='invalid';
 await assert.rejects(submitPermissionAction({...f.options,prepared}),e=>e.transactionRequested===true&&/RESPONSE_UNKNOWN/.test(e.message));
 assert.equal(f.chain.sent.length,1);
});

test('unknown responses reconcile only canonical confirmed action evidence for the original round',async()=>{
 const f=fixture(),propose=await preparePermissionAction({...f.options,action:'propose'});
 assert.equal(await permissionActionCompleted({...f.options,prepared:propose}),false);
 f.queue();assert.equal(await permissionActionCompleted({...f.options,prepared:propose}),true);
 const reads=f.chain.calls.filter(c=>c.method==='eth_call');assert.ok(reads.some(c=>c.params[1]==='0x3e5'));
 f.chain.account=p.partners[0];const vote=await preparePermissionAction({...f.options,account:p.partners[0],action:'vote'});
 assert.equal(await permissionActionCompleted({...f.options,prepared:vote}),false);
 f.chain.voted.add('1:'+p.partners[0].toLowerCase());f.chain.round=2;
 assert.equal(await permissionActionCompleted({...f.options,prepared:vote}),true);
 const original=f.provider.request;let checkpointReads=0;
 f.provider.request=async request=>{
  const result=await original(request);
  if(request.method==='eth_getBlockByNumber'&&request.params[0]==='0x3e5'&&++checkpointReads>1)return {...result,hash:hash('orphaned-checkpoint')};
  return result;
 };
 await assert.rejects(permissionActionCompleted({...f.options,prepared:propose}),/CHAIN_REORGANIZED/);
 assert.equal(f.chain.sent.length,0);
});

test('actual fresh contract accepts the pinned owner proposal, two partner votes and delayed enable without funding or redeployment',async()=>{
 const artifact=JSON.parse(fs.readFileSync(new URL('../artifacts/AutomaticGroupVault.json',import.meta.url)));
 const rpc=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:1,unlockedAccounts:[p.owner,p.operator,...p.partners]},chain:{chainId:97,hardfork:'shanghai'},miner:{blockGasLimit:30000000}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 try{
  for(const address of [p.operator,p.owner,...p.partners])await rpc.request({method:'evm_setAccountBalance',params:[address,toQuantity(parseEther('10'))]});
  // Constructor-only test doubles return 18 decimals; permission functions do not use feeds or token balances.
  for(const address of [p.token,'0xDA264c16Ec8832748a1A5A31b963deD9E48e337a','0xE7D68dF5e1e9B0F5BeB3201b4Ab1d64aC7761454'])await rpc.request({method:'evm_setAccountCode',params:[address,'0x601260005260206000f3']});
  await rpc.request({method:'evm_setAccountNonce',params:[p.operator,'0x2f']});
  assert.equal(getCreateAddress({from:p.operator,nonce:47}),p.target);
  const signer=await provider.getSigner(p.operator);
  const vault=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,signer).deploy(p.owner,p.token,'0xDA264c16Ec8832748a1A5A31b963deD9E48e337a','0xE7D68dF5e1e9B0F5BeB3201b4Ab1d64aC7761454',86400,p.partners,'0x8c4AC9b009808a0B49Ba77b58e3871e7cDba463c',{gasLimit:15000000});
  const receipt=await vault.deploymentTransaction().wait();assert.equal(vault.target,p.target);
  const metadata={...fixture().metadata,hash:receipt.hash,block:receipt.blockNumber,blockHash:receipt.blockHash,runtimeHash:keccak256(await provider.getCode(p.target))};
  let account=p.owner,sends=0;
  const transport={request:async request=>{
   if(request.method==='eth_accounts')return [account];
   if(request.method==='eth_sendTransaction')sends++;
   return rpc.request(request);
  }};
  const options=()=>({provider:transport,metadata,apiConfig:{version:1,chainId:97,vaultAddress:p.target},account});
  const send=async action=>{
   const prepared=await preparePermissionAction({...options(),action});
   const hash=await submitPermissionAction({...options(),prepared});
   const receipt=await rpc.request({method:'eth_getTransactionReceipt',params:[hash]});
   assert.equal(receipt.status,'0x1');assert.equal(receipt.to.toLowerCase(),p.target.toLowerCase());return prepared;
  };
  const propose=await send('propose');assert.ok(await vault.queuedConfig(reporterProposalHash)>0n);
  for(let i=0;i<3;i++)await rpc.request({method:'evm_mine',params:[]});
  assert.equal(await permissionActionCompleted({...options(),prepared:propose}),true);
  account=p.partners[0];await send('vote');assert.equal(await vault.configVotes(reporterProposalHash),1n);
  await assert.rejects(preparePermissionAction({...options(),action:'vote'}),/ALREADY_VOTED/);
  account=p.partners[1];await send('vote');assert.equal(await vault.configVotes(reporterProposalHash),2n);
  account=p.owner;await assert.rejects(preparePermissionAction({...options(),action:'enable'}),/DELAY_NOT_ELAPSED/);
  await rpc.request({method:'evm_increaseTime',params:[172801]});await rpc.request({method:'evm_mine',params:[]});
  await send('enable');assert.equal(await vault.reporters(p.operator),true);assert.equal(await vault.queuedConfig(reporterProposalHash),0n);
  assert.equal((await vault.ledgers(ZeroAddress)).rewards,0n);assert.equal(await provider.getTransactionCount(p.operator),48);
  assert.equal(sends,4);
 }finally{await provider.destroy();await rpc.disconnect();}
});
