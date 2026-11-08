// Exercise the real production copy section instead of a mocked Node import.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';

test('the actual daily installer copy commands produce an importable worker release',()=>{
 const repository=process.cwd();
 const source=fs.readFileSync('ubuntu-enable-new-deployer-daily.sh','utf8');
 const start=source.indexOf('install -d -m 755 "$release/scripts"');
 const end=source.indexOf('(cd "$release" && npm ci',start);
 assert.ok(start>=0&&end>start,'expected the production release-copy section');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'new-deployer-release-closure-'));
 try{
  const copied=spawnSync('/bin/bash',['-eu','-c',source.slice(start,end)],{
   cwd:repository,encoding:'utf8',env:{...process.env,release:directory}
  });
  assert.equal(copied.status,0,copied.stdout+copied.stderr);
  // The parent test environment uses npm ci --omit=dev. Import the real copied
  // modules with those production dependencies and no service/RPC stubs.
  fs.symlinkSync(path.join(repository,'node_modules'),path.join(directory,'node_modules'),'dir');
  const imported=spawnSync(process.execPath,['--input-type=module','-e',
   "await import('./scripts/new-deployer-testnet-automation.mjs'); await import('./server/daily-activity.mjs');"
  ],{cwd:directory,encoding:'utf8',timeout:15000});
  assert.equal(imported.status,0,imported.stdout+imported.stderr);
  assert.ok(fs.existsSync(path.join(directory,'config/fresh-zero-testnet.json')));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
