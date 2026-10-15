import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,symlink,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
test('API starts through the current release symlink used by systemd',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'global-api-entry-'));await symlink(fileURLToPath(new URL('..',import.meta.url)),path.join(dir,'current'));
 const child=spawn(process.execPath,[path.join(dir,'current/server/trades-api.mjs')],{env:{...process.env,TRADES_PORT:'53115',TRADES_RPC_URL:'',TRADES_VAULT_ADDRESS:'',COMMUNITY_DATA_FILE:path.join(dir,'state/community.json')}});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('No startup: '+output)),5000);child.on('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);reject(Error('Early exit '+code+': '+output));});child.stdout.on('data',()=>{if(output.includes('listening on')){clearTimeout(timer);resolve();}});});
  const health=await fetch('http://127.0.0.1:53115/api/health');assert.equal(health.status,200);
  const announcements=await fetch('http://127.0.0.1:53115/api/community/announcements');assert.equal(announcements.status,200);assert.deepEqual((await announcements.json()).items,[]);
 }finally{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}await rm(dir,{recursive:true,force:true});}
});
