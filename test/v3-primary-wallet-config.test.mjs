import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readWalletConfig} from '../scripts/read-v3-wallet-config.mjs';

test('preserves the wallet id and rejects ambiguous or unsafe bundles',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v3-wallet-config-'));
 try{
  const assets=path.join(root,'assets');fs.mkdirSync(assets);
  const first=path.join(assets,'first.js'),second=path.join(assets,'second.js');
  const id='0123456789abcdef0123456789abcdef';
  fs.writeFileSync(first,`var wallet="${id}".trim();foo.init({projectId:wallet})`);
  assert.equal(readWalletConfig(root),id);
  fs.writeFileSync(second,'var wallet2="".trim();foo.init({projectId:wallet2})');
  assert.throws(()=>readWalletConfig(root),/UNVERIFIED/);
  fs.unlinkSync(second);fs.unlinkSync(first);
  fs.writeFileSync(first,'var wallet="".trim();foo.init({projectId:wallet})');
  assert.equal(readWalletConfig(root),'disabled');
  fs.symlinkSync(first,second);
  assert.throws(()=>readWalletConfig(root),/UNSAFE/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
