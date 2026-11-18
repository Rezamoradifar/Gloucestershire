// EXPERIMENTAL: durable evidence for a confirmed testnet accrual, not a
// scheduler or recovery authorization. The pending journal is never cleared,
// no cursor is advanced, and no transaction can be signed or broadcast.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {getAddress,isAddress,keccak256,toUtf8Bytes,ZeroAddress} from 'ethers';
import {openUnifiedJournal} from './v3-unified-keeper-journal.mjs';
import {reviewUnifiedConfirmedRecord} from './review-v3-unified-confirmed.mjs';
import {validateUnifiedProof,recheckUnifiedBlock} from './verify-v3-unified-deployment.mjs';

const hash=/^0x[0-9a-fA-F]{64}$/;
const index=value=>Number.isSafeInteger(value)&&value>=0;
const validCursor=value=>value&&['member','position','lot'].every(key=>index(value[key]));
const validAnchor=value=>value&&index(value.number)&&value.number>0&&hash.test(String(value.hash));
const digest=value=>keccak256(toUtf8Bytes(JSON.stringify(value)));
const identity=proof=>digest([proof.chainId,proof.vault,proof.book,proof.network,proof.token,
 proof.manager,proof.feeReceiver,proof.deploymentBlock,proof.deploymentTx,
 proof.vaultRuntimeHash,proof.bookRuntimeHash,proof.networkRuntimeHash]);
const syncDirectory=directory=>{const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};

function readObservation(filename,proofId,operator,recordDigest){
 let stat;
 try{stat=fs.lstatSync(filename);}catch(error){if(error?.code==='ENOENT')return null;throw error;}
 if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0||stat.size>4096)
  throw Error('UNIFIED_RECOVERY_OBSERVATION_NOT_PRIVATE');
 const value=JSON.parse(fs.readFileSync(filename,'utf8'));
 if(!value||value.version!==1||value.chainId!==97||value.proofIdentity!==proofId||value.operator!==operator||
    value.recordDigest!==recordDigest||!hash.test(String(value.transactionHash))||!validCursor(value.retryCursor)||
    !validAnchor(value.anchor)||!validAnchor(value.receiptAnchor)||value.receiptAnchor.number>value.anchor.number)
  throw Error('UNIFIED_RECOVERY_OBSERVATION_MISMATCH');
 return value;
}
function writeObservation(directory,filename,value){
 const temporary=path.join(directory,'.recovery-observation-'+randomBytes(12).toString('hex'));let fd;
 try{
  fd=fs.openSync(temporary,'wx',0o600);
  fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  fs.renameSync(temporary,filename);syncDirectory(directory);
 }finally{
  if(fd!==undefined)fs.closeSync(fd);
  try{fs.unlinkSync(temporary);}catch(error){if(error?.code!=='ENOENT')throw error;}
 }
}

export async function recordUnifiedRecoveryObservation({provider,proof:raw,operator,journalDirectory,
 enabled=false,makeContract}){
 if(enabled!==true)throw Error('UNIFIED_RECOVERY_OBSERVATION_DISABLED');
 if(!isAddress(operator)||getAddress(operator)===ZeroAddress)throw Error('INVALID_UNIFIED_RECOVERY_OPERATOR');
 const who=getAddress(operator),proof=validateUnifiedProof(raw),proofId=identity(proof);
 const journal=openUnifiedJournal(journalDirectory);
 try{
  const record=journal.read();
  if(!record)return {state:'NO_JOURNAL',transactionSent:false,safeToRetry:false,cursorPersisted:false};
  const recordDigest=digest(record),filename=path.join(journalDirectory,'recovery-observation.json');
  const prior=readObservation(filename,proofId,who,recordDigest);
  if(prior){await recheckUnifiedBlock(provider,prior.anchor);await recheckUnifiedBlock(provider,prior.receiptAnchor);}
  const reviewed=await reviewUnifiedConfirmedRecord({provider,proof,operator:who,record,makeContract});
  if(reviewed.state!=='CONFIRMED_REQUIRES_RECONCILIATION')return reviewed;
  if(!validAnchor(reviewed.anchor)||!validAnchor(reviewed.receiptAnchor)||
     reviewed.receiptAnchor.number>reviewed.anchor.number||!validCursor(reviewed.retryCursor))
   throw Error('UNIFIED_RECOVERY_REVIEW_INVALID');
  if(prior&&(reviewed.anchor.number<prior.anchor.number||reviewed.hash.toLowerCase()!==prior.transactionHash.toLowerCase()||
    reviewed.receiptAnchor.number!==prior.receiptAnchor.number||
    reviewed.receiptAnchor.hash.toLowerCase()!==prior.receiptAnchor.hash.toLowerCase()||
    ['member','position','lot'].some(key=>reviewed.retryCursor[key]!==prior.retryCursor[key])))
   throw Error('UNIFIED_RECOVERY_OBSERVATION_MISMATCH');
  const reread=journal.read();
  if(!reread||digest(reread)!==recordDigest)throw Error('UNIFIED_RECOVERY_JOURNAL_CHANGED');
  if(prior){await recheckUnifiedBlock(provider,prior.anchor);await recheckUnifiedBlock(provider,prior.receiptAnchor);}
  await recheckUnifiedBlock(provider,reviewed.anchor);await recheckUnifiedBlock(provider,reviewed.receiptAnchor);
  const observation={version:1,chainId:97,proofIdentity:proofId,operator:who,recordDigest,
   transactionHash:reviewed.hash.toLowerCase(),retryCursor:reviewed.retryCursor,
   anchor:{number:reviewed.anchor.number,hash:reviewed.anchor.hash.toLowerCase()},
   receiptAnchor:{number:reviewed.receiptAnchor.number,hash:reviewed.receiptAnchor.hash.toLowerCase()}};
  writeObservation(journalDirectory,filename,observation);
  return {state:'CONFIRMED_OBSERVATION_RECORDED',transactionHash:observation.transactionHash,
   retryCursor:observation.retryCursor,anchor:observation.anchor,receiptAnchor:observation.receiptAnchor,
   transactionSent:false,safeToRetry:false,cursorPersisted:false,journalCleared:false};
 }finally{journal.close();}
}
