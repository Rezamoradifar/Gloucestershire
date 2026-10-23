import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const project=fileURLToPath(new URL('../',import.meta.url));
const worker=path.join(project,'scripts/zero-start-automation.mjs');

function assertMainRuns(file){
 const result=spawnSync(process.execPath,[file,'--invalid-entrypoint-test-command'],{encoding:'utf8',timeout:15000});
 assert.equal(result.status,1,result.stdout+result.stderr);
 assert.match(result.stderr,/ZERO_START_AUTOMATION_STOPPED ROOT_EXPLICIT_CHECK_OR_EXECUTE_REQUIRED/);
 assert.equal(result.stdout,'');
}

test('the automation CLI runs through its direct release path before reading environment or signer files',()=>{
 assertMainRuns(worker);
});

test('the automation CLI runs through the current directory symlink used by systemd',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'global-worker-entrypoint-'));
 try{
  const current=path.join(directory,'current');fs.symlinkSync(project,current,'dir');
  assertMainRuns(path.join(current,'scripts/zero-start-automation.mjs'));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('importing the automation library never runs its CLI',()=>{
 const source='await import('+JSON.stringify(pathToFileURL(worker).href)+');process.stdout.write("IMPORTED_WITHOUT_RUNNING\\n");';
 const result=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',timeout:15000});
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.equal(result.stdout,'IMPORTED_WITHOUT_RUNNING\n');assert.equal(result.stderr,'');
});

test('importing the automation library from stdin tolerates the non-file argv entry',()=>{
 const source='await import('+JSON.stringify(pathToFileURL(worker).href)+');process.stdout.write("IMPORTED_FROM_STDIN\\n");';
 const result=spawnSync(process.execPath,['--input-type=module','-'],{input:source,encoding:'utf8',timeout:15000});
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.equal(result.stdout,'IMPORTED_FROM_STDIN\n');assert.equal(result.stderr,'');
});
