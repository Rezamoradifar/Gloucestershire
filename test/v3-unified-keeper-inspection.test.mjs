import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {openUnifiedJournal} from '../scripts/v3-unified-keeper-journal.mjs';
import {inspectUnifiedKeeperJournal} from '../scripts/inspect-v3-unified-keeper.mjs';

const H=n=>'0x'+n.toString(16).padStart(64,'0');
const A=n=>'0x'+n.toString(16).padStart(40,'0');
const record={status:'PREPARED',chainId:97,hash:H(1),nonce:9,operator:A(1),vault:A(2),
 transactionData:'0x12345678',gasLimit:'100000',gasPrice:'1000000000'};
async function fixture(run){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'unified-inspect-test-'));
 try{
  const journal=openUnifiedJournal(dir);journal.prepare(record);journal.close();
  const original=fs.readFileSync(path.join(dir,'pending.json'),'utf8');
  const state={chain:'0x61',transaction:null,receipt:null,blockHash:H(7),height:'0x66'};
  const provider={getTransaction:async()=>state.transaction,getTransactionReceipt:async()=>state.receipt,
   send:async method=>method==='eth_chainId'?state.chain:method==='eth_blockNumber'?state.height:
    method==='eth_getBlockByNumber'?{number:'0x64',hash:state.blockHash}:assert.fail('Unexpected RPC method')};
  await run({dir,state,provider});
  assert.equal(fs.readFileSync(path.join(dir,'pending.json'),'utf8'),original);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
const transaction=()=>({hash:H(1),from:A(1),to:A(2),chainId:97n,nonce:9,value:0n,
 data:'0x12345678',gasLimit:100000n,gasPrice:1000000000n});

test('unobserved or pending transactions are never classified safe to retry',()=>fixture(async({dir,state,provider})=>{
 let r=await inspectUnifiedKeeperJournal({provider,journalDirectory:dir});
 assert.equal(r.state,'NOT_OBSERVED');assert.equal(r.safeToRetry,false);
 state.transaction=transaction();r=await inspectUnifiedKeeperJournal({provider,journalDirectory:dir});
 assert.equal(r.state,'TRANSACTION_OBSERVED_NO_RECEIPT');assert.equal(r.verificationComplete,false);
 state.transaction.data='0xaabbccdd';r=await inspectUnifiedKeeperJournal({provider,journalDirectory:dir});
 assert.equal(r.state,'TRANSACTION_MISMATCH_REVIEW');assert.equal(r.safeToRetry,false);
}));
test('observed canonical and reorganized receipts both require manual review',()=>fixture(async({dir,state,provider})=>{
 state.transaction=transaction();state.receipt={hash:H(1),blockNumber:100,blockHash:H(7),status:1};
 let r=await inspectUnifiedKeeperJournal({provider,journalDirectory:dir});
 assert.equal(r.state,'RECEIPT_OBSERVED_REVIEW_REQUIRED');assert.equal(r.canonicalBlock,true);
 assert.equal(r.confirmations,3);assert.equal(r.safeToRetry,false);assert.equal(r.verificationComplete,false);
 state.blockHash=H(8);r=await inspectUnifiedKeeperJournal({provider,journalDirectory:dir});
 assert.equal(r.canonicalBlock,false);assert.equal(r.safeToRetry,false);
 state.chain='0x38';await assert.rejects(inspectUnifiedKeeperJournal({provider,journalDirectory:dir}),/TESTNET_CHAIN/);
}));
test('an old journal without calldata remains blocked for manual review',()=>fixture(async({dir,provider})=>{
 const file=path.join(dir,'pending.json'),old=JSON.parse(fs.readFileSync(file,'utf8'));
 delete old.transactionData;fs.writeFileSync(file,JSON.stringify(old)+'\n');
 const r=await inspectUnifiedKeeperJournal({provider,journalDirectory:dir});
 assert.equal(r.state,'LEGACY_RECORD_REQUIRES_MANUAL_REVIEW');assert.equal(r.safeToRetry,false);
 // Restore the fixture record to independently verify diagnostic immutability.
 fs.writeFileSync(file,JSON.stringify(record)+'\n');
}));
