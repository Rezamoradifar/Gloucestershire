import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {parseEther} from 'ethers';
import {scanUnifiedAccrual} from '../scripts/scan-v3-unified-accrual.mjs';
import {openUnifiedJournal} from '../scripts/v3-unified-keeper-journal.mjs';
import {chooseUnifiedKeeperStep,planUnifiedKeeperCycle} from '../scripts/plan-v3-unified-keeper-cycle.mjs';

const address=n=>'0x'+n.toString(16).padStart(40,'0');
const hash=n=>'0x'+n.toString(16).padStart(64,'0');
const cursor=(member=0,position=0,lot=0)=>({member,position,lot});
const privateDir=()=>fs.mkdtempSync(path.join(os.tmpdir(),'unified-cycle-test-'));
const verified=plan=>({chainId:97,vault:address(11),block:{number:42,hash:hash(10)},
 transactionSent:false,siteUpdated:false,plan});

test('a cycle proposes only the first due candidate and never advances past the rest',async()=>{
 const vault={paused:async()=>false,memberCount:async()=>2n,memberAt:async i=>address(i+1),
  isEligible:async()=>true,positionCount:async()=>1n,reinvestmentPositionPlusOne:async()=>0n,
  positionOf:async()=>({principal:parseEther('100'),compoundedBasis:0n,lastAccruedAt:0n,fromReinvestment:false}),
  effectiveDailyBps:async()=>70n};
 const scan=await scanUnifiedAccrual({vault,book:{},blockNumber:42,blockTimestamp:3601,
  cursor:cursor(),maxWork:2,maxResults:2});
 assert.equal(scan.selected.length,2);
 assert.deepEqual(scan.next,cursor()); // full scan wrapped while both remain unpaid
 const step=chooseUnifiedKeeperStep(verified(scan),cursor());
 assert.equal(step.state,'ONE_CANDIDATE_REQUIRES_CONFIRMATION');
 assert.deepEqual(step.retryCursor,cursor());
 assert.deepEqual(step.suggestedCursorAfterVerifiedConfirmation,cursor(1));
 assert.equal(step.additionalCandidatesDeferred,1);
 assert.equal(step.cursorToPersist,null);
 assert.equal(step.cursorPersisted,false);assert.equal(step.transactionSent,false);
 assert.equal('suggestedScanCursor' in step,false);
});

test('an empty scan or pause cannot persist a cursor itself',()=>{
 const idle={paused:false,start:cursor(),next:cursor(1),selected:[],work:1,transactionSent:false};
 const proposed=chooseUnifiedKeeperStep(verified(idle),cursor());
 assert.equal(proposed.state,'NO_DUE_CANDIDATE');
 assert.deepEqual(proposed.suggestedScanCursor,cursor(1));
 assert.equal(proposed.cursorToPersist,null);assert.equal(proposed.requiresBlockRecheck,true);
 const stopped=chooseUnifiedKeeperStep(verified({...idle,paused:true,next:cursor(),work:0}),cursor());
 assert.equal(stopped.state,'PAUSED');assert.equal(stopped.cursorToPersist,null);
 assert.throws(()=>chooseUnifiedKeeperStep(verified({...idle,paused:true,next:cursor(1),work:0}),cursor()),/PAUSED/);
 assert.throws(()=>chooseUnifiedKeeperStep({...verified(idle),chainId:56},cursor()),/PREFLIGHT/);
 assert.throws(()=>chooseUnifiedKeeperStep(verified(idle),cursor(2)),/PREFLIGHT/);
});

test('every unresolved or previously confirmed journal stops before any RPC or rescan',async()=>{
 const dir=privateDir();let calls=0;
 const provider={send:async()=>{calls++;throw Error('RPC must not be queried');}};
 const record={status:'PREPARED',chainId:97,hash:hash(1),nonce:7};
 try{
  let journal=openUnifiedJournal(dir);journal.prepare(record);journal.close();
  for(const status of ['PREPARED','BROADCAST','CONFIRMED']){
   const step=await planUnifiedKeeperCycle({provider,proof:null,cursor:cursor(),journalDirectory:dir});
   assert.equal(step.state,'JOURNAL_REQUIRES_RECONCILIATION');assert.equal(step.journalStatus,status);
   assert.equal(step.cursorToPersist,null);assert.equal(step.transactionSent,false);
   if(status!=='CONFIRMED'){
    journal=openUnifiedJournal(dir);
    if(status==='PREPARED')journal.markBroadcast(record.hash);else journal.markConfirmed(record.hash);
    journal.close();
   }
  }
  assert.equal(calls,0);
  journal=openUnifiedJournal(dir);
  await assert.rejects(planUnifiedKeeperCycle({provider,proof:null,cursor:cursor(),journalDirectory:dir}),/LOCK_EXISTS/);
  journal.close();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
