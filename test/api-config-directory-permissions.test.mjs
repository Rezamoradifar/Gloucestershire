// Run the actual API installer with isolated host paths and harmless service stubs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {afterEach,test} from 'node:test';

const fixtures=[];
const source=fs.readFileSync('ubuntu-api.sh','utf8');
function write(file,contents,mode=0o600){
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 fs.writeFileSync(file,contents,{mode});fs.chmodSync(file,mode);
}
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'global-api-mode-'));fixtures.push(root);
 const bin=path.join(root,'bin');fs.mkdirSync(bin);
 for(const [name,body] of Object.entries({
  id:'if [ "${1:-}" = -u ]; then echo 0; fi; exit 0',node:'exit 0',npm:'exit 0',systemctl:'exit 0',curl:'exit 0',
  stat:'if [ "$1" = -c ] && [ "$2" = "%u" ]; then if [ "${FAKE_NONROOT_PATH:-}" = "${3:-}" ]; then echo 1234; else echo 0; fi; else exec /usr/bin/stat "$@"; fi'
 }))write(path.join(bin,name),'#!/bin/sh\n'+body+'\n',0o700);
 for(const [file,content] of Object.entries({
  'server/main.mjs':'export {};\n','server/trades.env.example':'TRADES_PORT=3115\n',
  'scripts/main.mjs':'export {};\n','artifacts/TestnetDeferredMigrationVault.json':'{}\n',
  'package.json':'{}\n','package-lock.json':'{}\n'
 }))write(path.join(root,file),content);
 fs.mkdirSync(path.join(root,'etc/systemd/system'),{recursive:true,mode:0o700});
 const adjusted=source.replaceAll('/opt/globaldroptrade-api',path.join(root,'opt/api'))
  .replaceAll('/etc/globaldroptrade',path.join(root,'etc/globaldroptrade'))
  .replaceAll('/etc/systemd/system',path.join(root,'etc/systemd/system'));
 const installer=path.join(root,'ubuntu-api.sh');write(installer,adjusted,0o700);
 return {root,bin,installer,config:path.join(root,'etc/globaldroptrade')};
}
function run(f,extra={}){return spawnSync('/bin/bash',[f.installer],{cwd:f.root,encoding:'utf8',env:{...process.env,PATH:f.bin+path.delimiter+process.env.PATH,...extra}});}
afterEach(()=>{while(fixtures.length)fs.rmSync(fixtures.pop(),{recursive:true,force:true});});

for(const mode of [0o700,0o755])test(`API installer preserves existing config directory mode ${mode.toString(8)}`,()=>{
 const f=fixture();fs.mkdirSync(f.config,{recursive:true,mode});fs.chmodSync(f.config,mode);
 const before=fs.statSync(f.config),result=run(f),after=fs.statSync(f.config);
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.equal(after.mode&0o777,mode);assert.equal(after.uid,before.uid);assert.equal(after.gid,before.gid);
 assert.equal(fs.statSync(path.join(f.config,'trades.env')).mode&0o777,0o600);
});

test('API installer creates a missing configuration directory privately',()=>{
 const f=fixture(),result=run(f);
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.equal(fs.statSync(f.config).mode&0o777,0o700);
});

test('API installer refuses a symlink configuration directory',()=>{
 const f=fixture(),external=path.join(f.root,'external');fs.mkdirSync(external,{mode:0o700});
 fs.mkdirSync(path.dirname(f.config),{recursive:true,mode:0o700});fs.symlinkSync(external,f.config);
 const result=run(f);assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/API_CONFIG_DIRECTORY_UNSAFE/);
 assert.deepEqual(fs.readdirSync(external),[]);
});

test('API installer rejects a group-writable configuration directory',()=>{
 const f=fixture();fs.mkdirSync(f.config,{recursive:true,mode:0o770});fs.chmodSync(f.config,0o770);
 const result=run(f);assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/API_CONFIG_DIRECTORY_UNSAFE/);
 assert.equal(fs.statSync(f.config).mode&0o777,0o770);
});

test('API installer refuses an environment-file symlink without changing its target',()=>{
 const f=fixture();fs.mkdirSync(f.config,{recursive:true,mode:0o700});const external=path.join(f.root,'elsewhere');write(external,'secret\n',0o644);
 fs.symlinkSync(external,path.join(f.config,'trades.env'));const result=run(f);
 assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/API_ENV_FILE_UNSAFE/);
 assert.equal(fs.statSync(external).mode&0o777,0o644);assert.equal(fs.readFileSync(external,'utf8'),'secret\n');
});

test('API installer refuses a non-root-owned existing environment',()=>{
 const f=fixture();fs.mkdirSync(f.config,{recursive:true,mode:0o700});const env=path.join(f.config,'trades.env');write(env,'secret\n',0o644);
 const result=run(f,{FAKE_NONROOT_PATH:env});assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/API_ENV_FILE_UNSAFE/);
 assert.equal(fs.statSync(env).mode&0o777,0o644);assert.equal(fs.readFileSync(env,'utf8'),'secret\n');
});

test('API installer refuses a non-root-owned configuration directory',()=>{
 const f=fixture();fs.mkdirSync(f.config,{recursive:true,mode:0o700});
 const result=run(f,{FAKE_NONROOT_PATH:f.config});assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/API_CONFIG_DIRECTORY_UNSAFE/);
 assert.deepEqual(fs.readdirSync(f.config),[]);assert.equal(fs.statSync(f.config).mode&0o777,0o700);
});

test('API installer refuses an environment with multiple hard links',()=>{
 const f=fixture();fs.mkdirSync(f.config,{recursive:true,mode:0o700});const env=path.join(f.config,'trades.env');write(env,'secret\n',0o644);fs.linkSync(env,path.join(f.root,'elsewhere'));
 const result=run(f);assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/API_ENV_FILE_UNSAFE/);
 assert.equal(fs.statSync(env).mode&0o777,0o644);assert.equal(fs.readFileSync(env,'utf8'),'secret\n');
});
