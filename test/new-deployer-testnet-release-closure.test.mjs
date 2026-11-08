// Exercise the real production copy section instead of a mocked Node import.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
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

test('the activity readiness request retries a transient API restart response',async()=>{
 const source=fs.readFileSync('ubuntu-enable-new-deployer-daily.sh','utf8');
 const line=source.match(/^curl[^\n]*\/api\/daily-activity\/status[^\n]*$/m)?.[0];
 assert.ok(line,'expected the production activity readiness command');
 let requests=0;
 const server=createServer((_req,res)=>{
  requests++;
  res.writeHead(requests<3?502:200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({status:requests<3?'starting':'ready'}));
 });
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'new-deployer-api-readiness-'));
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address(),output=path.join(directory,'response.json');
  const command=line.replace('--resolve globaldroptrade.com:443:127.0.0.1','')
   .replace('"https://globaldroptrade.com/api/daily-activity/status?wallet=$owner"',`"http://127.0.0.1:${address.port}/api/daily-activity/status?wallet=test"`)
   .replace('"$stage/activity-response.json"',JSON.stringify(output));
  const result=await new Promise((resolve,reject)=>{
   const child=spawn('/bin/bash',['-eu','-c',command],{stdio:['ignore','pipe','pipe']});
   let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
   child.once('error',reject);child.once('close',code=>resolve({code,stderr}));
  });
  assert.equal(result.code,0,result.stderr);assert.equal(requests,3);
  assert.equal(JSON.parse(fs.readFileSync(output,'utf8')).status,'ready');
 }finally{
  await new Promise(resolve=>server.close(resolve));
  fs.rmSync(directory,{recursive:true,force:true});
 }
});
