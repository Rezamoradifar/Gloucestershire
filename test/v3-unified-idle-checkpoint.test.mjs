import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {getAddress,keccak256} from 'ethers';
import {checkpointUnifiedIdleScan} from '../scripts/checkpoint-v3-unified-idle-scan.mjs';
import {openUnifiedJournal} from '../scripts/v3-unified-keeper-journal.mjs';

const A=n=>getAddress('0x'+n.toString(16).padStart(40,'0'));
const H=n=>'0x'+n.toString(16).padStart(64,'0');
const TOKEN=getAddress('0x000Cdf5F6E3B4761721a5F76205bAE6c8523Ab89');
const FEE1=getAddress('0x7037cc199499d7a3431285a01e435454eae51265');
const FEE2=getAddress('0x5bc282a45a8a1d7d9b915f04fc1d4031156d7632');
const OPERATIONS=getAddress('0x8c4ac9b009808a0b49ba77b58e3871e7cdba463c');
const cursor=(member=0,position=0,lot=0)=>({member,position,lot});

function fixture(){
 const state={hash:H(99),changedAt:Infinity,blocks:0,due:false,paused:false,rpcCalls:0};
 const codes={[A(1)]:'0x6001',[A(2)]:'0x6002',[A(3)]:'0x6003',[TOKEN]:'0x60'};
 const proof={status:'VERIFIED_UNIFIED_TESTNET_ONLY',chainId:97,vault:A(1),book:A(2),network:A(3),
  token:TOKEN,manager:A(4),feeReceiver:A(5),deploymentBlock:100,deploymentTx:H(15),
  vaultRuntimeHash:keccak256(codes[A(1)]),bookRuntimeHash:keccak256(codes[A(2)]),networkRuntimeHash:keccak256(codes[A(3)])};
 const at=o=>assert.deepEqual(o,{blockTag:118});
 const parent={
  asset:async o=>{at(o);return TOKEN;},feeReceiver:async o=>{at(o);return A(5);},
  reinvestmentBook:async o=>{at(o);return A(2);},networkPlan:async o=>{at(o);return A(3);},
  ACCRUAL_PERIOD:async o=>{at(o);return 3600n;},ONE_DAY:async o=>{at(o);return 86400n;},
  FEE_WALLET_1:async o=>{at(o);return FEE1;},FEE_WALLET_2:async o=>{at(o);return FEE2;},
  OPERATIONS_WALLET:async o=>{at(o);return OPERATIONS;},DEPOSIT_FEE_EACH_BPS:async o=>{at(o);return 1000n;},
  MANAGER_ROLE:async o=>{at(o);return H(7);},hasRole:async(_r,_a,o)=>{at(o);return true;},
  paused:async o=>{at(o);return state.paused;},memberCount:async o=>{at(o);return 2n;},
  memberAt:async(i,o)=>{at(o);return A(6+Number(i));},isEligible:async(_who,o)=>{at(o);return state.due;},
  positionCount:async(_who,o)=>{at(o);return 1n;},reinvestmentPositionPlusOne:async(_who,o)=>{at(o);return 0n;},
  effectiveDailyBps:async(_who,o)=>{at(o);return 70n;},positionOf:async(_who,_id,o)=>{
   at(o);return {principal:1000000000000000000n,compoundedBasis:0n,lastAccruedAt:0n,fromReinvestment:false};
  }
 };
 const provider={
  send:async(name,args)=>{state.rpcCalls++;
   if(name==='eth_chainId')return '0x61';
   assert.equal(name,'eth_getBlockByNumber');
   if(args[0]==='0x64')return {number:'0x64',hash:H(77),timestamp:'0x300'};
   assert.equal(args[0],'0x76');state.blocks++;
   return {number:'0x76',hash:state.blocks>=state.changedAt?H(100):state.hash,timestamp:'0x1389'};
  },
  getBlockNumber:async()=>120,
  getTransactionReceipt:async()=>({status:1,contractAddress:A(1),blockNumber:100,blockHash:H(77),hash:H(15)}),
  getCode:async address=>codes[address]??'0x'
 };
 const makeContract=address=>address===A(1)?parent:{vault:async o=>{at(o);return A(1);}};
 return {state,proof,provider,makeContract};
}

