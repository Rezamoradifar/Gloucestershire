// A cycle handles at most one accrual. An interrupted broadcast can resume only
// its saved signed bytes; every canonical receipt still requires reconciliation.
import path from 'node:path';
import {getAddress,Wallet} from 'ethers';
import {openUnifiedJournal} from './v3-unified-keeper-journal.mjs';
import {reviewUnifiedConfirmedRecord} from './review-v3-unified-confirmed.mjs';
import {validateUnifiedProof,recheckUnifiedBlock} from './verify-v3-unified-deployment.mjs';
import {executeWithKeeperLock} from './execute-v3-unified-keeper.mjs';
import {resumeUnifiedSignedAccrual} from './resume-v3-unified-accrual.mjs';
import {atomicWrite,checkpointIdentity,readCheckpoint,scanWithKeeperLock} from './checkpoint-v3-unified-idle-scan.mjs';

async function reconcile(options,transactionSent){
 const {provider,proof,who,journal,journalDirectory,proofIdentity,makeContract,waitReceipt}=options;
 const record=journal.read();
 const filename=path.join(journalDirectory,'idle-checkpoint.json');
 const previous=readCheckpoint(filename,proofIdentity,who);
 if(previous)await recheckUnifiedBlock(provider,previous.anchor);
 let result=await reviewUnifiedConfirmedRecord({provider,proof,operator:who,record,makeContract});
 if(result.state==='RECEIPT_NOT_OBSERVED'&&!transactionSent){
  const resumed=await resumeUnifiedSignedAccrual({provider,proof,operator:who,record,journal,waitReceipt,makeContract});
  if(resumed.transactionSent){
   transactionSent=true;
   result=await reviewUnifiedConfirmedRecord({provider,proof,operator:who,record:journal.read(),makeContract});
  }
 }
 if(result.state!=='CONFIRMED_REQUIRES_RECONCILIATION')
  return {...result,hash:record.hash,transactionSent};

 const hash=result.hash.toLowerCase();
 const lastAccrual=previous?.lastAccrual;
 if(lastAccrual&&(record.nonce<lastAccrual.nonce||
    (record.nonce===lastAccrual.nonce&&hash!==lastAccrual.hash)))
  throw Error('UNIFIED_RECOVERY_NONCE_MISMATCH');
 if(previous&&previous.anchor.number>result.anchor.number)throw Error('UNIFIED_CHECKPOINT_FUTURE_BLOCK');
 if(previous)await recheckUnifiedBlock(provider,previous.anchor);
 await recheckUnifiedBlock(provider,result.receiptAnchor);
 await recheckUnifiedBlock(provider,result.anchor);
 if(record.status!=='CONFIRMED')journal.markConfirmed(record.hash);
 // Use the position independently matched to the receipt. An interrupted
 // process must rescan this spot rather than trusting a saved nextCursor.
 const checkpoint={
  version:1,chainId:97,identity:proofIdentity,operator:who,cursor:result.retryCursor,
  anchor:{number:result.anchor.number,hash:result.anchor.hash.toLowerCase()},
  lastAccrual:{hash,nonce:record.nonce}
 };
 atomicWrite(journalDirectory,filename,checkpoint);
 // The file and directory have both been fsynced. A crash before this final
 // rename leaves the same hash pending and recovery repeats under the lock.
 journal.archiveConfirmed(record.hash);
 return {state:'CONFIRMED_CHECKPOINT_RECORDED',chainId:97,hash,cursor:checkpoint.cursor,
  anchor:checkpoint.anchor,transactionSent,cursorPersisted:true};
}

export async function runUnifiedKeeperCycle({provider,signer,proof:raw,journalDirectory,
 maxWork=20,lotPageSize=8,waitReceipt,makeContract}){
 if(!(signer instanceof Wallet)||signer.provider!==provider)throw Error('UNIFIED_LOCAL_GAS_WALLET_REQUIRED');
 if(!Number.isSafeInteger(maxWork)||maxWork<1||maxWork>20||
    !Number.isSafeInteger(lotPageSize)||lotPageSize<1||lotPageSize>8)throw Error('INVALID_UNIFIED_IDLE_SCAN_LIMIT');
 const proof=validateUnifiedProof(raw),who=getAddress(signer.address);
 const journal=openUnifiedJournal(journalDirectory);
 try{
  const options={provider,proof,who,journal,journalDirectory,proofIdentity:checkpointIdentity(proof),
   maxWork,lotPageSize,makeContract,waitReceipt};
  if(journal.read())return await reconcile(options,false);
  const step=await scanWithKeeperLock(options);
  if(step.state!=='ONE_CANDIDATE_REQUIRES_CONFIRMATION')return step;
  await executeWithKeeperLock({provider,signer,proof,candidate:step.candidate,journal,waitReceipt});
  return await reconcile(options,true);
 }finally{journal.close();}
}
