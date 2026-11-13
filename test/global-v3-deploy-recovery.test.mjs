import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {waitV3DeploymentReceipt} from '../scripts/v3-deploy-receipt-poll.mjs';

const tx='0x'+'a'.repeat(64);
const contract='0x'+'1'.repeat(40);
const receipt={hash:tx,contractAddress:contract,status:1,blockNumber:100};
const delay=()=>Promise.resolve();

test('poll real V3 deployment receipt for 3 confirmations, never use ethers TransactionResponse.wait',async()=>{
 let reads=0,blocks=0;
 const provider={
  async getTransactionReceipt(hash){assert.equal(hash,tx);reads++;return reads>2?receipt:null;},
  async getBlockNumber(){return [100,101,102][blocks++];}
 };
 const result=await waitV3DeploymentReceipt(provider,tx,{confirmations:3,pollMs:0,delay});
 assert.equal(result,receipt);
 assert.equal(reads,5);
 assert.equal(blocks,3);
});
test('reject failed receipt, wrong transaction and missing deployment contract',async()=>{
 for(const bad of [
  {...receipt,status:0},
  {...receipt,contractAddress:null},
  {...receipt,hash:'0x'+'b'.repeat(64)},
  {...receipt,blockNumber:0}
 ]){
  const p={
   async getTransactionReceipt(){return bad;},
   async getBlockNumber(){throw Error('should not be called');}
  };
  await assert.rejects(()=>waitV3DeploymentReceipt(p,tx,{pollMs:0,delay}),
   /V3_DEPLOY_RECEIPT_REVERTED_OR_INVALID/);
 }
});
test('do not claim success if BNB testnet confirmations never arrive',async()=>{
 const p={
  async getTransactionReceipt(){return receipt;},
  async getBlockNumber(){return 101;}
 };
 let clock=0;
 await assert.rejects(
  ()=>waitV3DeploymentReceipt(p,tx,{confirmations:3,pollMs:0,timeoutMs:1000,
   now:()=>{clock+=250;return clock;},delay}),
  /CONFIRMATIONS_TIMEOUT/);
});
test('requires bounded, well-formed transaction and confirmation count',async()=>{
 const p={getTransactionReceipt:async()=>null,getBlockNumber:async()=>0};
 await assert.rejects(()=>waitV3DeploymentReceipt(p,'0x123'),/POLL_PARAMETERS_INVALID/);
 await assert.rejects(()=>waitV3DeploymentReceipt(p,tx,{confirmations:0}),/POLL_PARAMETERS_INVALID/);
});
test('site recovery reuses verified V3 deployment and never deploys the second contract',()=>{
 const script=fs.readFileSync(new URL('../scripts/release-v3-testnet-and-website.sh',import.meta.url),'utf8');
 const found=script.indexOf('if [[ -s "$proof" ]]');
 const skip=script.indexOf('V3_DEPLOYMENT_PROOF_FOUND_REVERIFY_ONLY_NO_REDEPLOY',found);
 const deploy=script.indexOf('node scripts/deploy-global-v3-testnet.mjs --deploy-old-testnet-deployer',found);
 const verify=script.lastIndexOf('node scripts/verify-v3-site-deployment.mjs --check');
 const install=script.lastIndexOf('bash scripts/launch-v3-site-after-deployment.sh --install');
 assert.ok(found>=0&&skip>found&&deploy>skip&&verify>deploy&&install>verify);
 assert.ok(script.includes('V3_INCOMPLETE_DEPLOYMENT_INTENT_RECONCILE_CHAIN_BEFORE_ANY_RETRY'));
 assert.ok(script.includes('--install-verified-site'));
});