const dir=()=>fs.mkdtempSync(path.join(os.tmpdir(),'unified-idle-checkpoint-'));
const run=(f,d,overrides={})=>checkpointUnifiedIdleScan({provider:f.provider,proof:f.proof,operator:A(8),
 journalDirectory:d,maxWork:1,makeContract:f.makeContract,...overrides});

test('only an idle verified scan checkpoints, and restarts continue from its cursor',async()=>{
 const d=dir(),f=fixture();
 try{
  const first=await run(f,d);
  assert.equal(first.state,'IDLE_CHECKPOINT_RECORDED');assert.deepEqual(first.cursor,cursor(1));
  assert.equal(first.transactionSent,false);assert.equal(first.cursorPersisted,true);
  const filename=path.join(d,'idle-checkpoint.json');
  assert.equal(fs.statSync(filename).mode&0o077,0);
  const second=await run(f,d);
  assert.equal(second.state,'IDLE_CHECKPOINT_RECORDED');assert.deepEqual(second.cursor,cursor());
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});

test('a due candidate or pause leaves the previous cursor untouched',async()=>{
 const d=dir(),f=fixture();
 try{
  await run(f,d);const filename=path.join(d,'idle-checkpoint.json'),before=fs.readFileSync(filename,'utf8');
  f.state.due=true;
  const candidate=await run(f,d);
  assert.equal(candidate.state,'ONE_CANDIDATE_REQUIRES_CONFIRMATION');
  assert.equal(candidate.cursorPersisted,false);assert.equal(candidate.cursorToPersist,null);
  assert.equal(fs.readFileSync(filename,'utf8'),before);
  f.state.paused=true;
  const paused=await run(f,d);assert.equal(paused.state,'PAUSED');
  assert.equal(fs.readFileSync(filename,'utf8'),before);
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});

test('existing journal records block any scan or checkpoint, including confirmed receipts',async()=>{
 const d=dir(),f=fixture(),record={status:'PREPARED',chainId:97,hash:H(9),nonce:0};
 try{
  const journal=openUnifiedJournal(d);journal.prepare(record);journal.markBroadcast(record.hash);journal.markConfirmed(record.hash);journal.close();
  const result=await run(f,d);
  assert.equal(result.state,'JOURNAL_REQUIRES_RECONCILIATION');assert.equal(result.journalStatus,'CONFIRMED');
  assert.equal(f.state.rpcCalls,0);assert.equal(fs.existsSync(path.join(d,'idle-checkpoint.json')),false);
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});

test('identity mismatch, nonprivate file, or reorganized anchor stops without writing',async()=>{
 const d=dir(),f=fixture();
 try{
  await run(f,d);const filename=path.join(d,'idle-checkpoint.json'),before=fs.readFileSync(filename,'utf8');
  await assert.rejects(run(f,d,{operator:A(9)}),/IDENTITY_MISMATCH/);
  await assert.rejects(run(f,d,{proof:{...f.proof,networkRuntimeHash:H(6)}}),/IDENTITY_MISMATCH/);
  f.state.hash=H(100);
  await assert.rejects(run(f,d),/BLOCK_CHANGED/);
  f.state.hash=H(99);fs.chmodSync(filename,0o644);
  await assert.rejects(run(f,d),/NOT_PRIVATE/);fs.chmodSync(filename,0o600);
  assert.equal(fs.readFileSync(filename,'utf8'),before);
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});

test('reorganization before an idle checkpoint and failed atomic rename retain prior state',async()=>{
 const d=dir(),f=fixture();
 try{
  f.state.changedAt=4;
  await assert.rejects(run(f,d),/BLOCK_CHANGED/);
  const filename=path.join(d,'idle-checkpoint.json');assert.equal(fs.existsSync(filename),false);
  f.state.changedAt=Infinity;f.state.blocks=0;await run(f,d);
  const before=fs.readFileSync(filename,'utf8');
  const original=fs.renameSync;
  try{fs.renameSync=()=>{throw Error('simulated disk failure');};await assert.rejects(run(f,d),/simulated disk failure/);}
  finally{fs.renameSync=original;}
  assert.equal(fs.readFileSync(filename,'utf8'),before);
  assert.equal(fs.readdirSync(d).some(name=>name.startsWith('.idle-checkpoint-')),false);
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});
