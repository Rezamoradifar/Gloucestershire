import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {id} from 'ethers';
import {validateLiveStatus,verifyCreditReceipts} from '../scripts/final-testnet-receipt-gate.mjs';

const script='ubuntu-final-testnet-e2e.sh', source=fs.readFileSync(script,'utf8');
const target='0x4C0F6141b18971db4b14e45c0bE8CddB09febc14', tx='0x'+'ab'.repeat(32), blockHash='0x'+'cd'.repeat(32);
const now=Date.now(),config={chainId:97,vaultAddress:target};
const status=()=>({chainId:97,vaultAddress:target,fresh:true,checkedAt:new Date(now).toISOString(),schedulerActive:true,status:'running',dailyStatus:'ready',blockers:[],lastCredit:{epoch:96,batches:[{transactionHash:tx,blockHash,block:100}]}});
const provider=()=>({getNetwork:async()=>({chainId:97n}),getBlockNumber:async()=>103,getBlock:async()=>({hash:blockHash}),getTransactionReceipt:async()=>({status:1,blockNumber:100,blockHash,logs:[{address:target,topics:[id('ProfitCredited(address,address,uint256,bytes32)')]}]})});

test('shell gate does not send transactions, and requires systemd and timer',()=>{
 assert.equal(spawnSync('bash',['-n',script],{encoding:'utf8'}).status,0);
 assert.match(source,/FINAL_TESTNET_SYSTEMD_UNAVAILABLE/);assert.match(source,/FINAL_TESTNET_TIMER_NOT_ACTIVE/);
 assert.doesNotMatch(source,/sendTransaction|eth_sendRawTransaction|eth_sendTransaction/);
 assert.match(source,/Manual public-chain smoke tests remain required/);
});
test('status gate rejects blockers, stale, indexing, inactive scheduler, and absent credit',()=>{
 const good=status();assert.equal(validateLiveStatus(config,good,target,now).length,1);
 for(const patch of [{blockers:['DAILY_MEMBER_INDEX_INCOMPLETE']},{blockers:null},{fresh:false},{checkedAt:new Date(now-900001).toISOString()},{dailyStatus:'indexing'},{schedulerActive:false},{lastCredit:null}]) {
  assert.throws(()=>validateLiveStatus(config,{...status(),...patch},target,now),/FINAL_TESTNET_/);
 }
 assert.throws(()=>validateLiveStatus({...config,chainId:56},good,target,now),/FINAL_TESTNET_CONFIG_IDENTITY_REQUIRED/);
});
test('receipt gate verifies chain, confirmations, canonical block and vault profit event',async()=>{
 const batches=validateLiveStatus(config,status(),target,now); await verifyCreditReceipts(provider(),batches,target);
 const bad=[{getNetwork:async()=>({chainId:56n})},{getBlockNumber:async()=>102},{getBlock:async()=>({hash:'0x'+'ef'.repeat(32)})},{getTransactionReceipt:async()=>null},{getTransactionReceipt:async()=>({status:0,blockNumber:100,blockHash,logs:[]})},{getTransactionReceipt:async()=>({status:1,blockNumber:100,blockHash,logs:[]})}];
 for(const patch of bad) await assert.rejects(verifyCreditReceipts({...provider(),...patch},batches,target),/FINAL_TESTNET_/);
});
