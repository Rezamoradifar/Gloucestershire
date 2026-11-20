import assert from 'node:assert/strict';
import test from 'node:test';
import {Interface,Transaction,Wallet,getAddress} from 'ethers';
import {inspectUnifiedSignedAccrual,resumeUnifiedSignedAccrual} from '../scripts/resume-v3-unified-accrual.mjs';

const address=n=>getAddress('0x'+n.toString(16).padStart(40,'0'));
const methods=new Interface(['function accrueDaily(address,uint256)',
 'function accrueReinvestmentPage(address,uint256,uint256)']);
async function fixture(overrides={}){
 const signer=Wallet.createRandom(),member=address(1),vault=address(2);
 const request={chainId:97,type:0,nonce:3,to:vault,value:0n,
  data:methods.encodeFunctionData('accrueReinvestmentPage',[member,8,8]),
  gasLimit:150000n,gasPrice:1000000000n,...overrides};
 const rawTransaction=await signer.signTransaction(request),tx=Transaction.from(rawTransaction);
 const record={status:'PREPARED',chainId:97,hash:tx.hash,nonce:request.nonce,operator:signer.address,
  vault,member,positionId:0,method:'accrueReinvestmentPage',transactionData:request.data,
  rawTransaction,gasLimit:request.gasLimit.toString(),gasPrice:request.gasPrice?.toString(),
  retryCursor:{member:1,position:0,lot:8}};
 return {record,operator:signer.address,proof:{vault},tx};
}

test('signed recovery binds the exact hash, sender, network, method, page and gas envelope',async()=>{
 const f=await fixture();
 const inspected=inspectUnifiedSignedAccrual(f.record,f.operator,f.proof.vault);
 assert.equal(inspected.tx.hash,f.record.hash);
 assert.deepEqual(inspected.candidate.args,[f.record.member,8,8]);
 const ordinary=await fixture({data:methods.encodeFunctionData('accrueDaily',[address(1),0])});
 const ordinaryRecord={...ordinary.record,method:'accrueDaily',retryCursor:{member:1,position:0,lot:0}};
 assert.deepEqual(inspectUnifiedSignedAccrual(ordinaryRecord,ordinary.operator,ordinary.proof.vault).candidate.args,
  [address(1),0]);
 for(const changed of [
  {hash:'0x'+'11'.repeat(32)},{nonce:4},{operator:address(7)},{vault:address(7)},
  {member:address(7)},{method:'accrueDaily'},{positionId:1},
  {retryCursor:{member:1,position:0,lot:9}},{transactionData:f.record.transactionData+'00'},
  {gasLimit:'150001'},{gasPrice:'2'},{rawTransaction:f.record.rawTransaction.slice(0,-2)},
  {rawTransaction:undefined}
 ])assert.throws(()=>inspectUnifiedSignedAccrual({...f.record,...changed},f.operator,f.proof.vault),/SIGNED_JOURNAL_MISMATCH/);
 for(const request of [
  {chainId:56},{value:1n},{to:address(7)},{gasLimit:1500001n},{gasLimit:0n},
  {gasPrice:100000000001n},{gasPrice:0n},{gasLimit:1500000n,gasPrice:100000000000n},
  {data:methods.encodeFunctionData('accrueReinvestmentPage',[address(1),8,9])},
  {data:methods.encodeFunctionData('accrueDaily',[address(1),0])}
 ]){
  const candidate=await fixture(request);
  assert.throws(()=>inspectUnifiedSignedAccrual(candidate.record,candidate.operator,candidate.proof.vault),/SIGNED_JOURNAL_MISMATCH/);
 }
});

test('legacy and confirmed journals never cause a recovery RPC or signature',async()=>{
 const f=await fixture();
 const unavailable=new Proxy({}, {get(){throw Error('RPC must not be called');}});
 for(const record of [{...f.record,rawTransaction:undefined},{...f.record,status:'CONFIRMED'}])
  assert.deepEqual(await resumeUnifiedSignedAccrual({...f,record,provider:unavailable}),{transactionSent:false});
});

test('an observed transaction, any receipt, a consumed nonce or a different pending nonce never rebroadcasts',async()=>{
 const f=await fixture();
 for(const variant of ['transaction','receipt','reverted','latest','pending','chain']){
  let sends=0;
  const provider={
   getTransactionReceipt:async()=>variant==='receipt'?{status:1}:variant==='reverted'?{status:0}:null,
   getTransaction:async()=>variant==='transaction'?f.tx:null,
   getTransactionCount:async(_,tag)=>variant===tag?4:3,
   send:async()=>variant==='chain'?'0x38':'0x61',
   broadcastTransaction:async()=>{sends++;throw Error('must not broadcast');}
  };
  const run=()=>resumeUnifiedSignedAccrual({...f,provider});
  if(['latest','pending','chain'].includes(variant))await assert.rejects(run(),/NEEDS_REVIEW|CHAIN_REQUIRED/);
  else assert.deepEqual(await run(),{transactionSent:false});
  assert.equal(sends,0);
 }
});

test('an interrupted receipt read leaves the saved transaction untouched',async()=>{
 const f=await fixture(),before=JSON.stringify(f.record);
 const provider={getTransactionReceipt:async()=>{throw Error('RPC_TIMEOUT');},getTransaction:async()=>null,
  getTransactionCount:async()=>3,send:async()=>'0x61',
  broadcastTransaction:async()=>{throw Error('must not broadcast');}};
 await assert.rejects(resumeUnifiedSignedAccrual({...f,provider}),/RPC_TIMEOUT/);
 assert.equal(JSON.stringify(f.record),before);
});
