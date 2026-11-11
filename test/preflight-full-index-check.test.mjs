import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {measureFullChecks,reviewFinancialRows} from '../scripts/preflight-full-index-check.mjs';

const h=n=>'0x'+n.repeat(64);
function fixture(){
 const state={daily:{},transactions:{first:{hash:h('a'),block:11,blockHash:h('b')},second:{hash:h('c'),block:12,blockHash:h('d')},third:{hash:h('e'),block:12,blockHash:h('d')}}};
 const writes=[];let input='unchanged',archiveReads=0,archiveVerifies=0;
 const provider={getBlock:async number=>({hash:number===11?h('b'):h('d')}),sendTransaction:()=>writes.push('send')};
 const readInputs=()=>input;
 return {state,writes,provider,readInputs,readArchive:()=>{archiveReads++;return {digest:'a'};},verifyArchive:()=>{archiveVerifies++;},setInput:value=>{input=value;},counts:()=>({archiveReads,archiveVerifies})};
}

test('checks every unique transaction block and times archives without writing',async()=>{
 const f=fixture();let reads=0;
 const provider={...f.provider,getBlock:async n=>{reads++;return f.provider.getBlock(n);}};
 const value=await measureFullChecks({...f,provider});
 assert.equal(value.entries,3);assert.equal(value.distinctBlocks,2);assert.equal(reads,2);
 assert.equal(value.canonicalVerified,true);assert.equal(value.archiveVerified,true);assert.equal(value.journalAndInputsUnchanged,true);
 assert.ok(value.canonicalMs>=0&&value.archiveReadMs>=0&&value.archiveGuardMs>=0&&value.secondArchiveGuardMs>=0);
 assert.deepEqual(f.counts(),{archiveReads:1,archiveVerifies:2});assert.deepEqual(f.writes,[]);
});

test('pending and malformed financial states never get a ready result',()=>{
 const f=fixture();
 assert.throws(()=>reviewFinancialRows({...f.state,daily:{pendingDailyPlan:null}}),/PENDING_FINANCIAL_STATE/);
 assert.throws(()=>reviewFinancialRows({...f.state,pending:{}}),/PENDING_FINANCIAL_STATE/);
 assert.throws(()=>reviewFinancialRows({...f.state,oracle:{pending:{}}}),/PENDING_FINANCIAL_STATE/);
 assert.throws(()=>reviewFinancialRows({...f.state,oracle:[]}),/INVALID_JOURNAL/);
 assert.throws(()=>reviewFinancialRows({...f.state,transactions:[]}),/INVALID_JOURNAL/);
 assert.throws(()=>reviewFinancialRows({...f.state,transactions:{x:{block:1}}}),/UNSETTLED_OR_INVALID/);
});

test('reorg is surfaced and never produces a successful measurement',async()=>{
 const f=fixture();f.provider.getBlock=async()=>({hash:h('f')});
 await assert.rejects(measureFullChecks(f),/JOURNAL_NOT_CANONICAL/);assert.deepEqual(f.writes,[]);
});

test('reports changed journal/config and rejects a failed archive',async()=>{
 const f=fixture();
 const result=await measureFullChecks({...f,canonical:async()=>f.setInput('changed')});
 assert.equal(result.journalAndInputsUnchanged,false);
 await assert.rejects(measureFullChecks({...f,verifyArchive:()=>{throw Error('ARCHIVE_CHANGED');}}),/ARCHIVE_CHANGED/);
});

test('bounded asynchronous canonical timeout never writes',async()=>{
 const f=fixture();
 await assert.rejects(measureFullChecks({...f,canonical:()=>new Promise(()=>{}),timeoutMs:5}),/FULL_INDEX_CANONICAL_TIMEOUT/);
 assert.deepEqual(f.writes,[]);
});

test('probe is parseable and has no signing or journal mutation operations',()=>{
 const file='scripts/preflight-full-index-check.mjs',source=fs.readFileSync(file,'utf8');
 assert.equal(spawnSync(process.execPath,['--check',file]).status,0);
 assert.doesNotMatch(source,/writePrivateJson|readPrivateKey|new Wallet\(|sendTransaction|eth_sendRawTransaction|acquireCatchupLock/);
 assert.match(source,/signerOpened:false,transactionsSent:0,journalWritten:false,lockAcquired:false/);
});
