import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {checkConfig,checkActivity,checkBuild,walletId} from '../scripts/check-testnet-activity-release.mjs';

test('website release only accepts the current chain-97 vault',()=>{
 const good={version:1,chainId:97,vaultAddress:'0x4C0F6141b18971db4b14e45c0bE8CddB09febc14'};
 assert.doesNotThrow(()=>checkConfig(good));
 assert.throws(()=>checkConfig({...good,chainId:56}),/TARGET_MISMATCH/);
 assert.throws(()=>checkConfig({...good,vaultAddress:'0x1111111111111111111111111111111111111111'}),/TARGET_MISMATCH/);
});
test('website release requires the correctly bound activity status service',()=>{
 const good={version:1,chainId:97,vaultAddress:'0x4C0F6141b18971db4b14e45c0bE8CddB09febc14',wallet:'0x0000000000000000000000000000000000000001',windowSeconds:86400,requirementEnabled:true,activationTimestamp:1};
 assert.doesNotThrow(()=>checkActivity(good));
 assert.throws(()=>checkActivity({...good,requirementEnabled:false}),/API_MISMATCH/);
 assert.throws(()=>checkActivity({...good,chainId:56}),/API_MISMATCH/);
 assert.throws(()=>checkActivity({...good,wallet:'other'}),/API_MISMATCH/);
});
test('website release requires a module entry and the activity UI in built assets',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gdt-activity-test-'));
 const previous=process.env.VITE_WALLETCONNECT_PROJECT_ID;
 try{
  process.env.VITE_WALLETCONNECT_PROJECT_ID='a'.repeat(32);
  fs.mkdirSync(path.join(dir,'assets'));
  fs.writeFileSync(path.join(dir,'index.html'),'<script type="module" crossorigin src="/assets/index.js"></script>');
  fs.writeFileSync(path.join(dir,'assets','index.js'),'entry');
  fs.writeFileSync(path.join(dir,'assets','app.js'),'Daily activity; Check in for 24 hours; wh="'+process.env.VITE_WALLETCONNECT_PROJECT_ID+'".trim(); x.init({projectId:wh})');
  assert.doesNotThrow(()=>checkBuild(dir));
  fs.writeFileSync(path.join(dir,'assets','app.js'),'Daily activity');
  assert.throws(()=>checkBuild(dir),/BUILD_MISSING/);
  fs.writeFileSync(path.join(dir,'index.html'),'');
  assert.throws(()=>checkBuild(dir),/BUILD_ENTRY_REQUIRED/);
 }finally{if(previous===undefined)delete process.env.VITE_WALLETCONNECT_PROJECT_ID;else process.env.VITE_WALLETCONNECT_PROJECT_ID=previous;fs.rmSync(dir,{recursive:true,force:true});}
});
test('wallet ID extraction fails closed on a changed or ambiguous bundle',()=>{
 const body='wh="'+'a'.repeat(32)+'".trim(); x.init({projectId:wh})';
 assert.equal(walletId(body),'a'.repeat(32));
 assert.throws(()=>walletId(body,'0'.repeat(64)),/BUNDLE_CHANGED/);
 assert.throws(()=>walletId(body+'; x.init({projectId:wh})'),/WALLET_ID_REQUIRED/);
 assert.throws(()=>walletId('wh="bad".trim(); x.init({projectId:wh})'),/WALLET_ID_REQUIRED/);
});
