import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadDailyActivityGate} from '../scripts/daily-activity-worker.mjs';
import {createDailyActivityState} from '../scripts/daily-activity.mjs';

const wallet='0x1111111111111111111111111111111111111111',vaultAddress='0x2222222222222222222222222222222222222222';
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'global-activity-worker-'));
 fs.chmodSync(root,0o700);
 const file=path.join(root,'policy.json'),historyFile=path.join(root,'history.json');
 const identity={chainId:97,vaultAddress,origin:'https://globaldroptrade.com'};
 const policy={version:1,...identity,windowSeconds:86400,activationTimestamp:200000,historyFile};
 fs.writeFileSync(historyFile,JSON.stringify(createDailyActivityState(identity)),{mode:0o600});
 fs.writeFileSync(file,JSON.stringify(policy),{mode:0o600});
 const options={provider:{getBlock:async()=>null},chainId:97,vaultAddress,state:{},env:{GLOBAL_DAILY_ACTIVITY_POLICY:file}};
 return {root,file,historyFile,policy,options,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('the activity cutoff preserves old earned periods and skips missing future check-ins',async()=>{
 const f=fixture();try{
  const gate=await loadDailyActivityGate(f.options);
  assert.equal(await gate.eligible(wallet,{start:199999,end:286399}),true);
  assert.equal(await gate.eligible(wallet,{start:200000,end:286400}),false);
  assert.match(f.options.state.activityPolicyBinding,/^0x[0-9a-f]{64}$/);
 }finally{f.close();}
});
test('a missing or unsafe activity policy fails closed after activation without altering earning state',async()=>{
 const f=fixture();try{
  await loadDailyActivityGate(f.options);fs.unlinkSync(f.file);
  await assert.rejects(loadDailyActivityGate(f.options),/POLICY_MISSING/);
  await assert.rejects(loadDailyActivityGate({...f.options,env:{},policyFile:f.file}),/POLICY_MISSING/);
  fs.writeFileSync(f.file,JSON.stringify(f.policy),{mode:0o644});
  await assert.rejects(loadDailyActivityGate(f.options),/PRIVATE_POLICY/);
  assert.equal(await loadDailyActivityGate({...f.options,state:{},env:{},policyFile:path.join(f.root,'disabled.json')}),undefined);
 }finally{f.close();}
});
test('a worker rejects policy changes, deployment mismatches and corrupt histories before eligibility',async()=>{
 const f=fixture();try{
  const gate=await loadDailyActivityGate(f.options);
  fs.writeFileSync(f.file,JSON.stringify({...f.policy,activationTimestamp:300000}));
  assert.throws(gate.assertCurrent,/POLICY_CHANGED/);
  await assert.rejects(loadDailyActivityGate(f.options),/POLICY_CHANGED/);
  await assert.rejects(loadDailyActivityGate({...f.options,chainId:56,state:{}}),/TARGET_MISMATCH/);
  fs.writeFileSync(f.file,JSON.stringify(f.policy));fs.writeFileSync(f.historyFile,'not-json');
  await assert.rejects(loadDailyActivityGate(f.options),/HISTORY_INVALID/);
 }finally{f.close();}
});
