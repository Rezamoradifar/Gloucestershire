import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {summarizeAutomation,createAutomationStatusReader} from '../server/automation-status.mjs';

const target = '0x1111111111111111111111111111111111111111';
const transactionHash = '0x'+'ab'.repeat(32), blockHash = '0x'+'cd'.repeat(32);
const now = Date.parse('2026-11-07T00:00:00Z');
const options = {chainId:97,vaultAddress:target,now};
const fixture = () => ({chainId:97,target,timerActive:true,automation:{chainId:97,target,
  checkedAt:new Date(now-1000).toISOString(),status:'scheduled',dailyStatus:'not_due',nextEpoch:3,
  dailyCredits:[{status:'credited',transactionHash}],lastDailyCredit:{epoch:2,batches:[{transactionHash,block:123,blockHash}]},
  errors:[],blockers:[],privateKey:'never-public',rpcUrl:'https://secret.invalid/token',transactions:{raw:'secret'}}});

test('public automation status exposes confirmed receipts and only allowlisted fields',()=>{
  const result=summarizeAutomation(fixture(),options);
  assert.equal(result.status,'credited');assert.equal(result.fresh,true);
  assert.equal(result.lastCredit.epoch,2);assert.deepEqual(result.confirmedTransactions,[transactionHash]);
  assert.ok(!JSON.stringify(result).includes('secret'));assert.ok(!JSON.stringify(result).includes('privateKey'));
});
test('index progress returns only numeric counts and cursors tied to the worker report',()=>{
 const v=fixture();v.automation.indexProgress={memberThrough:100,positionThrough:98,target:105,memberCount:4,positionCount:7,secret:'private',wallet:'0xabc'};
 const r=summarizeAutomation(v,options);
 assert.deepEqual(r.indexProgress,{memberThrough:100,positionThrough:98,target:105,memberCount:4,positionCount:7});
 assert.equal(r.checkedAt,v.automation.checkedAt);assert.equal(r.fresh,true);assert.ok(!JSON.stringify(r.indexProgress).includes('private'));
 v.automation.indexProgress={memberThrough:-1,positionThrough:'98',target:Infinity,memberCount:4,positionCount:7};
 assert.deepEqual(summarizeAutomation(v,options).indexProgress,{memberThrough:null,positionThrough:null,target:null,memberCount:4,positionCount:7});
 v.automation.indexProgress=null;assert.equal(summarizeAutomation(v,options).indexProgress,null);
 v.automation.lastCreditBlockTimestamp=Math.floor(now/1000)-10;assert.equal(summarizeAutomation(v,options).lastCreditBlockTimestamp,Math.floor(now/1000)-10);
 v.automation.lastCreditBlockTimestamp=Math.floor(now/1000)+1000;assert.equal(summarizeAutomation(v,options).lastCreditBlockTimestamp,null);
});
test('old receipts never make a stale or unscheduled worker look live',()=>{
  const old=fixture();old.automation.checkedAt=new Date(now-3600000).toISOString();
  assert.equal(summarizeAutomation(old,options).status,'stale');
  const unscheduled=fixture();unscheduled.timerActive=false;
  assert.equal(summarizeAutomation(unscheduled,options).status,'waiting');
  const ordered=fixture();delete ordered.timerActive;ordered.scheduling={kind:'ordered',active:true};
  assert.equal(summarizeAutomation(ordered,options).schedulerActive,true);
});
test('status rejects wrong deployments, future clocks, malformed receipts and HTML fallback',()=>{
  for(const value of [null,'<!doctype html>',{...fixture(),automation:{...fixture().automation,target:'0x2222222222222222222222222222222222222222'}},
    {...fixture(),automation:{...fixture().automation,checkedAt:new Date(now+120000).toISOString()}}])assert.equal(summarizeAutomation(value,options).status,'unavailable');
  const value=fixture();value.automation.dailyCredits=[{status:'already_credited',transactionHash},{status:'credited',transactionHash:'bad'}];
  value.automation.lastDailyCredit.batches[0].blockHash='bad';
  const result=summarizeAutomation(value,options);assert.deepEqual(result.confirmedTransactions,[]);assert.equal(result.lastCredit,null);
});
test('status reader fails closed on missing, unsafe and symlinked files',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'global-status-'));
  try{
    const file=path.join(root,'status.json'),read=createAutomationStatusReader({...options,file,now:()=>now});
    assert.equal((await read()).status,'unavailable');
    await fs.writeFile(file,JSON.stringify(fixture()),{mode:0o644});
    assert.equal((await read()).status,process.getuid?.()===0?'credited':'unavailable');
    await fs.chmod(file,0o666);assert.equal((await read()).status,'unavailable');
    await fs.chmod(file,0o644);await fs.symlink(file,path.join(root,'link.json'));
    assert.equal((await createAutomationStatusReader({...options,file:path.join(root,'link.json'),now:()=>now})()).status,'unavailable');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
