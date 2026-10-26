import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('legacy unsigned preparation refuses chain 56 before RPC access or legacy artifact output',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'global-mainnet-entry-'));
 try{
  const config=path.join(directory,'mainnet.json');
  fs.writeFileSync(config,JSON.stringify({chainId:56}));
  const result=spawnSync(process.execPath,[path.resolve('scripts/prepare-deployment.mjs'),config],{cwd:directory,env:{...process.env,BSC_RPC_URL:'https://private.invalid/secret-mainnet-rpc'},encoding:'utf8',timeout:10000});
  assert.equal(result.error,undefined);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/MAINNET_FRESH_PREPARATION_REQUIRED/);
  assert.doesNotMatch(result.stdout+result.stderr,/secret-mainnet-rpc|https:\/\/private/);
  assert.deepEqual(fs.readdirSync(directory),['mainnet.json']);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
