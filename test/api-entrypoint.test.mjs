import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,symlink,rm,access,readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import http from 'node:http';
import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
for(const mode of ['stdin','eval','non-file-argument'])test('API configuration import is side-effect free through '+mode,async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'global-api-import-'));
 const stateFile=path.join(dir,'unexpected-server-state/community.json');
 const code="import {readConfig} from './server/trades-api.mjs'; const c=readConfig(); if(c.chainId!==97||c.port!==3115||c.address!==''||c.rpcUrl!=='')throw Error('CONFIG_IMPORT_MISMATCH'); console.log('CONFIG_IMPORTED_WITHOUT_SERVER');";
 const args=mode==='stdin'?['--input-type=module','-']:['--input-type=module','-e',code,...(mode==='non-file-argument'?['not-an-entrypoint']:[])];
 const child=spawn(process.execPath,args,{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,TRADES_CHAIN_ID:'97',TRADES_PORT:'3115',TRADES_RPC_URL:'',TRADES_VAULT_ADDRESS:'',COMMUNITY_DATA_FILE:stateFile}});
 let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.stdin.end(mode==='stdin'?code:'');
 try{
  const exit=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Configuration import started a server or stalled'));},5000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',(status,signal)=>{clearTimeout(timer);resolve({status,signal});});});
  assert.equal(exit.status,0,stderr);assert.equal(exit.signal,null);assert.equal(stdout.trim(),'CONFIG_IMPORTED_WITHOUT_SERVER');assert.equal(stderr,'');
  await assert.rejects(access(stateFile),{code:'ENOENT'});
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await rm(dir,{recursive:true,force:true});}
});
test('migration installer stdin preflight reaches only read-only RPC before rejecting an unverified source',async()=>{
 const script=await readFile(new URL('../ubuntu-deferred-migration.sh',import.meta.url),'utf8');
 const code=script.match(/node --env-file="\$envfile" --input-type=module - <<'JS'\n([\s\S]*?)\nJS\n/)?.[1];assert.ok(code,'Installer stdin preflight must be exercised');
 const methods=[],rpc=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  const request=JSON.parse(body);methods.push(request.method);
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:request.id,result:request.method==='eth_chainId'?'0x61':'0x'}));
 });
 await new Promise(resolve=>rpc.listen(0,'127.0.0.1',resolve));
 const dir=await mkdtemp(path.join(os.tmpdir(),'global-installer-stdin-')),envfile=path.join(dir,'trades.env');
 const settings={TRADES_CHAIN_ID:'97',TRADES_VAULT_ADDRESS:'0x731Ba0644e8f44BbBd48124F945724ba534431eb',TRADES_RPC_URL:'http://127.0.0.1:'+rpc.address().port,TRADES_PORT:'3115'};
 await writeFile(envfile,Object.entries(settings).map(([k,v])=>k+'='+v).join('\n'),{mode:0o600});
 const child=spawn(process.execPath,['--env-file='+envfile,'--input-type=module','-'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,...settings}});
 let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.stdin.end(code);
 try{
  const exit=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Installer preflight stalled'));},5000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',status=>{clearTimeout(timer);resolve(status);});});
  assert.equal(exit,1);assert.equal(stdout,'');assert.equal(stderr.trim(),'SOURCE_VERIFICATION_FAILED: existing configuration unchanged');
  assert.deepEqual(methods,['eth_chainId','eth_getCode']);
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await new Promise(resolve=>rpc.close(resolve));await rm(dir,{recursive:true,force:true});}
});
test('API starts through the current release symlink used by systemd',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'global-api-entry-'));await symlink(fileURLToPath(new URL('..',import.meta.url)),path.join(dir,'current'));
 const child=spawn(process.execPath,[path.join(dir,'current/server/trades-api.mjs')],{env:{...process.env,TRADES_PORT:'53115',TRADES_RPC_URL:'',TRADES_VAULT_ADDRESS:'',COMMUNITY_DATA_FILE:path.join(dir,'state/community.json')}});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('No startup: '+output)),5000);child.on('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);reject(Error('Early exit '+code+': '+output));});child.stdout.on('data',()=>{if(output.includes('listening on')){clearTimeout(timer);resolve();}});});
  const health=await fetch('http://127.0.0.1:53115/api/health');assert.equal(health.status,200);
  const announcements=await fetch('http://127.0.0.1:53115/api/community/announcements');assert.equal(announcements.status,200);assert.deepEqual((await announcements.json()).items,[]);
 }finally{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}await rm(dir,{recursive:true,force:true});}
});
