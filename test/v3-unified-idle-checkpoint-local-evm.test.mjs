import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,ZeroAddress,keccak256,parseEther} from 'ethers';
import {compileUnifiedTestnet} from '../scripts/compile-global-v3-unified-testnet.mjs';
import {checkpointUnifiedIdleScan} from '../scripts/checkpoint-v3-unified-idle-scan.mjs';
import {openUnifiedJournal} from '../scripts/v3-unified-keeper-journal.mjs';

const TOKEN='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
const done=async promise=>{const receipt=await(await promise).wait();assert.equal(receipt.status,1);return receipt;};

test('local EVM idle checkpoint stops on a later due accrual and never broadcasts',async()=>{
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
  const journal=openUnifiedJournal(directory);
  journal.prepare({status:'PREPARED',chainId:97,hash:'0x'+'aa'.repeat(32),nonce});journal.close();
  const stopped=await run();assert.equal(stopped.state,'JOURNAL_REQUIRES_RECONCILIATION');
  assert.equal(fs.readFileSync(filename,'utf8'),before);
 }finally{provider.destroy();await rpc.disconnect();fs.rmSync(directory,{recursive:true,force:true});}
});
