// Replace the exact reviewed API environment atomically; never print its contents.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export function replaceNewDeployerEnvironment({target,expected,contents,expectedUid=0}){
 const descriptor=fs.openSync(target,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 let temporary,created=false;
 try{
  const before=fs.fstatSync(descriptor);
  if(!before.isFile()||before.uid!==expectedUid||(before.mode&0o022)!==0||before.nlink!==1||before.size>1024*1024)throw Error('NEW_DEPLOYER_ENV_UNSAFE');
  if(!fs.readFileSync(descriptor).equals(expected))throw Error('NEW_DEPLOYER_ENV_CHANGED');
  temporary=path.join(path.dirname(target),'.new-deployer-env-'+randomBytes(16).toString('hex'));
  const fd=fs.openSync(temporary,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,before.mode&0o777);
  created=true;
  try{fs.fchownSync(fd,before.uid,before.gid);fs.fchmodSync(fd,before.mode&0o777);fs.writeFileSync(fd,contents);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const current=fs.lstatSync(target);
  if(!current.isFile()||current.dev!==before.dev||current.ino!==before.ino||current.size!==before.size||current.mtimeMs!==before.mtimeMs||current.ctimeMs!==before.ctimeMs)throw Error('NEW_DEPLOYER_ENV_CHANGED');
  fs.renameSync(temporary,target);temporary=undefined;
  const directory=fs.openSync(path.dirname(target),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
 }finally{
  fs.closeSync(descriptor);
  if(temporary&&created)try{fs.unlinkSync(temporary);}catch{}
 }
}

let invoked;try{if(process.argv[1])invoked=pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href;}catch{}
if(import.meta.url===invoked){
 try{
  if(process.getuid?.()!==0||process.argv.length!==4)throw Error('NEW_DEPLOYER_ENV_REPLACE_REQUIRED');
  replaceNewDeployerEnvironment({target:'/etc/globaldroptrade/trades.env',expected:fs.readFileSync(process.argv[2]),contents:fs.readFileSync(process.argv[3])});
 }catch(error){console.error('NEW_DEPLOYER_ENV_REPLACE_STOPPED '+(/^[A-Z][A-Z0-9_]+$/.test(error.message||'')?error.message:'CHECK_REQUIRED'));process.exitCode=1;}
}
