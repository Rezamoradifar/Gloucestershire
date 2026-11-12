import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,symlinkSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const script='scripts/verify-nginx-served-root.py';
const installer='ubuntu-event-history-rpc-install.sh';
const temp=()=>mkdtempSync(path.join(tmpdir(),'nginx-served-root-test-'));
const check=(folder,config,served)=>{
 const conf=path.join(folder,'nginx.txt'),html=path.join(folder,'served.html');
 writeFileSync(conf,config);writeFileSync(html,served);
 return spawnSync('python3',[script,'--nginx-config',conf,'--served',html],{encoding:'utf8'});
};

test('installer now discovers a literal configured nginx root instead of guessing the website directory',()=>{
 const contents=readFileSync(installer,'utf8');
 assert.match(contents,/nginx -T > "\$stage\/nginx-verified\.conf"/);
 assert.match(contents,/scripts\/verify-nginx-served-root\.py/);
 assert.match(contents,/EVENT_HISTORY_VERIFIED_SITE_ROOT/);
 assert.doesNotMatch(contents,/for index in \/var\/www\/globaldroptrade\/index\.html/);
 assert.equal(spawnSync('bash',['-n',installer],{encoding:'utf8'}).status,0);
});

test('accept only a configured directory whose index bytes exactly match the live HTTPS response',()=>{
 const folder=temp();
 try{
  const root=path.join(folder,'custom-public');
  mkdirSync(root);
  writeFileSync(path.join(root,'index.html'),'<html>current site</html>');
  const r=check(folder,'server {\n  server_name globaldroptrade.com;\n  root '+root+';\n}\n','<html>current site</html>');
  assert.equal(r.status,0,r.stderr);
  assert.equal(r.stdout.trim(),root);
  const different=check(folder,'server {\n  root '+root+';\n}\n','<html>other</html>');
  assert.equal(different.status,1);
  assert.match(different.stderr,/EVENT_HISTORY_SITE_ROOT_NOT_VERIFIED/);
 }finally{rmSync(folder,{recursive:true,force:true});}
});

test('resolved nginx release symlink is supported without accepting untrusted extra static roots',()=>{
 const folder=temp();
 try{
  const root=path.join(folder,'releases','r1');
  mkdirSync(root,{recursive:true});
  writeFileSync(path.join(root,'index.html'),'<html>release</html>');
  symlinkSync(root,path.join(folder,'current'));
  const config='server {\n root '+path.join(folder,'current')+';\n}\n';
  const r=check(folder,config,'<html>release</html>');
  assert.equal(r.status,0,r.stderr);
  assert.equal(r.stdout.trim(),root);
  const ignored=check(folder,'server {\n root $document_root;\n}\n','<html>release</html>');
  assert.equal(ignored.status,1);
  assert.match(ignored.stderr,/EVENT_HISTORY_NGINX_ROOT_DIRECTIVE_NOT_FOUND/);
 }finally{rmSync(folder,{recursive:true,force:true});}
});

test('a duplicated matching index or a symlinked index fails closed',()=>{
 const folder=temp();
 try{
  const a=path.join(folder,'site-a'),b=path.join(folder,'site-b');
  mkdirSync(a);mkdirSync(b);
  writeFileSync(path.join(a,'index.html'),'same');
  writeFileSync(path.join(b,'index.html'),'same');
  const r=check(folder,'server {\n root '+a+';\n}\nserver {\n root '+b+';\n}\n','same');
  assert.equal(r.status,1);
  assert.match(r.stderr,/EVENT_HISTORY_AMBIGUOUS_SITE_ROOT/);
  rmSync(path.join(b,'index.html'));
  symlinkSync(path.join(a,'index.html'),path.join(b,'index.html'));
  const bad=check(folder,'server {\n root '+b+';\n}\n','same');
  assert.equal(bad.status,1);
  assert.match(bad.stderr,/EVENT_HISTORY_SITE_ROOT_NOT_VERIFIED/);
 }finally{rmSync(folder,{recursive:true,force:true});}
});
