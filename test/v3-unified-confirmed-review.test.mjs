import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {Interface,getAddress,keccak256} from 'ethers';
import {openUnifiedJournal} from '../scripts/v3-unified-keeper-journal.mjs';
import {reviewUnifiedConfirmedJournal} from '../scripts/review-v3-unified-confirmed.mjs';
import {recordUnifiedRecoveryObservation} from '../scripts/record-v3-unified-recovery-observation.mjs';

const address=n=>getAddress('0x'+n.toString(16).padStart(40,'0'));
const hash=n=>'0x'+n.toString(16).padStart(64,'0');
const methods=new Interface(['function accrueDaily(address,uint256)',
 'function accrueReinvestmentPage(address,uint256,uint256)']);
const operator=address(1),member=address(2),vault=address(3);
const valid={status:'PREPARED',chainId:97,hash:hash(1),nonce:3,operator,vault,member,
 positionId:4,method:'accrueDaily',transactionData:methods.encodeFunctionData('accrueDaily',[member,4]),
 gasLimit:'100000',gasPrice:'3',retryCursor:{member:0,position:4,lot:0}};
const unavailable={send:async()=>{throw Error('RPC must not be called');}};
async function withRecord(record,fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'unified-review-test-'));
 try{
  if(record){const journal=openUnifiedJournal(dir);journal.prepare(record);journal.close();}
  await fn(dir);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('no journal reports no work and never claims that a retry is safe',()=>withRecord(null,async journalDirectory=>{
 const result=await reviewUnifiedConfirmedJournal({provider:unavailable,proof:null,operator,journalDirectory});
 assert.equal(result.state,'NO_JOURNAL');assert.equal(result.safeToRetry,false);
 assert.equal(result.cursorPersisted,false);assert.equal(result.transactionSent,false);
}));
test('malformed transaction, cursor or operator is rejected without RPC and without modifying the record',async()=>{
 const cases=[
  [{...valid,method:'transfer'},/REVIEW_TRANSACTION/],
  [{...valid,retryCursor:{member:0,position:5,lot:0}},/REVIEW_CURSOR/],
  [{...valid,retryCursor:{member:0,position:4,lot:1}},/REVIEW_TRANSACTION/],
  [{...valid,transactionData:methods.encodeFunctionData('accrueDaily',[address(4),4])},/REVIEW_TRANSACTION/],
  [{...valid,transactionData:valid.transactionData+'00'},/REVIEW_TRANSACTION/],
  [{...valid,method:'accrueReinvestmentPage',transactionData:methods.encodeFunctionData('accrueReinvestmentPage',[member,0,9])},/REVIEW_TRANSACTION/],
  [{...valid,gasLimit:'0'},/REVIEW_TRANSACTION/],
  [{...valid,operator:address(4)},/OPERATOR_MISMATCH/]
 ];
 for(const [record,error] of cases)await withRecord(record,async journalDirectory=>{
  const file=path.join(journalDirectory,'pending.json'),before=fs.readFileSync(file,'utf8');
  await assert.rejects(reviewUnifiedConfirmedJournal({provider:unavailable,proof:null,operator,journalDirectory}),error);
  assert.equal(fs.readFileSync(file,'utf8'),before);
 });
});

function confirmedFixture(){
 const a=address, h=hash, token=getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89');
 const code=['0x6001','0x6002','0x6003'];
 const proof={status:'VERIFIED_UNIFIED_TESTNET_ONLY',chainId:97,vault:a(11),book:a(12),network:a(13),
  token,manager:a(14),feeReceiver:a(15),deploymentBlock:100,deploymentTx:h(1000),
  vaultRuntimeHash:keccak256(code[0]),bookRuntimeHash:keccak256(code[1]),networkRuntimeHash:keccak256(code[2])};
 const eventAbi=new Interface(['event DailyClaimAccrued(address indexed user,uint256 indexed positionId,uint256 personal,uint256 compounded,uint256 total,uint256 at)']);
 const encoded=eventAbi.encodeEventLog(eventAbi.getEvent('DailyClaimAccrued'),[member,4,2,3,5,1000]);
 const log={address:proof.vault,topics:encoded.topics,data:encoded.data};
 const data=methods.encodeFunctionData('accrueReinvestmentPage',[member,0,8]);
 const record={...valid,vault:proof.vault,method:'accrueReinvestmentPage',transactionData:data};
 const state={receiptMissing:false,memberMismatch:false,receiptReorg:false,tooRecent:false};
 const receipt={hash:record.hash,status:1,blockNumber:110,blockHash:h(110),logs:[log]};
 const raw={transactionHash:record.hash,status:'0x1',blockNumber:'0x6e',blockHash:h(110),logs:[log]};
 const tx={hash:record.hash,from:operator,to:proof.vault,chainId:97n,nonce:3,value:0n,data,gasLimit:100000n,gasPrice:3n};
 const provider={getBlockNumber:async()=>120,getTransaction:async()=>tx,
  getTransactionReceipt:async hsh=>hsh===proof.deploymentTx?
   {status:1,contractAddress:proof.vault,blockNumber:100,blockHash:h(100),hash:proof.deploymentTx}:
   state.receiptMissing?null:{...receipt,blockNumber:state.tooRecent?119:110},
  getCode:async account=>({[proof.vault]:code[0],[proof.book]:code[1],[proof.network]:code[2],[token]:'0x60'})[account]||'0x',
  send:async(method,args)=>{
   if(method==='eth_chainId')return '0x61';
   if(method==='eth_blockNumber')return '0x78';
   if(method==='eth_getTransactionReceipt')return {...raw,blockHash:state.receiptReorg?h(111):h(110)};
   if(method==='eth_getBlockByNumber'){
    const n=Number(BigInt(args[0]));return {number:args[0],hash:h(n),timestamp:'0x3e8'};
   }
   throw Error('UNEXPECTED_RPC');
  }};
 const parent={asset:async()=>token,feeReceiver:async()=>proof.feeReceiver,reinvestmentBook:async()=>proof.book,
  networkPlan:async()=>proof.network,ACCRUAL_PERIOD:async()=>3600n,ONE_DAY:async()=>86400n,
  FEE_WALLET_1:async()=>getAddress('0x7037cc199499d7a3431285a01e435454eae51265'),
  FEE_WALLET_2:async()=>getAddress('0x5bc282a45a8a1d7d9b915f04fc1d4031156d7632'),
  OPERATIONS_WALLET:async()=>getAddress('0x8c4ac9b009808a0b49ba77b58e3871e7cdba463c'),
  DEPOSIT_FEE_EACH_BPS:async()=>1000n,MANAGER_ROLE:async()=>h(2),hasRole:async()=>true,
  memberCount:async()=>1n,memberAt:async()=>state.memberMismatch?a(20):member,
  positionCount:async()=>5n,reinvestmentPositionPlusOne:async()=>5n,
  positionOf:async()=>({fromReinvestment:true})};
 const makeContract=addr=>addr===proof.vault?parent:{vault:async()=>proof.vault,position:async()=>({lots:8n})};
 return {proof,record,state,provider,makeContract};
}
test('canonical receipt review proposes only the retry cursor without changing the journal',async()=>{
 const f=confirmedFixture();
 await withRecord(f.record,async journalDirectory=>{
  const file=path.join(journalDirectory,'pending.json'),before=fs.readFileSync(file,'utf8');
  const call=()=>reviewUnifiedConfirmedJournal({provider:f.provider,proof:f.proof,operator,journalDirectory,makeContract:f.makeContract});
  let result=await call();
  assert.equal(result.state,'CONFIRMED_REQUIRES_RECONCILIATION');
  assert.deepEqual(result.retryCursor,{member:0,position:4,lot:0});
  assert.equal(result.safeToRetry,false);assert.equal(result.cursorPersisted,false);
  assert.equal(fs.readFileSync(file,'utf8'),before);
  f.state.receiptMissing=true;result=await call();assert.equal(result.state,'RECEIPT_NOT_OBSERVED');assert.equal(result.safeToRetry,false);
  f.state.receiptMissing=false;f.state.tooRecent=true;result=await call();assert.equal(result.state,'AWAITING_CONFIRMED_STATE');
  f.state.tooRecent=false;f.state.memberMismatch=true;await assert.rejects(call(),/CURSOR_MISMATCH/);
  f.state.memberMismatch=false;f.state.receiptReorg=true;await assert.rejects(call(),/CANONICALITY_MISMATCH/);
  assert.equal(fs.readFileSync(file,'utf8'),before);
 });
});

test('durable recovery observation never clears journal, advances cursor or authorizes retry',async()=>{
 const f=confirmedFixture();
 await withRecord(f.record,async journalDirectory=>{
  const pending=path.join(journalDirectory,'pending.json'),file=path.join(journalDirectory,'recovery-observation.json');
  const before=fs.readFileSync(pending,'utf8');
  const options={provider:f.provider,proof:f.proof,operator,journalDirectory,makeContract:f.makeContract};
  await assert.rejects(recordUnifiedRecoveryObservation(options),/DISABLED/);
  assert.equal(fs.existsSync(file),false);
  f.state.receiptMissing=true;
  const missing=await recordUnifiedRecoveryObservation({...options,enabled:true});
  assert.equal(missing.state,'RECEIPT_NOT_OBSERVED');assert.equal(fs.existsSync(file),false);
  f.state.receiptMissing=false;
  const saved=await recordUnifiedRecoveryObservation({...options,enabled:true});
  assert.equal(saved.state,'CONFIRMED_OBSERVATION_RECORDED');
  assert.equal(saved.safeToRetry,false);assert.equal(saved.cursorPersisted,false);
  assert.equal(saved.journalCleared,false);assert.equal(saved.transactionSent,false);
  assert.deepEqual(saved.retryCursor,{member:0,position:4,lot:0});
  assert.deepEqual(saved.receiptAnchor,{number:110,hash:hash(110)});
  assert.equal(fs.readFileSync(pending,'utf8'),before);
  assert.equal(fs.statSync(file).mode&0o077,0);
  const stored=fs.readFileSync(file,'utf8');
  const second=await recordUnifiedRecoveryObservation({...options,enabled:true});
  assert.equal(second.state,saved.state);assert.equal(fs.readFileSync(file,'utf8'),stored);
  const altered=JSON.parse(stored);altered.retryCursor.lot++;
  fs.writeFileSync(file,JSON.stringify(altered)+'\n');
  await assert.rejects(recordUnifiedRecoveryObservation({...options,enabled:true}),/OBSERVATION_MISMATCH/);
  assert.equal(fs.readFileSync(pending,'utf8'),before);
  fs.writeFileSync(file,stored);
  const send=f.provider.send;
  try{
   f.provider.send=async(name,args)=>name==='eth_getBlockByNumber'&&args[0]==='0x6e'?
    {number:'0x6e',hash:hash(111),timestamp:'0x3e8'}:send(name,args);
   await assert.rejects(recordUnifiedRecoveryObservation({...options,enabled:true}),/BLOCK_CHANGED/);
  }finally{f.provider.send=send;}
  assert.equal(fs.readFileSync(file,'utf8'),stored);assert.equal(fs.readFileSync(pending,'utf8'),before);
  fs.chmodSync(file,0o644);
  await assert.rejects(recordUnifiedRecoveryObservation({...options,enabled:true}),/NOT_PRIVATE/);
 });
});

test('failed observation rename leaves journal and previous observation intact',async()=>{
 const f=confirmedFixture();
 await withRecord(f.record,async journalDirectory=>{
  const options={provider:f.provider,proof:f.proof,operator,journalDirectory,makeContract:f.makeContract,enabled:true};
  await recordUnifiedRecoveryObservation(options);
  const file=path.join(journalDirectory,'recovery-observation.json'),pending=path.join(journalDirectory,'pending.json');
  const previous=fs.readFileSync(file,'utf8'),journalBefore=fs.readFileSync(pending,'utf8');
  const rename=fs.renameSync;
  try{fs.renameSync=()=>{throw Error('simulated disk failure');};await assert.rejects(recordUnifiedRecoveryObservation(options),/simulated disk failure/);}
  finally{fs.renameSync=rename;}
  assert.equal(fs.readFileSync(file,'utf8'),previous);assert.equal(fs.readFileSync(pending,'utf8'),journalBefore);
  assert.equal(fs.readdirSync(journalDirectory).some(name=>name.startsWith('.recovery-observation-')),false);
 });
});
