// EXPERIMENTAL: checkpoint only an independently verified scan containing NO
// due transaction. No CLI, keys, signing, broadcasting or journal clearing.
// This is not a complete keeper: confirmed and ambiguous journals remain
// blocked until durable transaction reconciliation has been implemented.
// A member that becomes due after its scan waits for a future wrap. The vault
// does not backfill missed periods; capacity, bounded sweep and outage behavior
// must be designed and tested before this can be used as a live scheduler.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {getAddress,isAddress,keccak256,toUtf8Bytes,ZeroAddress} from 'ethers';
import {checkUnifiedKeeper} from './check-v3-unified-keeper.mjs';
import {chooseUnifiedKeeperStep} from './plan-v3-unified-keeper-cycle.mjs';
import {openUnifiedJournal} from './v3-unified-keeper-journal.mjs';
import {validateUnifiedProof,recheckUnifiedBlock} from './verify-v3-unified-deployment.mjs';

const HASH=/^0x[0-9a-fA-F]{64}$/;
const cursor=value=>{
 if(!value||!['member','position','lot'].every(k=>Number.isSafeInteger(value[k])&&value[k]>=0))
  throw Error('INVALID_UNIFIED_IDLE_CHECKPOINT_CURSOR');
 return {member:value.member,position:value.position,lot:value.lot};
};
const identity=proof=>keccak256(toUtf8Bytes(JSON.stringify([
 proof.chainId,proof.vault,proof.book,proof.network,proof.token,proof.manager,proof.feeReceiver,
 proof.deploymentBlock,proof.deploymentTx,proof.vaultRuntimeHash,proof.bookRuntimeHash,proof.networkRuntimeHash
])));
const syncDir=directory=>{const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};

function readCheckpoint(filename,expectedIdentity,operator){
 let stat;
 try{stat=fs.lstatSync(filename);}catch(error){if(error?.code==='ENOENT')return null;throw error;}
 if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0||stat.size>4096)
  throw Error('UNIFIED_IDLE_CHECKPOINT_NOT_PRIVATE');
 const value=JSON.parse(fs.readFileSync(filename,'utf8'));
 if(!value||value.version!==1||value.chainId!==97||value.identity!==expectedIdentity||
    value.operator!==operator||!value.anchor||!Number.isSafeInteger(value.anchor.number)||value.anchor.number<1||
    !HASH.test(String(value.anchor.hash)))throw Error('UNIFIED_IDLE_CHECKPOINT_IDENTITY_MISMATCH');
 return {cursor:cursor(value.cursor),anchor:{number:value.anchor.number,hash:value.anchor.hash}};
}

function atomicWrite(directory,filename,value){
 const temp=path.join(directory,'.idle-checkpoint-'+randomBytes(12).toString('hex'));let fd;
 try{
  fd=fs.openSync(temp,'wx',0o600);
  fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  fs.renameSync(temp,filename);syncDir(directory);
 }finally{
  if(fd!==undefined)fs.closeSync(fd);
  try{fs.unlinkSync(temp);}catch(error){if(error?.code!=='ENOENT')throw error;}
 }
}

export async function checkpointUnifiedIdleScan({provider,proof:raw,operator,journalDirectory,
 maxWork=20,lotPageSize=8,makeContract}){
 if(!isAddress(operator)||getAddress(operator)===ZeroAddress)throw Error('INVALID_UNIFIED_IDLE_CHECKPOINT_OPERATOR');
 const who=getAddress(operator),proof=validateUnifiedProof(raw),proofIdentity=identity(proof);
 if(!Number.isSafeInteger(maxWork)||maxWork<1||maxWork>20||
    !Number.isSafeInteger(lotPageSize)||lotPageSize<1||lotPageSize>8)
  throw Error('INVALID_UNIFIED_IDLE_SCAN_LIMIT');
 const journal=openUnifiedJournal(journalDirectory),filename=path.join(journalDirectory,'idle-checkpoint.json');
 try{
  const pending=journal.read();
  if(pending)return {state:'JOURNAL_REQUIRES_RECONCILIATION',journalStatus:pending.status,
   transactionSent:false,cursorPersisted:false};
  const previous=readCheckpoint(filename,proofIdentity,who);
  if(previous)await recheckUnifiedBlock(provider,previous.anchor);
  const start=previous?.cursor??{member:0,position:0,lot:0};
  const preflight=await checkUnifiedKeeper({provider,proof,cursor:start,maxWork,maxResults:1,lotPageSize,makeContract});
  if(previous&&previous.anchor.number>preflight.block.number)throw Error('UNIFIED_IDLE_CHECKPOINT_FUTURE_BLOCK');
  const step=chooseUnifiedKeeperStep(preflight,start);
  if(step.state!=='NO_DUE_CANDIDATE')return {...step,cursorPersisted:false};
  const next=cursor(step.suggestedScanCursor);
  // The lock remains held across reads, scan, canonicality checks and rename.
  if(journal.read())throw Error('UNIFIED_PREVIOUS_TRANSACTION_NEEDS_REVIEW');
  if(previous)await recheckUnifiedBlock(provider,previous.anchor);
  await recheckUnifiedBlock(provider,preflight.block);
  const stored={version:1,chainId:97,identity:proofIdentity,operator:who,cursor:next,
   anchor:{number:preflight.block.number,hash:preflight.block.hash.toLowerCase()}};
  atomicWrite(journalDirectory,filename,stored);
  return {state:'IDLE_CHECKPOINT_RECORDED',chainId:97,cursor:next,anchor:stored.anchor,
   transactionSent:false,cursorPersisted:true};
 }finally{journal.close();}
}
