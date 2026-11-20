import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,Transaction,Wallet,ZeroAddress,keccak256,parseEther} from 'ethers';
import {compileUnifiedTestnet} from '../scripts/compile-global-v3-unified-testnet.mjs';
import {checkpointUnifiedIdleScan} from '../scripts/checkpoint-v3-unified-idle-scan.mjs';
import {runUnifiedKeeperCycle} from '../scripts/run-v3-unified-keeper-cycle.mjs';
import {openUnifiedJournal} from '../scripts/v3-unified-keeper-journal.mjs';

const TOKEN='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
const done=async promise=>{const receipt=await(await promise).wait();assert.equal(receipt.status,1);return receipt;};

test('local EVM resumes the exact prepared accrual and recovers an interrupted confirmation without replay',async()=>{
 const artifact=compileUnifiedTestnet().GlobalV3UnifiedTestnet;
 if(!fs.existsSync('artifacts/MockToken.json'))execFileSync(process.execPath,['scripts/compile.mjs'],{stdio:'pipe'});
 const mock=JSON.parse(fs.readFileSync('artifacts/MockToken.json','utf8'));
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
  miner:{blockGasLimit:30000000},wallet:{totalAccounts:3,defaultBalance:50}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=20;
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'unified-idle-evm-'));
 try{
  const manager=await provider.getSigner(0),user=await provider.getSigner(1),keeper=await provider.getSigner(2);
  const admin=await manager.getAddress(),who=await user.getAddress(),operator=await keeper.getAddress();
  const original=await new ContractFactory(mock.abi,'0x'+mock.evm.bytecode.object,manager).deploy(18);
  await original.waitForDeployment();
  await rpc.request({method:'evm_setAccountCode',params:[TOKEN,await provider.getCode(original.target)]});
  const token=new Contract(TOKEN,mock.abi,manager);
  const vault=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,manager)
   .deploy(admin,TOKEN,admin,{gasLimit:25000000});
  await vault.waitForDeployment();const deployment=await vault.deploymentTransaction().wait();
  for(let i=0;i<3;i++)await rpc.request({method:'evm_mine',params:[]});
  const book=await vault.reinvestmentBook(),network=await vault.networkPlan();
  const proof={status:'VERIFIED_UNIFIED_TESTNET_ONLY',chainId:97,vault:vault.target,book,network,token:TOKEN,
   manager:admin,feeReceiver:admin,deploymentBlock:deployment.blockNumber,deploymentTx:deployment.hash,
   vaultRuntimeHash:keccak256(await provider.getCode(vault.target)),bookRuntimeHash:keccak256(await provider.getCode(book)),
   networkRuntimeHash:keccak256(await provider.getCode(network))};
  const run=()=>checkpointUnifiedIdleScan({provider,proof,operator,journalDirectory:directory,maxWork:20});
  const nonce=await provider.getTransactionCount(operator);
  const first=await run();assert.equal(first.state,'IDLE_CHECKPOINT_RECORDED');
  assert.deepEqual(first.cursor,{member:0,position:0,lot:0});assert.equal(first.transactionSent,false);
  const filename=path.join(directory,'idle-checkpoint.json'),before=fs.readFileSync(filename,'utf8');
  await done(token.mint(who,parseEther('1000')));
  await done(token.connect(user).approve(vault.target,parseEther('1000')));
  await done(vault.connect(user).deposit(parseEther('1000'),ZeroAddress));
  await done(vault.connect(user).checkIn());
  await rpc.request({method:'evm_increaseTime',params:[3601]});
  for(let i=0;i<4;i++)await rpc.request({method:'evm_mine',params:[]});
  const candidate=await run();
  assert.equal(candidate.state,'ONE_CANDIDATE_REQUIRES_CONFIRMATION');assert.equal(candidate.candidate.method,'accrueDaily');
  assert.equal(candidate.candidate.member,who);assert.equal(candidate.cursorPersisted,false);
  assert.equal(fs.readFileSync(filename,'utf8'),before);
  assert.equal((await vault.positionOf(who,0)).availableProfit,0n);
  assert.equal(await provider.getTransactionCount(operator),nonce);
  const signer=new Wallet(Object.values(rpc.getInitialAccounts())[2].secretKey,provider);
  const waitReceipt=async(p,hash,{confirmations})=>{
   assert.equal(confirmations,3);
   for(let i=1;i<confirmations;i++)await rpc.request({method:'evm_mine',params:[]});
   return await p.getTransactionReceipt(hash);
  };
  const cycle=()=>runUnifiedKeeperCycle({provider,signer,proof,journalDirectory:directory,waitReceipt});
  const pending=path.join(directory,'pending.json');
  const archived=path.join(directory,'last-confirmed-accrual.json');
  const broadcast=provider.broadcastTransaction;
  provider.broadcastTransaction=async()=>{throw Error('simulated crash before broadcast');};
  try{await assert.rejects(cycle(),/simulated crash before broadcast/);}
  finally{provider.broadcastTransaction=broadcast;}
  const prepared=JSON.parse(fs.readFileSync(pending,'utf8'));
  assert.equal(prepared.status,'PREPARED');
  assert.equal(typeof prepared.rawTransaction,'string');
  assert.equal(Transaction.from(prepared.rawTransaction).hash,prepared.hash);
  assert.equal(await provider.getTransactionCount(operator),nonce);
  assert.equal((await vault.positionOf(who,0)).availableProfit,0n);
  fs.writeFileSync(pending,JSON.stringify({...prepared,rawTransaction:undefined}));
  assert.equal((await cycle()).state,'RECEIPT_NOT_OBSERVED');
  assert.equal(await provider.getTransactionCount(operator),nonce);
  fs.writeFileSync(pending,JSON.stringify(prepared));
  const sent=[];
  provider.broadcastTransaction=async raw=>{sent.push(raw);return broadcast.call(provider,raw);};
  const rename=fs.renameSync;
  fs.renameSync=(from,to)=>{
   if(from===pending&&to===archived)throw Error('simulated crash before archive');
   return rename(from,to);
  };
  try{await assert.rejects(cycle(),/simulated crash before archive/);}
  finally{fs.renameSync=rename;provider.broadcastTransaction=broadcast;}
  assert.deepEqual(sent,[prepared.rawTransaction]);
  const record=JSON.parse(fs.readFileSync(pending,'utf8'));
  const checkpoint=JSON.parse(fs.readFileSync(filename,'utf8'));
  assert.equal(checkpoint.lastAccrual.hash,record.hash);
  assert.deepEqual(checkpoint.cursor,record.retryCursor);
  assert.equal(await provider.getTransactionCount(operator),nonce+1);
  const credit=(await vault.positionOf(who,0)).availableProfit;
  assert.ok(credit>0n);
  fs.writeFileSync(pending,JSON.stringify({...record,operator:who}));
  await assert.rejects(cycle(),/OPERATOR_MISMATCH/);
  assert.equal(fs.existsSync(archived),false);
  fs.writeFileSync(pending,JSON.stringify(record));
  const getReceipt=provider.getTransactionReceipt;
  provider.getTransactionReceipt=async hash=>hash===record.hash?null:getReceipt.call(provider,hash);
  provider.broadcastTransaction=async()=>{throw Error('must not rebroadcast a confirmed transaction');};
  try{assert.equal((await cycle()).state,'RECEIPT_NOT_OBSERVED');}
  finally{provider.getTransactionReceipt=getReceipt;provider.broadcastTransaction=broadcast;}
  assert.equal(JSON.parse(fs.readFileSync(pending,'utf8')).hash,record.hash);
  const recovered=await cycle();
  assert.equal(recovered.state,'CONFIRMED_CHECKPOINT_RECORDED');
  assert.equal(recovered.transactionSent,false);
  assert.equal(fs.existsSync(pending),false);
  assert.equal(JSON.parse(fs.readFileSync(archived,'utf8')).hash,record.hash);
  assert.equal((await cycle()).state,'IDLE_CHECKPOINT_RECORDED');
  assert.equal((await vault.positionOf(who,0)).availableProfit,credit);
  assert.equal(await provider.getTransactionCount(operator),nonce+1);
  // An accepted broadcast whose response was lost must not be broadcast again
  // just because one receipt read is temporarily unavailable.
  await rpc.request({method:'evm_increaseTime',params:[3601]});
  for(let i=0;i<4;i++)await rpc.request({method:'evm_mine',params:[]});
  provider.broadcastTransaction=async raw=>{
   await broadcast.call(provider,raw);
   throw Error('simulated response loss after broadcast');
  };
  try{await assert.rejects(cycle(),/simulated response loss after broadcast/);}
  finally{provider.broadcastTransaction=broadcast;}
  const accepted=JSON.parse(fs.readFileSync(pending,'utf8'));
  assert.equal(accepted.status,'PREPARED');
  assert.equal(await provider.getTransactionCount(operator),nonce+2);
  for(let i=0;i<3;i++)await rpc.request({method:'evm_mine',params:[]});
  provider.getTransactionReceipt=async hash=>hash===accepted.hash?null:getReceipt.call(provider,hash);
  provider.broadcastTransaction=async()=>{throw Error('must not resend an observed transaction');};
  try{assert.equal((await cycle()).state,'RECEIPT_NOT_OBSERVED');}
  finally{provider.getTransactionReceipt=getReceipt;provider.broadcastTransaction=broadcast;}
  const acceptedRecovery=await cycle();
  assert.equal(acceptedRecovery.state,'CONFIRMED_CHECKPOINT_RECORDED');
  assert.equal(acceptedRecovery.transactionSent,false);
  assert.equal(await provider.getTransactionCount(operator),nonce+2);
  assert.equal(JSON.parse(fs.readFileSync(archived,'utf8')).hash,accepted.hash);
  const recoveredCheckpoint=fs.readFileSync(filename,'utf8');
  const journal=openUnifiedJournal(directory);
  journal.prepare({status:'PREPARED',chainId:97,hash:'0x'+'aa'.repeat(32),nonce});journal.close();
  const stopped=await run();assert.equal(stopped.state,'JOURNAL_REQUIRES_RECONCILIATION');
  assert.equal(fs.readFileSync(filename,'utf8'),recoveredCheckpoint);
 }finally{provider.destroy();await rpc.disconnect();fs.rmSync(directory,{recursive:true,force:true});}
});
