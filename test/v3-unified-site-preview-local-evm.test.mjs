import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,keccak256} from 'ethers';
import {compileUnifiedTestnet} from '../scripts/compile-global-v3-unified-testnet.mjs';
import {planUnifiedPreviewSite} from '../scripts/v3-unified-site-preview-preflight.mjs';

const TOKEN='0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89';
const MANAGER='0x5bC282A45A8a1d7D9b915f04fC1D4031156d7632';
const FEE='0x74015dedf36677485793f1714ec7bd4893907b26';

test('checks actual local component bytecode and never sends a site preflight transaction',async()=>{
 const artifact=compileUnifiedTestnet().GlobalV3UnifiedTestnet;
 if(!fs.existsSync('artifacts/MockToken.json'))execFileSync(process.execPath,['scripts/compile.mjs'],{stdio:'pipe'});
 const mock=JSON.parse(fs.readFileSync('artifacts/MockToken.json','utf8'));
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},
  miner:{blockGasLimit:30000000},wallet:{totalAccounts:1,defaultBalance:50}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=20;
 try{
  const signer=await provider.getSigner(0),who=await signer.getAddress();
  const token=await new ContractFactory(mock.abi,'0x'+mock.evm.bytecode.object,signer).deploy(18);
  await token.waitForDeployment();
  await rpc.request({method:'evm_setAccountCode',params:[TOKEN,await provider.getCode(token.target)]});
  const vault=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,signer)
   .deploy(MANAGER,TOKEN,FEE,{gasLimit:25000000});
  await vault.waitForDeployment();const receipt=await vault.deploymentTransaction().wait();
  const book=await vault.reinvestmentBook(),network=await vault.networkPlan();
  for(let i=0;i<4;i++)await rpc.request({method:'evm_mine',params:[]});
  const proof={status:'VERIFIED_UNIFIED_TESTNET_ONLY',chainId:97,vault:vault.target,book,network,token:TOKEN,
   manager:MANAGER,feeReceiver:FEE,deploymentBlock:receipt.blockNumber,deploymentTx:receipt.hash,
   vaultRuntimeHash:keccak256(await provider.getCode(vault.target)),bookRuntimeHash:keccak256(await provider.getCode(book)),
   networkRuntimeHash:keccak256(await provider.getCode(network))};
  const nonce=await provider.getTransactionCount(who,'latest');
  const sourceSha='a'.repeat(40);
  const result=await planUnifiedPreviewSite({provider,proof,sourceSha,expectedSourceSha:sourceSha});
  assert.equal(result.releaseReady,false);assert.equal(result.siteUpdated,false);
  assert.equal(result.transactionSent,false);assert.equal(result.routeVerified,false);
  assert.equal(await provider.getTransactionCount(who,'latest'),nonce);
 }finally{provider.destroy();await rpc.disconnect();}
});
