import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,ZeroAddress,keccak256} from 'ethers';
import {checkPriorV3Snapshot,verifyPriorV3Empty} from '../scripts/verify-prior-v3-testnet-empty.mjs';
import {v3ReleasePaths} from '../scripts/v3-release-profile.mjs';
import {waitV3DeploymentReceipt} from '../scripts/v3-deploy-receipt-poll.mjs';

const contract='0x1111111111111111111111111111111111111111';
const tx='0x'+'a'.repeat(64),hash='0x'+'b'.repeat(64);
const proof={status:'VERIFIED_BNB_TESTNET_ONLY',chainId:97,contract,txHash:tx,runtimeHash:hash,blockNumber:100};
const snapshot={chain:97,codeHash:hash,receipt:{status:1,hash:tx,contractAddress:contract,blockNumber:100},
 confirmedBlock:103,asset:'0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89',
 fee:'0x74015dedf36677485793f1714ec7bd4893907b26',managerAllowed:true,
 members:0n,withdrawals:0n,principal:0n,profit:0n,reserved:0n,cash:0n,nativeCash:0n};

test('routed deployment uses distinct fixed proof and keeper paths',()=>{
 const original=v3ReleasePaths(''),routed=v3ReleasePaths('routed-testnet');
 assert.notEqual(original.proof,routed.proof);
 assert.notEqual(original.keeperConfig,routed.keeperConfig);
 assert.throws(()=>v3ReleasePaths('../other'),/V3_RELEASE_PROFILE_INVALID/);
});
test('prior V3 must be verified, confirmed and empty before a separate routed cutover',()=>{
 assert.equal(checkPriorV3Snapshot(proof,snapshot).members,'0');
 for(const key of ['members','withdrawals','principal','profit','reserved','cash','nativeCash'])
  assert.throws(()=>checkPriorV3Snapshot(proof,{...snapshot,[key]:1n}),/REVIEW_BEFORE_SWITCH/);
 assert.throws(()=>checkPriorV3Snapshot({...proof,status:'INTENT'},snapshot),/PROOF_NOT_VERIFIED/);
 assert.throws(()=>checkPriorV3Snapshot(proof,{...snapshot,codeHash:'0x'+'c'.repeat(64)}),/MISMATCH/);
 assert.throws(()=>checkPriorV3Snapshot(proof,{...snapshot,chain:56}),/MISMATCH/);
 assert.throws(()=>checkPriorV3Snapshot(proof,{...snapshot,managerAllowed:false}),/MISMATCH/);
 assert.throws(()=>checkPriorV3Snapshot(proof,{...snapshot,confirmedBlock:99}),/MISMATCH/);
 assert.throws(()=>checkPriorV3Snapshot(proof,{...snapshot,receipt:{...snapshot.receipt,hash:'0x'+'c'.repeat(64)}}),/MISMATCH/);
});
test('receipt polling waits for three confirmations and rejects unsuccessful creation',async()=>{
 let calls=0;
 const provider={getTransactionReceipt:async()=>snapshot.receipt,getBlockNumber:async()=>100+calls++};
 const result=await waitV3DeploymentReceipt(provider,tx,{pollMs:0,delay:async()=>{}});
 assert.equal(result,snapshot.receipt);assert.equal(calls,3);
 await assert.rejects(()=>waitV3DeploymentReceipt({getTransactionReceipt:async()=>({...snapshot.receipt,status:0})},tx),/REVERTED_OR_INVALID/);
});
test('read-only guard accepts an empty verified chain and rejects a newly registered account',async()=>{
 if(!fs.existsSync('artifacts/MockToken.json'))execFileSync(process.execPath,['scripts/compile.mjs'],{stdio:'pipe'});
 if(!fs.existsSync('artifacts/GlobalV3DeferredTestnet.json'))execFileSync(process.execPath,['scripts/compile-global-v3.mjs'],{stdio:'pipe'});
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:2,defaultBalance:50}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=25;
 try{
  const signer=await provider.getSigner(0),user=await provider.getSigner(1);
  const artifact=name=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json','utf8'));
  const tokenArtifact=artifact('MockToken');
  const token=await new ContractFactory(tokenArtifact.abi,'0x'+tokenArtifact.evm.bytecode.object,signer).deploy(18);
  await token.waitForDeployment();
  const pinnedToken='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
  await rpc.request({method:'evm_setAccountCode',params:[pinnedToken,await provider.getCode(token.target)]});
  const vaultArtifact=artifact('GlobalV3DeferredTestnet');
  const vault=await new ContractFactory(vaultArtifact.abi,'0x'+vaultArtifact.evm.bytecode.object,signer).deploy(
   '0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632',pinnedToken,'0x74015dedf36677485793f1714ec7bd4893907b26');
  const receipt=await vault.deploymentTransaction().wait();
  for(let i=0;i<4;i++)await rpc.request({method:'evm_mine',params:[]});
  const actual={status:'VERIFIED_BNB_TESTNET_ONLY',chainId:97,contract:vault.target,
   txHash:receipt.hash,runtimeHash:keccak256(await provider.getCode(vault.target)),blockNumber:receipt.blockNumber};
  assert.equal((await verifyPriorV3Empty(provider,actual)).members,'0');
  await(await vault.connect(user).register(ZeroAddress)).wait();
  await assert.rejects(()=>verifyPriorV3Empty(provider,actual),/REVIEW_BEFORE_SWITCH/);
 }finally{provider.destroy();}
});
